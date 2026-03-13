/**
 * Freesound SFX layer — SuperCollider playback.
 *
 * Downloads short SFX from Freesound, saves to temp files, loads into
 * SC buffers, and plays through the \sfxPlayer SynthDef.
 *
 * Each sound gets its own buffer + synth node. The synth self-frees
 * when the buffer finishes playing (doneAction: 2 on PlayBuf).
 */

import { getRandomSound, getCacheSize } from './fetcher.js';
import { synthNew } from '../sc/osc.js';
import { allocNodeId, GROUPS, BUSES } from '../sc/nodeIds.js';
import {
  loadNamedBuffer, freeNamedBuffer, downloadAudioToTemp,
} from '../sc/bufferManager.js';
import fs from 'fs';

let isActive = false;
let triggerTimer = null;
let totalPlayed = 0;
let activeSlots = []; // Track buffer slot names for cleanup
const pendingFrees = new Set();

const MIN_INTERVAL_MS = 2000;
const MAX_INTERVAL_MS = 10000;
const DISPOSE_DELAY = 25; // seconds after play before freeing buffer

/**
 * Plays a single sound effect through SuperCollider.
 */
async function playSoundEffect() {
  if (!isActive) return;

  try {
    const sound = await getRandomSound();
    if (!sound || !isActive) {
      scheduleNext();
      return;
    }

    console.log(`[freesound] Loading: "${sound.name}"`);

    // Download to temp file
    const tmpPath = await downloadAudioToTemp(sound.previewUrl);

    if (!isActive) {
      try { fs.unlinkSync(tmpPath); } catch {}
      return;
    }

    // Load into SC buffer
    const slotName = `freesound_${Date.now()}_${sound.id}`;
    const { bufNum } = await loadNamedBuffer(slotName, tmpPath, { mono: true });
    activeSlots.push(slotName);

    // Clean up temp file
    try { fs.unlinkSync(tmpPath); } catch {}

    if (!isActive) {
      freeNamedBuffer(slotName);
      return;
    }

    const defName = 'sfxPlayer';
    const nodeId = allocNodeId();
    synthNew(defName, nodeId, 0, GROUPS.FREESOUND, {
      out: BUSES.FREESOUND,
      buf: bufNum,
      amp: 0.15,
      lpFreq: 2500,
    });

    totalPlayed++;
    console.log(`[freesound] Playing: "${sound.name}" (total: ${totalPlayed})`);

    // Free buffer after sound + reverb tail finishes, guarded against double-free
    pendingFrees.add(slotName);
    setTimeout(() => {
      pendingFrees.delete(slotName);
      freeNamedBuffer(slotName);
      activeSlots = activeSlots.filter(s => s !== slotName);
    }, DISPOSE_DELAY * 1000);

  } catch (err) {
    console.warn('[freesound] playSoundEffect error:', err.message);
  }

  scheduleNext();
}

function scheduleNext() {
  if (!isActive) return;
  const delay = MIN_INTERVAL_MS + Math.random() * (MAX_INTERVAL_MS - MIN_INTERVAL_MS);
  triggerTimer = setTimeout(playSoundEffect, delay);
}

/**
 * Starts the Freesound SFX layer.
 */
export function startFreesoundLayer() {
  if (isActive) return;
  isActive = true;
  totalPlayed = 0;

  console.log('[freesound] Starting...');
  triggerTimer = setTimeout(playSoundEffect, 3000);
}

/**
 * Stops the Freesound SFX layer.
 */
export function stopFreesoundLayer() {
  isActive = false;

  if (triggerTimer) {
    clearTimeout(triggerTimer);
    triggerTimer = null;
  }

  // Free all active buffers not already pending a delayed free
  for (const slotName of activeSlots) {
    if (!pendingFrees.has(slotName)) {
      freeNamedBuffer(slotName);
    }
  }
  activeSlots = [];
}
