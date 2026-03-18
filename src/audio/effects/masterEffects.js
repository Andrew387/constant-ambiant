/**
 * Master effects — reverb, delay, and filter LFO on the master bus.
 *
 * Three in-place effect synths are created on BUSES.MASTER (bus 2) at the
 * head of GROUPS.MASTER, so they process audio BEFORE the masterOut synth.
 *
 * All parameters use Lag3 (8s ramp) in their SynthDefs so changes are
 * always smooth, never abrupt. Per-song randomization picks new wet/dry
 * values at each cycle start.
 *
 * Signal chain on master bus:
 *   [track outputs + reverb returns] → fxMasterLPFLfo → fxMasterDelay → fxMasterReverb → masterOut
 */

import { synthNew, nodeSet, nodeFree } from '../../sc/osc.js';
import { allocNodeId, GROUPS, BUSES } from '../../sc/nodeIds.js';

// ── Randomization ranges ──

const RANGES = {
  reverb: {
    wet:   { min: 0.10, max: 0.40 },
    decay: { min: 8,    max: 18 },
    damp:  { min: 0.15, max: 0.40 },
  },
  delay: {
    wet:       { min: 0.05, max: 0.40 },
    delayTime: { min: 0.8,  max: 2.5 },
    feedback:  { min: 0.25, max: 0.55 },
  },
  filter: {
    depth:      { min: 0.0,  max: 0.55 },
    lfoRate:    { min: 0.01, max: 0.07 },
    centerFreq: { min: 3000, max: 12000 },
  },
};

function rand(range) {
  return range.min + Math.random() * (range.max - range.min);
}

// ── State ──

let reverbNodeId = null;
let delayNodeId = null;
let filterNodeId = null;
let currentParams = null;

/**
 * Creates the three master effect synths on the master bus.
 * Must be called BEFORE the masterOut synth is created so the
 * effects process audio first (head of GROUPS.MASTER).
 *
 * Initial state: conservative defaults (low wet, no filter movement)
 * so the first cycle start can smoothly ramp to the randomized values.
 */
export function initMasterEffects() {
  // Order matters: filter first (head), then delay, then reverb.
  // Since we add at HEAD of master group, we add in reverse order
  // so the final execution order is: filter → delay → reverb → masterOut.

  reverbNodeId = allocNodeId();
  synthNew('fxMasterReverb', reverbNodeId, 0, GROUPS.MASTER, {
    bus: BUSES.MASTER,
    wet: 0.08,
    decay: 18,
    damp: 0.2,
    lagTime: 8,
  });

  delayNodeId = allocNodeId();
  synthNew('fxMasterDelay', delayNodeId, 0, GROUPS.MASTER, {
    bus: BUSES.MASTER,
    wet: 0.05,
    delayTime: 1.5,
    feedback: 0.35,
    maxDelay: 6,
    lagTime: 8,
  });

  filterNodeId = allocNodeId();
  synthNew('fxMasterLPFLfo', filterNodeId, 0, GROUPS.MASTER, {
    bus: BUSES.MASTER,
    centerFreq: 8000,
    lfoRate: 0.03,
    depth: 0.0,
    rq: 0.85,
    lagTime: 8,
  });

  currentParams = {
    reverb: { wet: 0.08, decay: 12, damp: 0.3 },
    delay:  { wet: 0.05, delayTime: 1.5, feedback: 0.35 },
    filter: { depth: 0.0, lfoRate: 0.03, centerFreq: 8000 },
  };

  console.log('[masterFX] initialized — reverb, delay, filter LFO on master bus');
}

/**
 * Randomizes master effect parameters for a new song cycle.
 * All changes are smoothed by Lag3 (8s) in the SynthDefs.
 */
export function randomizeMasterEffects() {
  if (!reverbNodeId) return;

  const reverb = {
    wet:   rand(RANGES.reverb.wet),
    decay: rand(RANGES.reverb.decay),
    damp:  rand(RANGES.reverb.damp),
  };

  const delay = {
    wet:       rand(RANGES.delay.wet),
    delayTime: rand(RANGES.delay.delayTime),
    feedback:  rand(RANGES.delay.feedback),
  };

  const filter = {
    depth:      rand(RANGES.filter.depth),
    lfoRate:    rand(RANGES.filter.lfoRate),
    centerFreq: rand(RANGES.filter.centerFreq),
  };

  nodeSet(reverbNodeId, reverb);
  nodeSet(delayNodeId, { wet: delay.wet, delayTime: delay.delayTime, feedback: delay.feedback });
  nodeSet(filterNodeId, { depth: filter.depth, lfoRate: filter.lfoRate, centerFreq: filter.centerFreq });

  currentParams = { reverb, delay, filter };

  console.log(
    `[masterFX] randomized — ` +
    `reverb wet:${reverb.wet.toFixed(2)} decay:${reverb.decay.toFixed(1)}s ` +
    `| delay wet:${delay.wet.toFixed(2)} time:${delay.delayTime.toFixed(1)}s fb:${delay.feedback.toFixed(2)} ` +
    `| filter depth:${filter.depth.toFixed(2)} rate:${filter.lfoRate.toFixed(3)}Hz center:${Math.round(filter.centerFreq)}Hz`
  );
}

/**
 * Returns current master effect parameters for the debug UI.
 */
export function getMasterEffectsState() {
  return currentParams;
}

/**
 * Disposes all master effect synths.
 */
export function disposeMasterEffects() {
  if (reverbNodeId) { nodeFree(reverbNodeId); reverbNodeId = null; }
  if (delayNodeId)  { nodeFree(delayNodeId);  delayNodeId = null; }
  if (filterNodeId) { nodeFree(filterNodeId);  filterNodeId = null; }
  currentParams = null;
}
