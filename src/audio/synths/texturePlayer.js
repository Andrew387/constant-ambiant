/**
 * Texture sample player — OSC wrapper for SuperCollider \sampleLoop SynthDef.
 *
 * Loops a single WAV file from samples/texturesNew/ with the SC-side
 * crossfade engine. One random file per song cycle, crossfaded on swap.
 *
 * Uses the \sampleLoop SynthDef with rate=1.5 for the pitch shift.
 */

import path from 'path';
import fs from 'fs';
import { synthNew, nodeSet, nodeFree } from '../../sc/osc.js';
import { allocNodeId, GROUPS, BUSES } from '../../sc/nodeIds.js';
import { loadNamedBuffer, freeNamedBuffer } from '../../sc/bufferManager.js';
import { TEXTURE_CONFIG } from '../../engine/rules.config.js';

// Delay before freeing old texture buffers (ms).
// Must exceed the longest possible release envelope so the old synth
// finishes reading its buffer before we free it.
const BUFFER_FREE_DELAY = 20000;

const { count: TEXTURE_COUNT, playbackRate: PLAYBACK_RATE,
  loopStart: LOOP_START, loopEnd: LOOP_END,
  attackTime: ATTACK_TIME, releaseTime: RELEASE_TIME } = TEXTURE_CONFIG;

/**
 * Picks a random texture file path.
 * @param {number} [exclude] - Index to avoid
 * @returns {{ filePath: string, index: number }}
 */
function pickRandomTexture(exclude) {
  let idx;
  do {
    idx = Math.floor(Math.random() * TEXTURE_COUNT) + 1;
  } while (idx === exclude && TEXTURE_COUNT > 1);

  const padded = String(idx).padStart(2, '0');
  const filePath = path.resolve(process.cwd(), 'samples', 'texturesNew', `texturesNew${padded}.wav`);
  return { filePath, index: idx };
}

/**
 * Creates a texture sample player.
 *
 * @param {object} [options]
 * @param {number} [options.outBus] - Output bus (default: TEXTURE bus)
 * @returns {{ start, stop, swap, dispose }}
 */
export function createTexturePlayer(options = {}) {
  const outBus = options.outBus ?? BUSES.TEXTURE;

  let currentIndex = null;
  let activeNodeId = null;
  let fadingOutNodeId = null; // node ID of the synth being released (so we can force-free before buffer free)
  let swapGeneration = 0; // incremented on each swap/stop to invalidate stale loads
  let currentSlotName = null; // unique buffer slot name per generation
  const pendingFreeTimers = []; // delayed buffer free timers

  async function loadAndStart(excludeIndex, generation) {
    const { filePath, index } = pickRandomTexture(excludeIndex);

    const label = path.basename(filePath);

    if (!fs.existsSync(filePath)) {
      console.warn(`[texturePlayer] File not found: ${filePath}`);
      return;
    }

    console.log(`[texturePlayer] loading ${label}`);

    try {
      // Use a unique slot name per generation so loading a new buffer
      // does NOT immediately free the old one (which the releasing synth
      // is still reading). The old slot is freed after a delay.
      const oldSlotName = currentSlotName;
      const newSlotName = `texture_${generation}`;

      const { bufNum, numChannels } = await loadNamedBuffer(newSlotName, filePath);

      // If another swap/stop occurred while loading, discard this result
      if (generation !== swapGeneration) {
        // Clean up the buffer we just loaded since it's stale
        freeNamedBuffer(newSlotName);
        return;
      }
      if (bufNum === undefined) return;

      currentSlotName = newSlotName;
      currentIndex = index;

      // Schedule delayed free of the old buffer (after release envelope completes).
      // Force-free the old synth node first so it's guaranteed to stop reading
      // the buffer — prevents "Buffer UGen: no buffer data" if release runs long.
      if (oldSlotName) {
        const oldNodeToFree = fadingOutNodeId;
        fadingOutNodeId = null;
        const tid = setTimeout(() => {
          if (oldNodeToFree !== null) nodeFree(oldNodeToFree);
          freeNamedBuffer(oldSlotName);
        }, BUFFER_FREE_DELAY);
        pendingFreeTimers.push(tid);
      }

      const defName = numChannels >= 2 ? 'sampleLoopStereo' : 'sampleLoop';
      const nodeId = allocNodeId();
      synthNew(defName, nodeId, 0, GROUPS.TEXTURE, {
        out: outBus,
        buf: bufNum,
        gate: 1,
        amp: 1,
        loopStart: LOOP_START,
        loopEnd: LOOP_END,
        atkTime: ATTACK_TIME,
        relTime: RELEASE_TIME,
        rate: PLAYBACK_RATE,
      });
      activeNodeId = nodeId;

      console.log(`[texturePlayer] playing ${label}`);
    } catch (err) {
      console.error(`[texturePlayer] failed to load ${label}:`, err);
    }
  }

  function fadeOutCurrent() {
    if (activeNodeId !== null) {
      nodeSet(activeNodeId, { gate: 0 });
      fadingOutNodeId = activeNodeId;
      activeNodeId = null;
    }
  }

  const api = {
    async start() {
      if (activeNodeId !== null) return;
      const gen = ++swapGeneration;
      await loadAndStart(undefined, gen);
    },

    stop() {
      swapGeneration++; // invalidate any in-flight load
      fadeOutCurrent();
      // Force-free the releasing node before freeing its buffer
      if (fadingOutNodeId !== null) {
        nodeFree(fadingOutNodeId);
        fadingOutNodeId = null;
      }
      // Force-free the active node (fadeOutCurrent set gate=0 but it may still be reading)
      // — handled above via fadingOutNodeId
      // Free current buffer slot
      if (currentSlotName) {
        freeNamedBuffer(currentSlotName);
        currentSlotName = null;
      }
      // Cancel any pending delayed frees
      for (const tid of pendingFreeTimers) clearTimeout(tid);
      pendingFreeTimers.length = 0;
      currentIndex = null;
    },

    async swap() {
      const gen = ++swapGeneration; // invalidate any prior in-flight load
      fadeOutCurrent();
      await loadAndStart(currentIndex, gen);
    },

    dispose() {
      this.stop();
    },
  };

  return api;
}
