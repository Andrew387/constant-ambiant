import * as Tone from 'tone';

/**
 * Creates a long-tail reverb effect for ambient wash.
 * Uses Tone.Reverb with extended decay and pre-delay.
 *
 * @returns {Tone.Reverb}
 */
export function createReverb() {
  const reverb = new Tone.Reverb({
    decay: 14,
    preDelay: 0.3,
    wet: 0.65,
  });
  return reverb;
}
