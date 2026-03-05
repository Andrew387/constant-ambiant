/**
 * Archive.org ambient texture layer — SuperCollider playback.
 *
 * Downloads audio from Archive.org, saves to temp files, loads into
 * SC buffers, and plays through the \archiveGrain SynthDef for
 * 800% time-stretch granular processing.
 *
 * Crossfades between tracks using gate-based release envelopes.
 */

import { fetchRandomArchiveAudio, getCacheSize } from './fetcher.js';
import { synthNew, nodeSet, nodeFree } from '../sc/osc.js';
import { allocNodeId, GROUPS, BUSES } from '../sc/nodeIds.js';
import {
  loadNamedBuffer, freeNamedBuffer, downloadAudioToTemp,
} from '../sc/bufferManager.js';
import fs from 'fs';

let activeTrack = null;
let pendingTrack = null;
let isActive = false;
let crossfadeTimer = null;
const pendingFrees = new Set();

const CROSSFADE_DURATION = 12; // seconds
const LOAD_RETRIES = 3;
const LOAD_RETRY_DELAY_MS = 3000;

/**
 * Loads a track: fetch URL → download to temp → load into SC buffer.
 * Does NOT start playback.
 */
async function loadTrack() {
  for (let attempt = 1; attempt <= LOAD_RETRIES; attempt++) {
    try {
      const result = await fetchRandomArchiveAudio();
      if (!result) {
        if (attempt < LOAD_RETRIES) {
          await new Promise(r => setTimeout(r, LOAD_RETRY_DELAY_MS));
        }
        continue;
      }

      const { url, title } = result;

      // Download audio to temp file
      const tmpPath = await downloadAudioToTemp(url);

      // Load into SC buffer — MUST be mono for GrainBuf
      const slotName = `archive_${Date.now()}`;
      const { bufNum, numFrames } = await loadNamedBuffer(slotName, tmpPath, { mono: true });

      // Clean up temp file after loading
      try { fs.unlinkSync(tmpPath); } catch {}

      if (numFrames === 0) {
        console.warn(`[archive] buffer loaded with 0 frames — skipping "${title}"`);
        freeNamedBuffer(slotName);
        continue;
      }

      return { bufNum, slotName, title };
    } catch (err) {
      console.warn(`[archive] load attempt ${attempt} failed:`, err.message);
      if (attempt < LOAD_RETRIES) {
        await new Promise(r => setTimeout(r, LOAD_RETRY_DELAY_MS));
      }
    }
  }

  console.warn('[archive] all load attempts failed');
  return null;
}

/**
 * Starts playback of a loaded track via the \archiveGrain SynthDef.
 */
function startPlayback(track) {
  const nodeId = allocNodeId();

  synthNew('archiveGrain', nodeId, 0, GROUPS.ARCHIVE, {
    out: BUSES.ARCHIVE,
    buf: track.bufNum,
    gate: 1,
    amp: 3,
    grainDur: 0.5,
    grainRate: 0.125,
    overlap: 0.15,
    hpFreq: 250,
    lpFreq: 3500,
    atkTime: CROSSFADE_DURATION,
    relTime: CROSSFADE_DURATION,
  });

  track.nodeId = nodeId;
  console.log(`[archive] Playing: ${track.title}`);
}

/**
 * Fades out and disposes a track.
 */
function fadeOutAndDispose(track) {
  if (!track) return;

  if (track.nodeId) {
    nodeSet(track.nodeId, { gate: 0 });
  }

  // Free the buffer after the release tail completes, guarded against double-free
  const slotName = track.slotName;
  if (pendingFrees.has(slotName)) return;
  pendingFrees.add(slotName);

  setTimeout(() => {
    pendingFrees.delete(slotName);
    freeNamedBuffer(slotName);
  }, (CROSSFADE_DURATION + 2) * 1000);
}

/**
 * Pre-fetches the next track while the current one plays.
 */
async function prefetchNext() {
  if (!isActive || pendingTrack) return;

  console.log('[archive] Pre-loading next track...');
  const track = await loadTrack();
  if (!track || !isActive) return;

  pendingTrack = track;
  console.log(`[archive] Next ready: ${track.title}`);
}

/**
 * Crossfades from active to pending, then pre-fetches another.
 */
function crossfade() {
  if (!isActive) return;

  if (activeTrack) {
    fadeOutAndDispose(activeTrack);
    activeTrack = null;
  }

  if (pendingTrack) {
    activeTrack = pendingTrack;
    pendingTrack = null;
    startPlayback(activeTrack);
  } else {
    // No pending track ready — load one now
    loadTrack().then(track => {
      if (!track || !isActive) return;
      activeTrack = track;
      startPlayback(activeTrack);
      prefetchNext();
    });
  }

  prefetchNext();
  scheduleCrossfade();
}

function scheduleCrossfade() {
  if (!isActive) return;
  const delay = 90000 + Math.random() * 78000; // 1.5–2.8 min
  crossfadeTimer = setTimeout(() => crossfade(), delay);
}

/**
 * Starts the Archive.org ambient texture layer.
 */
export async function startArchiveLayer() {
  if (isActive) return;
  isActive = true;

  console.log('[archive] Starting...');

  const track = await loadTrack();
  if (!track || !isActive) {
    console.warn('[archive] failed to load first track, retrying...');
    setTimeout(() => {
      if (isActive) {
        isActive = false;
        startArchiveLayer();
      }
    }, 10000);
    return;
  }

  activeTrack = track;
  startPlayback(activeTrack);

  prefetchNext();
  scheduleCrossfade();
}

/**
 * Stops the archive layer.
 */
export function stopArchiveLayer() {
  isActive = false;

  if (crossfadeTimer) {
    clearTimeout(crossfadeTimer);
    crossfadeTimer = null;
  }

  if (activeTrack) {
    fadeOutAndDispose(activeTrack);
    activeTrack = null;
  }
  if (pendingTrack) {
    if (!pendingFrees.has(pendingTrack.slotName)) {
      freeNamedBuffer(pendingTrack.slotName);
    }
    pendingTrack = null;
  }
}
