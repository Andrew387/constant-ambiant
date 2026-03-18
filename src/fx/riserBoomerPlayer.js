/**
 * Riser-Boomer FX layer.
 *
 * Every 20–30 seconds, picks a random riser and a random boomer from
 * samples/FX/, loads both into SC buffers, and plays them via a single
 * \riserBoomer SynthDef that handles sample-accurate back-to-back
 * sequencing entirely on the server — no JavaScript setTimeout timing.
 *
 * Stereo 48 kHz samples. Played via the \riserBoomer SynthDef.
 */

import path from 'path';
import { synthNew } from '../sc/osc.js';
import { allocNodeId, GROUPS, BUSES } from '../sc/nodeIds.js';
import { loadNamedBuffer, freeNamedBuffer } from '../sc/bufferManager.js';

// ── Collection definitions ───────────────────────────────────────────────────
const RISER_COLLECTIONS = [
  { folder: path.join('FX', 'Riser', 'FX Riser'), prefix: 'FX Riser', count: 70 },
];

const BOOMER_COLLECTIONS = [
  { folder: path.join('FX', 'Boomer', 'FX boomer '), prefix: 'FX Boomer', count: 70 },
];

// Per-buffer amp and lowpass (passed to \riserBoomer SynthDef)
const RISER_LP_FREQ = 1500;
const RISER_AMP = 0.12;
const BOOMER_LP_FREQ = 2500;
const BOOMER_AMP = 0.2;

// Total pair duration + margin for reverb tail.
const DISPOSE_DELAY_S = 20;

// ── Base interval (ms) — used for main sections ──
const BASE_MIN_MS = 20000;
const BASE_MAX_MS = 30000;

// ── Interval multipliers by section type ──
// < 1 = faster (more frequent), 1 = base rate
const SECTION_SPEED = {
  transition:      0.45,   // ~9–14 s
  innerTransition: 0.45,
  intro:           0.65,   // ~13–20 s
  outro:           0.65,
  main:            1.0,    // 20–30 s (base)
  main2:           1.0,
};
const DEFAULT_SPEED = 1.0;

// Multiplicative speed boosts for plucked lead (stacks with section)
const PLUCKED_SPEED = 0.80;                // 20% faster
const PLUCKED_SIMULTANEOUS_SPEED = 0.60;   // 40% faster

let isActive = false;
let triggerTimer = null;
let totalPlayed = 0;
let activeRiser = null;
let activeBoomer = null;
let leadPlucked = false;
let _getCurrentSection = () => ({ type: 'main' });
let _getCurrentRule = () => 'complete-simultaneous';
const pendingTimers = new Set();
const activeSlots = new Set();

/**
 * Computes the current interval range [min, max] in ms.
 */
function getInterval() {
  const section = _getCurrentSection();
  let speed = SECTION_SPEED[section?.type] ?? DEFAULT_SPEED;

  if (leadPlucked) {
    const rule = _getCurrentRule();
    const isSimultaneous = rule.includes('simultaneous');
    speed *= isSimultaneous ? PLUCKED_SIMULTANEOUS_SPEED : PLUCKED_SPEED;
  }

  return {
    min: BASE_MIN_MS * speed,
    max: BASE_MAX_MS * speed,
  };
}

function pickCollection(collections) {
  return collections[Math.floor(Math.random() * collections.length)];
}

function samplePath(collection, num) {
  const nn = String(num).padStart(2, '0');
  return path.resolve(process.cwd(), 'samples', collection.folder, `${collection.prefix}${nn}.wav`);
}

function randIndex(collection) {
  return Math.floor(Math.random() * collection.count) + 1;
}

/**
 * Plays one riser-boomer pair via a single SC synth node.
 */
async function playPair() {
  if (!isActive) return;

  const riserNum = randIndex(activeRiser);
  const boomerNum = randIndex(activeBoomer);
  const ts = Date.now();

  try {
    const riserSlot = `riser_${ts}_${riserNum}`;
    const boomerSlot = `boomer_${ts}_${boomerNum}`;

    // Load both buffers in parallel
    const [riserBuf, boomerBuf] = await Promise.all([
      loadNamedBuffer(riserSlot, samplePath(activeRiser, riserNum)),
      loadNamedBuffer(boomerSlot, samplePath(activeBoomer, boomerNum)),
    ]);

    activeSlots.add(riserSlot);
    activeSlots.add(boomerSlot);

    if (!isActive) {
      freeNamedBuffer(riserSlot);
      freeNamedBuffer(boomerSlot);
      activeSlots.delete(riserSlot);
      activeSlots.delete(boomerSlot);
      return;
    }

    // Single synth handles both buffers back-to-back (sample-accurate).
    // Outputs to RISER_BOOMER bus where the sidechain duck reads it as
    // the key signal, then fxTrackOut mixes it into the master bus.
    const nodeId = allocNodeId();
    synthNew('riserBoomer', nodeId, 0, GROUPS.RISER_BOOMER, {
      out: BUSES.RISER_BOOMER,
      riserBuf: riserBuf.bufNum,
      boomerBuf: boomerBuf.bufNum,
      riserAmp: RISER_AMP,
      boomerAmp: BOOMER_AMP,
      riserLpFreq: RISER_LP_FREQ,
      boomerLpFreq: BOOMER_LP_FREQ,
    });

    totalPlayed++;
    console.log(`[riserBoomer] #${totalPlayed}: ${activeRiser.prefix} ${riserNum} → ${activeBoomer.prefix} ${boomerNum}`);

    // Free buffers after synth self-frees (6+6+0.5s synth life + safety margin)
    const cleanupTimer = setTimeout(() => {
      pendingTimers.delete(cleanupTimer);
      freeNamedBuffer(riserSlot);
      freeNamedBuffer(boomerSlot);
      activeSlots.delete(riserSlot);
      activeSlots.delete(boomerSlot);
    }, DISPOSE_DELAY_S * 1000);
    pendingTimers.add(cleanupTimer);

  } catch (err) {
    console.warn('[riserBoomer] playPair error:', err.message);
  }

  scheduleNext();
}

function scheduleNext() {
  if (!isActive) return;
  const { min, max } = getInterval();
  const delay = min + Math.random() * (max - min);
  triggerTimer = setTimeout(playPair, delay);
}

/**
 * Updates the lead plucked state so fire probability adjusts accordingly.
 * Called by ruleEngine after instrument swaps.
 * @param {boolean} plucked
 */
export function setRiserBoomerLeadPlucked(plucked) {
  leadPlucked = plucked;
}

/**
 * Starts the riser-boomer FX layer.
 * @param {object} [deps] — Optional dependency injection for engine state
 * @param {function} [deps.getCurrentSection] — Returns current song section
 * @param {function} [deps.getCurrentRule] — Returns current chord playing rule
 */
export function startRiserBoomerLayer(deps = {}) {
  if (isActive) return;
  if (deps.getCurrentSection) _getCurrentSection = deps.getCurrentSection;
  if (deps.getCurrentRule) _getCurrentRule = deps.getCurrentRule;
  isActive = true;
  totalPlayed = 0;
  activeRiser = pickCollection(RISER_COLLECTIONS);
  activeBoomer = pickCollection(BOOMER_COLLECTIONS);
  console.log(`[riserBoomer] Starting — riser: "${activeRiser.prefix}" (${activeRiser.count}), boomer: "${activeBoomer.prefix}" (${activeBoomer.count})`);
  triggerTimer = setTimeout(playPair, 3000);
}

/**
 * Stops the riser-boomer FX layer.
 */
export function stopRiserBoomerLayer() {
  isActive = false;

  if (triggerTimer) {
    clearTimeout(triggerTimer);
    triggerTimer = null;
  }

  for (const timer of pendingTimers) {
    clearTimeout(timer);
  }
  pendingTimers.clear();

  for (const slot of activeSlots) {
    freeNamedBuffer(slot);
  }
  activeSlots.clear();
  leadPlucked = false;
}
