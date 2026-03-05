/**
 * Buffer manager for SuperCollider.
 *
 * Allocates buffer numbers, loads sample files into scsynth via OSC,
 * and tracks which buffers are in use for cleanup.
 *
 * Buffer number allocation:
 *   0–99    : Reserved / system
 *   100+    : Dynamically allocated by this module
 *
 * Sample loading strategies:
 *   - 72-note instrument sets (Lead, Bass): loaded at startup or on swap
 *   - Texture samples: loaded on-demand (one at a time)
 *   - Archive/Freesound: downloaded to temp files, loaded into buffers
 */

import path from 'path';
import fs from 'fs';
import os from 'os';
import { bufferAllocRead, bufferAllocReadChannel, bufferFree, bufferQuery } from './osc.js';

let nextBufNum = 100;

// Active buffer sets: Map<string, Map<string, number>>
// e.g. 'malechoirlong' → Map('C1' → 100, 'C#1' → 101, ...)
const instrumentBuffers = new Map();

// Single buffers: Map<string, number>
// e.g. 'texture_current' → 200
const namedBuffers = new Map();

// All allocated buffer numbers for cleanup
const allocatedBuffers = new Set();

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/**
 * Allocates a buffer number.
 * @returns {number}
 */
export function allocBufNum() {
  const num = nextBufNum++;
  allocatedBuffers.add(num);
  return num;
}

/**
 * Resolves the absolute path to a sample file.
 * @param {string} relativePath - Path relative to project root's samples/ dir
 * @returns {string}
 */
function resolveSamplePath(relativePath) {
  return path.resolve(process.cwd(), 'samples', relativePath);
}

/**
 * Loads a 72-note instrument sample set into scsynth buffers.
 *
 * @param {string} instrumentId - Unique instrument identifier
 * @param {string} folder - Folder path relative to samples/
 * @param {string} filePrefix - Filename prefix (e.g. 'malechoirlong')
 * @returns {Promise<Map<string, number>>} Map of note name → buffer number
 */
export async function loadInstrumentSamples(instrumentId, folder, filePrefix) {
  // If already loaded, return existing
  if (instrumentBuffers.has(instrumentId)) {
    return instrumentBuffers.get(instrumentId);
  }

  const noteBuffers = new Map();
  const loadPromises = [];
  let fileIndex = 1;

  for (let octave = 1; octave <= 6; octave++) {
    for (let note = 0; note < 12; note++) {
      const noteName = `${NOTE_NAMES[note]}${octave}`;
      const padded = String(fileIndex).padStart(2, '0');
      const filename = `${filePrefix}${padded}.wav`;
      const filePath = resolveSamplePath(path.join(folder, filename));

      // Only load if file exists
      if (fs.existsSync(filePath)) {
        const bufNum = allocBufNum();
        noteBuffers.set(noteName, bufNum);

        // Force mono loading — \sampleLoop and \sampleOneShot expect 1-channel buffers.
        loadPromises.push(
          bufferAllocReadChannel(bufNum, filePath, [0]).catch(err => {
            console.warn(`[bufferManager] Failed to load ${filePath}: ${err.message}`);
            noteBuffers.delete(noteName);
            allocatedBuffers.delete(bufNum);
          })
        );
      }

      fileIndex++;
    }
  }

  await Promise.all(loadPromises);

  instrumentBuffers.set(instrumentId, noteBuffers);
  console.log(`[bufferManager] Loaded ${noteBuffers.size} samples for "${instrumentId}"`);
  return noteBuffers;
}

/**
 * Frees all buffers for an instrument set.
 * @param {string} instrumentId
 */
export function freeInstrumentSamples(instrumentId) {
  const noteBuffers = instrumentBuffers.get(instrumentId);
  if (!noteBuffers) return;

  for (const bufNum of noteBuffers.values()) {
    bufferFree(bufNum);
    allocatedBuffers.delete(bufNum);
  }

  instrumentBuffers.delete(instrumentId);
  console.log(`[bufferManager] Freed samples for "${instrumentId}"`);
}

/**
 * Loads a single audio file into a named buffer slot.
 * Frees the previous buffer in that slot if one exists.
 *
 * @param {string} name - Slot name (e.g. 'texture_current')
 * @param {string} filePath - Absolute path to the audio file
 * @returns {Promise<{ bufNum: number, numChannels: number }>}
 */
export async function loadNamedBuffer(name, filePath) {
  // Free previous buffer in this slot
  freeNamedBuffer(name);

  const bufNum = allocBufNum();
  await bufferAllocRead(bufNum, filePath);
  namedBuffers.set(name, bufNum);

  // Query channel count so callers can pick the right SynthDef
  const info = await bufferQuery(bufNum);
  return { bufNum, numChannels: info.numChannels };
}

/**
 * Frees a named buffer slot.
 * @param {string} name
 */
export function freeNamedBuffer(name) {
  const bufNum = namedBuffers.get(name);
  if (bufNum !== undefined) {
    bufferFree(bufNum);
    allocatedBuffers.delete(bufNum);
    namedBuffers.delete(name);
  }
}

/**
 * Gets the buffer number for a named slot.
 * @param {string} name
 * @returns {number|undefined}
 */
export function getNamedBuffer(name) {
  return namedBuffers.get(name);
}

/**
 * Gets the note→bufNum map for a loaded instrument.
 * @param {string} instrumentId
 * @returns {Map<string, number>|undefined}
 */
export function getInstrumentBuffers(instrumentId) {
  return instrumentBuffers.get(instrumentId);
}

/**
 * Creates a temporary file path for downloaded audio.
 * @param {string} [ext='wav'] - File extension
 * @returns {string}
 */
export function tempAudioPath(ext = 'wav') {
  const tmpDir = path.join(os.tmpdir(), 'constant-ambient');
  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
  }
  return path.join(tmpDir, `audio_${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`);
}

/**
 * Downloads an audio file from a URL to a temp path.
 * @param {string} url
 * @returns {Promise<string>} Absolute path to the downloaded file
 */
export async function downloadAudioToTemp(url) {
  const ext = url.match(/\.(mp3|ogg|wav|flac)(\?|$)/i)?.[1] || 'mp3';
  const tmpPath = tempAudioPath(ext);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} fetching ${url}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  fs.writeFileSync(tmpPath, Buffer.from(arrayBuffer));

  return tmpPath;
}

/**
 * Frees all allocated buffers and resets state.
 */
export function freeAllBuffers() {
  for (const bufNum of allocatedBuffers) {
    bufferFree(bufNum);
  }
  allocatedBuffers.clear();
  instrumentBuffers.clear();
  namedBuffers.clear();
  nextBufNum = 100;
  console.log('[bufferManager] All buffers freed');
}
