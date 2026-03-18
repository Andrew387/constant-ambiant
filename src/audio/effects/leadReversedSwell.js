/**
 * Lead Reversed — dramatic swell timer.
 *
 * The leadReversed track plays continuously but is held at gain 0
 * (complete silence) by a swellGain node. At random intervals (10–20 s),
 * this module simultaneously:
 *   1. Opens the lowpass filter (200 Hz → 6000–12000 Hz)
 *   2. Ramps the gain up (0 → 1.0)
 *
 * Both nodes use Lag3 (lagTime 1.5 s ≈ 4.5 s to 95%) creating a slow,
 * dramatic rise. After holding at peak for 0.3–1 s, both are snapped
 * back to closed state, producing a wave-like swell that slowly rises
 * from silence, reveals full bright harmonics, then slowly fades away.
 */

import { nodeSet } from '../../sc/osc.js';

const CLOSED_FREQ = 200;         // Lowpass frequency when closed
const OPEN_FREQ_MIN = 12000;     // Swell minimum reveal frequency
const OPEN_FREQ_MAX = 18000;     // Swell maximum — full brightness
const CLOSED_GAIN = 0;           // Gain when closed (absolute silence)
const OPEN_GAIN = 0.8;           // Gain at swell peak
const SWELL_INTERVAL_MIN = 15;   // Minimum seconds between swells
const SWELL_INTERVAL_MAX = 30;   // Maximum seconds between swells
const HOLD_MIN = 0.3;            // Minimum hold at peak (seconds)
const HOLD_MAX = 1.0;            // Maximum hold at peak (seconds)

let filterNodeId = null;
let gainNodeId = null;
let swellTimeoutId = null;
let holdTimeoutId = null;
let running = false;

function scheduleNextSwell() {
  if (!running) return;
  const interval = SWELL_INTERVAL_MIN + Math.random() * (SWELL_INTERVAL_MAX - SWELL_INTERVAL_MIN);
  swellTimeoutId = setTimeout(doSwell, interval * 1000);
}

function doSwell() {
  if (!running || !filterNodeId || !gainNodeId) return;

  // Open both filter and gain simultaneously
  const openFreq = OPEN_FREQ_MIN + Math.random() * (OPEN_FREQ_MAX - OPEN_FREQ_MIN);
  nodeSet(filterNodeId, { freq: openFreq });
  nodeSet(gainNodeId, { gain: OPEN_GAIN });
  console.log(`[leadReversed] swell → ${Math.round(openFreq)} Hz, gain ${OPEN_GAIN}`);

  // Hold at peak, then close back down
  const hold = HOLD_MIN + Math.random() * (HOLD_MAX - HOLD_MIN);
  holdTimeoutId = setTimeout(() => {
    if (!running) return;
    if (filterNodeId) nodeSet(filterNodeId, { freq: CLOSED_FREQ });
    if (gainNodeId) nodeSet(gainNodeId, { gain: CLOSED_GAIN });
    scheduleNextSwell();
  }, hold * 1000);
}

/**
 * Starts the swell timer for the leadReversed track.
 * @param {number} filterId — SC node ID of the swellFilter effect
 * @param {number} gainId — SC node ID of the swellGain effect
 */
export function startSwellTimer(filterId, gainId) {
  filterNodeId = filterId;
  gainNodeId = gainId;
  running = true;
  scheduleNextSwell();
  console.log('[leadReversed] swell timer started (filter + gain)');
}

/**
 * Stops the swell timer and resets state.
 */
export function stopSwellTimer() {
  running = false;
  if (swellTimeoutId) { clearTimeout(swellTimeoutId); swellTimeoutId = null; }
  if (holdTimeoutId) { clearTimeout(holdTimeoutId); holdTimeoutId = null; }
  filterNodeId = null;
  gainNodeId = null;
}
