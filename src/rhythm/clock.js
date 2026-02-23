import * as Tone from 'tone';

/**
 * Wraps Tone.Transport for BPM and meter management.
 *
 * IMPORTANT: Tone.Transport uses two distinct time domains:
 *   - Transport time: seconds since Transport.start(), used for scheduling
 *   - Audio-context time (Tone.now()): absolute time, used for synth triggers
 * Transport callbacks receive audio-context time, but scheduleOnce/schedule
 * expect Transport time. Never mix them.
 */

/** The BPM we intend to be at (ignoring any in-progress ramp). */
let _targetBpm = 120;

/**
 * Sets the BPM instantly (no ramp). Use at startup or when the Transport
 * is stopped so the first scheduled events see the correct tempo.
 * @param {number} bpm
 */
export function setTempoImmediate(bpm) {
  _targetBpm = bpm;
  Tone.getTransport().bpm.value = bpm;
}

/**
 * Ramps the BPM smoothly over `rampSeconds`. Use for live tempo changes
 * while the Transport is running.
 * @param {number} bpm
 * @param {number} [rampSeconds=4]
 */
export function rampTempo(bpm, rampSeconds = 4) {
  _targetBpm = bpm;
  Tone.getTransport().bpm.rampTo(bpm, rampSeconds);
}

/**
 * Returns the target BPM (what we're aiming for), not the current mid-ramp
 * value. Use this for duration calculations so they're always stable.
 * @returns {number}
 */
export function getTargetBpm() {
  return _targetBpm;
}

/**
 * Returns the live BPM (may be mid-ramp).
 * @returns {number}
 */
export function getLiveBpm() {
  return Tone.getTransport().bpm.value;
}

/**
 * Returns the current Transport position in seconds.
 * @returns {number}
 */
export function getTransportSeconds() {
  return Tone.getTransport().seconds;
}

/**
 * Whether the Transport is currently running.
 * @returns {boolean}
 */
export function isTransportRunning() {
  return Tone.getTransport().state === 'started';
}

/**
 * Sets the time signature.
 * @param {number} numerator
 * @param {number} [denominator=4]
 */
export function setMeter(numerator, denominator = 4) {
  Tone.getTransport().timeSignature = [numerator, denominator];
}

/**
 * Starts the transport.
 */
export function startClock() {
  Tone.getTransport().start();
}

/**
 * Stops the transport, cancels all scheduled events, resets position.
 */
export function stopClock() {
  Tone.getTransport().stop();
  Tone.getTransport().cancel();
  Tone.getTransport().position = 0;
}
