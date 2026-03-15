/**
 * Constant Ambient - Node.js + SuperCollider server
 * with a lightweight web UI for debug / control.
 *
 * Single command to boot everything:
 *   node src/main.js
 *
 * This will:
 *   1. Find and launch sclang (which boots scsynth)
 *   2. Wait for scsynth to be ready (SynthDefs, groups, buses)
 *   3. Connect to scsynth via OSC
 *   4. Start the generative engine
 *   5. Start the web UI at http://localhost:4000
 *
 * Environment variables:
 *   SCLANG_PATH  - Path to sclang binary (auto-detected if not set)
 *   SC_PORT      - scsynth UDP port (default 57110)
 *   PORT         - Web UI port (default 4000)
 */

import { initOSC, closeOSC, sync, startHealthCheck, stopHealthCheck, resetHealthCheckFailures } from './sc/osc.js';
import { bootSuperCollider, killSuperCollider } from './sc/boot.js';
import { initMixer, setMasterVolume, setTrackVolume, getMixerState } from './audio/mixer.js';
import { start, stop, updateRules, getConfig, getEngineState } from './engine/ruleEngine.js';
import { getSongState } from './engine/songStructure.js';
import { startArchiveLayer, stopArchiveLayer } from './archive/player.js';
import { startFreesoundLayer, stopFreesoundLayer } from './freesound/player.js';
import { startServer, stopServer, broadcast, sendTo } from './server.js';
import {
  LEAD_INSTRUMENTS, BASS_INSTRUMENTS,
} from './audio/synths/sampleRegistry.js';
import { getAutomationState } from './audio/effects/sectionAutomation.js';
import { getEffectChainInfo } from './audio/effects/trackEffects.js';
import { resetBufferState } from './sc/bufferManager.js';
import { resetNodeIds } from './sc/nodeIds.js';

let mixer = null;
let isRunning = false;
let levelPollTimer = null;

// Keep a reference to the real console.log before we intercept it
const _origLog = console.log.bind(console);

// Global debug state - slider values that persist across play/stop
const debugState = {
  chordDuration: null,
  attackLevel: null,
  releaseLevel: null,
  droneVolume: null,
  leadVolume: null,
  archiveVolume: null,
  freesoundVolume: null,
  sampleTextureVolume: null,
};

// Status state pushed to the UI
const status = {
  running: false,
  currentChord: '',
  currentSection: '',
  currentTempo: 0,
  currentRule: '',
  archiveStatus: 'Waiting...',
  freesoundStatus: 'Waiting...',
};

/* ------------------------------------------------------------------ */
/*  Boot                                                               */
/* ------------------------------------------------------------------ */

const WEB_PORT = parseInt(process.env.PORT || '4000', 10);

async function boot() {
  _origLog('');
  _origLog('  Constant Ambient - Generative Audio Server');
  _origLog('  Node.js + SuperCollider');
  _origLog('');

  // 1. Start web UI server (can start before SC is ready)
  await startServer({ port: WEB_PORT, onMessage: handleWSMessage });

  // 2. Boot SuperCollider (sclang + scsynth)
  _origLog('[boot] Starting SuperCollider...');
  try {
    await bootSuperCollider({ timeout: 45000, verbose: true });
  } catch (err) {
    _origLog('[boot] Failed to boot SuperCollider:', err.message);
    _origLog('[boot] Make sure SuperCollider is installed.');
    _origLog('[boot]   macOS: /Applications/SuperCollider.app');
    _origLog('[boot]   Or set SCLANG_PATH=/path/to/sclang');
    process.exit(1);
  }
  _origLog('[boot] SuperCollider is ready.');

  // 3. Connect to scsynth via OSC
  _origLog('[boot] Connecting to scsynth via OSC...');
  await initOSC();
  await waitForScsynth();

  // 4. Initialize mixer (creates all SC synth nodes)
  _origLog('[boot] Initializing mixer...');
  try {
    mixer = await initMixer();
  } catch (err) {
    _origLog('[boot] Mixer initialization failed:', err);
    process.exit(1);
  }

  // 5. Install the log interceptor (captures engine state for UI)
  installLogInterceptor();

  // 6. Start SC health check (periodic /sync ping + /status query)
  startHealthCheck({
    interval: 15000,
    async onDead() {
      _origLog('[WARN] scsynth appears dead after 3 failed pings — attempting recovery...');
      await recoverSuperCollider();
    },
    async onSleepWake() {
      // Always do a full recovery after sleep/wake. Even if scsynth is
      // still responding (sclang may have auto-rebooted it), all our
      // synth nodes, effect chains, and buffers are gone from the fresh
      // server. Trying to detect "is it OK?" is unreliable and the cost
      // of a full recovery (~3s of silence) is much lower than getting
      // stuck in a broken state with no sound.
      _origLog('[recovery] System woke from sleep — performing full recovery...');
      await recoverSuperCollider();
    },
  });

  // 7. Start the generative engine
  _origLog('[boot] Starting generative engine...');
  startEngine();

  _origLog('');
  _origLog('  -----------------------------------------------');
  _origLog('  Server running. Audio is flowing through scsynth.');
  _origLog(`  UI at http://localhost:${WEB_PORT}`);
  _origLog('  Press Ctrl+C to stop gracefully.');
  _origLog('  -----------------------------------------------');
  _origLog('');
}

/* ------------------------------------------------------------------ */
/*  SuperCollider recovery                                             */
/* ------------------------------------------------------------------ */

let recovering = false;

async function recoverSuperCollider() {
  if (recovering) return;
  recovering = true;
  try {
    stopEngine();
    if (mixer) { mixer.dispose(); mixer = null; }
    closeOSC();
    killSuperCollider();

    // Reset JS-side state that was tied to the old scsynth process.
    // The server lost all buffers and nodes on crash — our tracking is stale.
    resetBufferState();
    resetNodeIds();

    await sleep(2000);

    await bootSuperCollider({ timeout: 45000, verbose: true });
    _origLog('[recovery] SuperCollider rebooted.');
    await initOSC();
    await waitForScsynth();

    mixer = await initMixer();
    _origLog('[recovery] Mixer re-initialized. Restarting engine...');
    startEngine();
    resetHealthCheckFailures();
    _origLog('[recovery] Engine restarted successfully.');
  } catch (err) {
    _origLog('[recovery] Failed to recover:', err.message);
  } finally {
    recovering = false;
  }
}

/* ------------------------------------------------------------------ */
/*  Engine start / stop                                                */
/* ------------------------------------------------------------------ */

function startEngine() {
  if (isRunning) return;

  start(mixer.synths, mixer.texturePlayer, {
    chordTriggers: mixer.chordTriggers,
    onSwapLead: mixer.swapLeadRandom,
    onSwapBass: mixer.swapBassRandom,
    onSwapPedalPad: mixer.swapPedalPadRandom,
    onSwapBassSupport: mixer.swapBassSupportRandom,
    onRandomizeMasterEffects: mixer.randomizeMasterEffects,
    onRandomizeTrackEffects: mixer.randomizeTrackEffects,
  });
  isRunning = true;
  status.running = true;
  applyDebugOverrides();

  const config = getConfig();
  if (config.archiveEnabled) startArchiveLayer();
  if (config.freesoundEnabled) startFreesoundLayer();

  startLevelPolling();
  broadcastStatus();
}

function stopEngine() {
  if (!isRunning) return;
  stop();
  stopArchiveLayer();
  stopFreesoundLayer();
  stopLevelPolling();
  isRunning = false;
  status.running = false;
  status.currentChord = '';
  status.currentSection = '';
  broadcastStatus();
}

let lastDiagnosticLog = 0;
const DIAGNOSTIC_INTERVAL = 30000; // log bus levels every 30s

function startLevelPolling() {
  if (levelPollTimer) return;
  levelPollTimer = setInterval(async () => {
    if (!mixer) return;
    const levels = await mixer.pollLevels();
    if (levels) {
      const automation = getAutomationState();
      const masterFX = mixer.getMasterEffectsState();
      broadcast({ type: 'levels', levels, automation, masterFX });

      // Periodic diagnostic: log bus signal levels to console
      const now = Date.now();
      if (now - lastDiagnosticLog >= DIAGNOSTIC_INTERVAL) {
        lastDiagnosticLog = now;
        const parts = Object.entries(levels).map(([name, { db }]) =>
          `${name}:${db > -100 ? db.toFixed(1) : '---'}dB`
        );
        _origLog(`[meters] ${parts.join('  ')}`);
      }
    }
  }, 150);
}

function stopLevelPolling() {
  if (levelPollTimer) {
    clearInterval(levelPollTimer);
    levelPollTimer = null;
  }
}

/* ------------------------------------------------------------------ */
/*  WebSocket message handler                                          */
/* ------------------------------------------------------------------ */

function handleWSMessage(ws, msg) {
  switch (msg.type) {
    case 'start':
      if (!isRunning && mixer) startEngine();
      break;
    case 'stop':
      stopEngine();
      break;
    case 'masterVolume':
      setMasterVolume(msg.value);
      break;
    case 'param':
      handleParamChange(msg.param, msg.value);
      break;
    case 'swapLead':
      if (mixer) mixer.swapLead(msg.instrumentId).then(() => updateRules({}));
      break;
    case 'swapBass':
      if (mixer) mixer.swapBass(msg.instrumentId).then(() => updateRules({}));
      break;
    case 'getState':
      sendTo(ws, {
        type: 'fullState',
        status,
        config: getConfig(),
        debugState,
        instruments: { lead: LEAD_INSTRUMENTS, bass: BASS_INSTRUMENTS },
        engine: isRunning ? getEngineState() : null,
        song: isRunning ? getSongState() : null,
        mixer: isRunning ? getMixerState() : null,
        effectChains: getEffectChainInfo(),
      });
      break;
    default:
      _origLog('[server] unknown message type:', msg.type);
  }
}

/* ------------------------------------------------------------------ */
/*  Parameter changes from the debug UI                                */
/* ------------------------------------------------------------------ */

function handleParamChange(param, value) {
  if (param in debugState) debugState[param] = value;

  switch (param) {
    case 'chordDuration':       updateRules({ chordDuration: value }); break;
    case 'attackLevel':         updateRules({ attackLevel: value });   break;
    case 'releaseLevel':        updateRules({ releaseLevel: value });  break;
    case 'droneVolume':         setTrackVolume('drone', value);         break;
    case 'leadVolume':          setTrackVolume('lead', value);          break;
    case 'archiveVolume':       setTrackVolume('archive', value);       break;
    case 'freesoundVolume':     setTrackVolume('freesound', value);     break;
    case 'sampleTextureVolume': setTrackVolume('sampleTexture', value); break;
    default: _origLog('[main] unknown param:', param);
  }
}

function applyDebugOverrides() {
  const ruleOverrides = {};
  if (debugState.chordDuration !== null) ruleOverrides.chordDuration = debugState.chordDuration;
  if (debugState.attackLevel !== null)   ruleOverrides.attackLevel   = debugState.attackLevel;
  if (debugState.releaseLevel !== null)  ruleOverrides.releaseLevel  = debugState.releaseLevel;
  if (Object.keys(ruleOverrides).length > 0) updateRules(ruleOverrides);

  if (debugState.droneVolume !== null)         setTrackVolume('drone', debugState.droneVolume);
  if (debugState.leadVolume !== null)          setTrackVolume('lead', debugState.leadVolume);
  if (debugState.archiveVolume !== null)       setTrackVolume('archive', debugState.archiveVolume);
  if (debugState.freesoundVolume !== null)     setTrackVolume('freesound', debugState.freesoundVolume);
  if (debugState.sampleTextureVolume !== null) setTrackVolume('sampleTexture', debugState.sampleTextureVolume);
}

/* ------------------------------------------------------------------ */
/*  Status broadcasting                                                */
/* ------------------------------------------------------------------ */

function broadcastStatus() {
  broadcast({
    type: 'status',
    ...status,
    engine: isRunning ? getEngineState() : null,
    song: isRunning ? getSongState() : null,
    mixer: isRunning ? getMixerState() : null,
  });
}

export function updateStatus(key, value) {
  status[key] = value;
  broadcastStatus();
}

/**
 * Intercepts console.log to capture engine state for the UI.
 * Installed after boot so boot messages go through normally.
 */
function installLogInterceptor() {
  console.log = function (...args) {
    _origLog.apply(console, args);
    const msg = args.join(' ');

    // Forward every log line to the UI
    broadcast({ type: 'log', text: msg });

    if (msg.includes('[loop]') && msg.includes('new progression')) {
      status.currentChord = msg.replace(/\[loop\][^a-zA-Z]*new progression[^a-zA-Z]*/, '').trim();
      broadcastStatus();
    }
    if (msg.includes('[structure]')) {
      status.currentSection = msg.replace(/\[structure\]\s*/, '').trim();
      broadcastStatus();
    }
    if (msg.includes('bpm')) {
      const m = msg.match(/(\d+)\s*bpm/);
      if (m) { status.currentTempo = Number(m[1]); broadcastStatus(); }
    }
    if (msg.includes('[chordRule]')) {
      status.currentRule = msg.replace(/\[chordRule\]\s*/, '').trim();
      broadcastStatus();
    }
    if (msg.includes('[archive]')) {
      status.archiveStatus = msg.replace(/\[archive\]\s*/, '').trim();
      broadcastStatus();
    }
    if (msg.includes('[freesound]')) {
      status.freesoundStatus = msg.replace(/\[freesound\]\s*/, '').trim();
      broadcastStatus();
    }
  };
}

/* ------------------------------------------------------------------ */
/*  Graceful shutdown                                                  */
/* ------------------------------------------------------------------ */

let shuttingDown = false;

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log = _origLog;
  console.log('\n[shutdown] Stopping...');

  stopEngine();
  stopHealthCheck();
  if (mixer) { mixer.dispose(); mixer = null; }

  await sleep(300);
  closeOSC();
  stopServer();

  // Shut down SuperCollider
  killSuperCollider();

  console.log('[shutdown] Clean shutdown complete.');
}

process.on('SIGINT',  async () => { await shutdown(); process.exit(0); });
process.on('SIGTERM', async () => { await shutdown(); process.exit(0); });
process.on('uncaughtException', (err) => {
  _origLog('[FATAL] Uncaught exception:', err);
  shutdown().then(() => process.exit(1));
});
process.on('unhandledRejection', (reason) => {
  _origLog('[WARN] Unhandled promise rejection:', reason);
});
process.on('exit', () => {
  // Last-resort cleanup: if disposeMixer wasn't called, at least attempt it
  if (mixer && !shuttingDown) {
    try { mixer.dispose(); } catch {}
    mixer = null;
  }
});

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function waitForScsynth(retries = 10, interval = 1000) {
  for (let i = 0; i < retries; i++) {
    try {
      await sync(2000);
      _origLog('[boot] scsynth is responding via OSC.');
      return;
    } catch {
      _origLog(`[boot] Waiting for scsynth OSC... (${i + 1}/${retries})`);
      await sleep(interval);
    }
  }
  throw new Error('scsynth not responding via OSC after boot.');
}

// Boot
boot().catch(err => { _origLog('[boot] Fatal error:', err); process.exit(1); });
