import * as Tone from 'tone';

/**
 * Creates a slowly modulated low-pass filter using an LFO.
 * The filter sweeps between ~200 Hz and ~2000 Hz over 20–60 seconds.
 *
 * @returns {{ filter: Tone.Filter, lfo: Tone.LFO }}
 */
export function createFilter() {
  const filter = new Tone.Filter({
    type: 'lowpass',
    frequency: 1200,
    Q: 1,
    rolloff: -12,
  });

  const lfo = new Tone.LFO({
    frequency: 0.025, // ~40 second cycle
    min: 200,
    max: 2000,
    type: 'sine',
  });

  lfo.connect(filter.frequency);
  lfo.start();

  return { filter, lfo };
}
