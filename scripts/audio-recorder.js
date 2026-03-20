#!/usr/bin/env node
/**
 * Audio Recorder — connects to the Constant Ambient WebSocket and records
 * all broadcast data (levels, spectrum, automation, status) to a JSONL file.
 *
 * Usage:
 *   node scripts/audio-recorder.js [options]
 *
 * Options:
 *   --duration <minutes>   Recording duration (default: 10, 0 = until Ctrl+C)
 *   --port <port>          WebSocket port (default: 4000)
 *   --output <path>        Output file path (default: recordings/<timestamp>.jsonl)
 *   --interval <ms>        How often to write a sample (default: 500ms)
 *
 * Examples:
 *   node scripts/audio-recorder.js --duration 30
 *   node scripts/audio-recorder.js --duration 0      # record until Ctrl+C
 *   node scripts/audio-recorder.js --output my-session.jsonl --duration 60
 *
 * Output: JSONL file where each line is a JSON object with:
 *   { ts, elapsed, levels, analysis, automation, masterFX, liveEffects, status }
 */

import WebSocket from 'ws';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '..');

// ── Parse CLI args ──
const args = process.argv.slice(2);
function getArg(name, defaultVal) {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : defaultVal;
}

const duration = Number(getArg('duration', '10')); // minutes, 0 = infinite
const port = Number(getArg('port', '4000'));
const interval = Number(getArg('interval', '500')); // ms between recorded samples
const outputArg = getArg('output', null);

// ── Output file ──
const recordingsDir = path.join(PROJECT_ROOT, 'recordings');
if (!fs.existsSync(recordingsDir)) fs.mkdirSync(recordingsDir, { recursive: true });

const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outputPath = outputArg
  ? (path.isAbsolute(outputArg) ? outputArg : path.join(PROJECT_ROOT, outputArg))
  : path.join(recordingsDir, `${timestamp}.jsonl`);

const writeStream = fs.createWriteStream(outputPath, { flags: 'a' });

// ── State ──
const startTime = Date.now();
let sampleCount = 0;
let lastWrite = 0;
let latestLevels = null;
let latestAnalysis = null;
let latestAutomation = null;
let latestMasterFX = null;
let latestLiveEffects = null;
let latestStatus = null;
let connected = false;

function elapsed() {
  return ((Date.now() - startTime) / 1000).toFixed(1);
}

function writeSample() {
  const now = Date.now();
  if (now - lastWrite < interval) return;
  if (!latestLevels) return;
  lastWrite = now;

  const record = {
    ts: new Date(now).toISOString(),
    elapsed: (now - startTime) / 1000,
    levels: latestLevels,
    analysis: latestAnalysis,
    automation: latestAutomation,
    masterFX: latestMasterFX,
    liveEffects: latestLiveEffects,
    status: latestStatus,
  };

  writeStream.write(JSON.stringify(record) + '\n');
  sampleCount++;

  // Progress log every 30 seconds
  if (sampleCount % Math.round(30000 / interval) === 0) {
    const mins = ((now - startTime) / 60000).toFixed(1);
    console.log(`[recorder] ${mins}m elapsed, ${sampleCount} samples written`);
  }
}

function finish() {
  writeStream.end(() => {
    const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);
    const sizeMB = (fs.statSync(outputPath).size / (1024 * 1024)).toFixed(2);
    console.log(`\n[recorder] Done.`);
    console.log(`  File:     ${outputPath}`);
    console.log(`  Duration: ${durationSec}s`);
    console.log(`  Samples:  ${sampleCount}`);
    console.log(`  Size:     ${sizeMB} MB`);
    console.log(`\nGenerate report with:`);
    console.log(`  node scripts/audio-report.js ${outputPath}`);
    process.exit(0);
  });
}

// ── Connect ──
const url = `ws://localhost:${port}`;
console.log(`[recorder] Connecting to ${url}...`);
console.log(`[recorder] Output: ${outputPath}`);
console.log(`[recorder] Duration: ${duration > 0 ? `${duration} minutes` : 'until Ctrl+C'}`);
console.log(`[recorder] Sample interval: ${interval}ms`);
console.log('');

const ws = new WebSocket(url);

ws.on('open', () => {
  connected = true;
  console.log(`[recorder] Connected. Recording started.`);

  // Request full state on connect
  ws.send(JSON.stringify({ type: 'getState' }));

  // Set up duration timer
  if (duration > 0) {
    setTimeout(() => {
      console.log(`\n[recorder] Duration reached (${duration}m). Stopping...`);
      ws.close();
      finish();
    }, duration * 60 * 1000);
  }
});

ws.on('message', (raw) => {
  try {
    const msg = JSON.parse(raw.toString());

    if (msg.type === 'levels') {
      latestLevels = msg.levels || null;
      latestAnalysis = msg.analysis || latestAnalysis;
      latestAutomation = msg.automation || latestAutomation;
      latestMasterFX = msg.masterFX || latestMasterFX;
      latestLiveEffects = msg.liveEffects || latestLiveEffects;
      writeSample();
    }

    if (msg.type === 'status' || msg.type === 'fullState') {
      latestStatus = {
        running: msg.running ?? msg.status?.running,
        currentChord: msg.currentChord,
        currentSection: msg.currentSection,
        currentTempo: msg.currentTempo,
        currentRule: msg.currentRule,
        engine: msg.engine,
        song: msg.song,
        mixer: msg.mixer,
      };
    }
  } catch {
    // ignore malformed messages
  }
});

ws.on('close', () => {
  if (connected) {
    console.log(`[recorder] WebSocket closed.`);
    finish();
  }
});

ws.on('error', (err) => {
  if (!connected) {
    console.error(`[recorder] Cannot connect to ${url}`);
    console.error(`  Is the app running? (npm start)`);
    process.exit(1);
  }
  console.error(`[recorder] WebSocket error:`, err.message);
});

// Ctrl+C graceful shutdown
process.on('SIGINT', () => {
  console.log(`\n[recorder] Interrupted. Saving...`);
  ws.close();
  finish();
});
