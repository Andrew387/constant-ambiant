/**
 * Pure JavaScript BPM/tempo management.
 *
 * Replaces Tone.Transport with simple state tracking.
 * In the SC architecture, timing is handled by setTimeout in the
 * ruleEngine — we just need to track the current BPM for duration
 * calculations. No audio-thread transport is needed.
 */

/** The BPM we intend to be at (ignoring any in-progress ramp). */
let _targetBpm = 120;

/** Whether the "clock" is conceptually running. */
let _running = false;

/**
 * Sets the BPM instantly. Use at startup.
 * @param {number} bpm
 */
export function setTempoImmediate(bpm) {
  _targetBpm = bpm;
}

/**
 * Sets the BPM. The next chord event will pick up the new tempo.
 * @param {number} bpm
 */
export function rampTempo(bpm) {
  _targetBpm = bpm;
}

/**
 * Returns the target BPM. Use this for duration calculations.
 * @returns {number}
 */
export function getTargetBpm() {
  return _targetBpm;
}

/**
 * Returns the live BPM (same as target — no ramp in pure JS).
 * @returns {number}
 */
export function getLiveBpm() {
  return _targetBpm;
}

/**
 * Whether the clock is conceptually running.
 * @returns {boolean}
 */
export function isClockRunning() {
  return _running;
}

/**
 * Starts the clock (conceptual — just sets state).
 */
export function startClock() {
  _running = true;
}

/**
 * Stops the clock (conceptual — just sets state).
 */
export function stopClock() {
  _running = false;
}

/**
 * Sets the time signature (no-op in SC architecture,
 * kept for API compatibility).
 * @param {number} numerator
 * @param {number} [denominator=4]
 */
export function setMeter(numerator, denominator = 4) {
  // No-op — SuperCollider doesn't use a transport meter
}
