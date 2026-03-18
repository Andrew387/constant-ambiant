/**
 * Lead Reversed — dramatic swell timer.
 *
 * The leadReversed track plays continuously but is held at gain 0
 * (complete silence) by a swellGain node. At dynamic intervals,
 * this module simultaneously:
 *   1. Opens the lowpass filter (200 Hz → 12000–18000 Hz)
 *   2. Ramps the gain up (0 → 0.8)
 *
 * Both nodes use Lag3 (lagTime 1.5 s ≈ 4.5 s to 95%) creating a slow,
 * dramatic rise. After holding at peak for 0.3–1 s, both are snapped
 * back to closed state, producing a wave-like swell that slowly rises
 * from silence, reveals full bright harmonics, then slowly fades away.
 *
 * Swell frequency is section-aware and influenced by the lead instrument:
 *   - Transitions fire most often (shortest intervals)
 *   - Intro/outro fire frequently
 *   - Main sections use the base interval (15–30 s)
 *   - Plucked lead shortens intervals; plucked + simultaneous rule even more
 */

import { nodeSet } from '../../sc/osc.js';

const CLOSED_FREQ = 200;         // Lowpass frequency when closed
const OPEN_FREQ_MIN = 12000;     // Swell minimum reveal frequency
const OPEN_FREQ_MAX = 18000;     // Swell maximum — full brightness
const CLOSED_GAIN = 0;           // Gain when closed (absolute silence)
const OPEN_GAIN = 0.8;           // Gain at swell peak
const HOLD_MIN = 0.3;            // Minimum hold at peak (seconds)
const HOLD_MAX = 1.0;            // Maximum hold at peak (seconds)

// ── Base interval (seconds) — used for main sections ──
const BASE_MIN = 15;
const BASE_MAX = 30;

// ── Interval multipliers by section type ──
// < 1 = faster (more frequent), 1 = base rate
const SECTION_SPEED = {
  transition:      0.45,   // ~7–14 s
  innerTransition: 0.45,
  intro:           0.65,   // ~10–20 s
  outro:           0.65,
  main:            1.0,    // 15–30 s (base)
  main2:           1.0,
};
const DEFAULT_SPEED = 1.0;

// Multiplicative speed boosts for plucked lead (stacks with section)
const PLUCKED_SPEED = 0.80;                // 20% faster
const PLUCKED_SIMULTANEOUS_SPEED = 0.60;   // 40% faster

let filterNodeId = null;
let gainNodeId = null;
let swellTimeoutId = null;
let holdTimeoutId = null;
let running = false;
let leadPlucked = false;
let _getCurrentSection = () => ({ type: 'main' });
let _getCurrentRule = () => 'complete-simultaneous';

/**
 * Computes the current swell interval range [min, max] in seconds.
 */
function getSwellInterval() {
  const section = _getCurrentSection();
  let speed = SECTION_SPEED[section?.type] ?? DEFAULT_SPEED;

  if (leadPlucked) {
    const rule = _getCurrentRule();
    const isSimultaneous = rule.includes('simultaneous');
    speed *= isSimultaneous ? PLUCKED_SIMULTANEOUS_SPEED : PLUCKED_SPEED;
  }

  return {
    min: BASE_MIN * speed,
    max: BASE_MAX * speed,
  };
}

function scheduleNextSwell() {
  if (!running) return;
  const { min, max } = getSwellInterval();
  const interval = min + Math.random() * (max - min);
  swellTimeoutId = setTimeout(doSwell, interval * 1000);
}

function doSwell() {
  if (!running || !filterNodeId || !gainNodeId) return;

  // Open both filter and gain simultaneously
  const openFreq = OPEN_FREQ_MIN + Math.random() * (OPEN_FREQ_MAX - OPEN_FREQ_MIN);
  nodeSet(filterNodeId, { freq: openFreq });
  nodeSet(gainNodeId, { gain: OPEN_GAIN });
  const section = _getCurrentSection();
  const { min, max } = getSwellInterval();
  console.log(`[leadReversed] swell → ${Math.round(openFreq)} Hz, gain ${OPEN_GAIN} (${section?.type}, interval ${min.toFixed(0)}–${max.toFixed(0)}s)`);

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
 * Updates the lead plucked state so swell probability adjusts accordingly.
 * Called by ruleEngine after instrument swaps.
 * @param {boolean} plucked
 */
export function setLeadPlucked(plucked) {
  leadPlucked = plucked;
}

/**
 * Starts the swell timer for the leadReversed track.
 * @param {number} filterId — SC node ID of the swellFilter effect
 * @param {number} gainId — SC node ID of the swellGain effect
 * @param {object} [deps] — Optional dependency injection for engine state
 * @param {function} [deps.getCurrentSection] — Returns current song section
 * @param {function} [deps.getCurrentRule] — Returns current chord playing rule
 */
export function startSwellTimer(filterId, gainId, deps = {}) {
  filterNodeId = filterId;
  gainNodeId = gainId;
  if (deps.getCurrentSection) _getCurrentSection = deps.getCurrentSection;
  if (deps.getCurrentRule) _getCurrentRule = deps.getCurrentRule;
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
  leadPlucked = false;
}
