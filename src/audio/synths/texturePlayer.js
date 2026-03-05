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
import { synthNew, nodeSet } from '../../sc/osc.js';
import { allocNodeId, GROUPS, BUSES } from '../../sc/nodeIds.js';
import { loadNamedBuffer, freeNamedBuffer } from '../../sc/bufferManager.js';
import { TEXTURE_CONFIG } from '../../engine/rules.config.js';

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
  let swapGeneration = 0; // incremented on each swap/stop to invalidate stale loads

  async function loadAndStart(excludeIndex, generation) {
    const { filePath, index } = pickRandomTexture(excludeIndex);

    const label = path.basename(filePath);

    if (!fs.existsSync(filePath)) {
      console.warn(`[texturePlayer] File not found: ${filePath}`);
      return;
    }

    console.log(`[texturePlayer] loading ${label}`);

    try {
      const { bufNum, numChannels } = await loadNamedBuffer('texture_current', filePath);

      // If another swap/stop occurred while loading, discard this result
      if (generation !== swapGeneration) return;
      if (bufNum === undefined) return;

      currentIndex = index;

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
      freeNamedBuffer('texture_current');
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
