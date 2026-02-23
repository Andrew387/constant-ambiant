import * as Tone from 'tone';
import { createReverb } from './reverb.js';
import { createDelay } from './delay.js';
import { createFilter } from './filter.js';

let chain = null;

/**
 * Builds and returns the master effects chain.
 * Signal flow: input → filter → delay → reverb → Tone.Destination
 *
 * @returns {{ input: Tone.ToneAudioNode, dispose: Function }}
 *   input: the node synths/mixer should connect to
 */
export async function buildEffectsChain() {
  const { filter, lfo } = createFilter();
  const delay = createDelay();
  const reverb = createReverb();

  // Reverb needs to generate its impulse response
  await reverb.generate();

  // Chain: filter → delay → reverb → destination
  filter.connect(delay);
  delay.connect(reverb);
  reverb.toDestination();

  chain = { filter, lfo, delay, reverb };

  return {
    input: filter,
    dispose() {
      lfo.stop();
      lfo.dispose();
      filter.dispose();
      delay.dispose();
      reverb.dispose();
      chain = null;
    },
  };
}

export function getEffectsChain() {
  return chain;
}
