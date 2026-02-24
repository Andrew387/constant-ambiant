/**
 * Configuration for the generative engine.
 *
 * Locked to a dark / sad / epic minor aesthetic.
 * The engine rotates between minor scales each cycle for variety,
 * but the mood is always dark.
 *
 * chordDuration = number of measures (in 4/4) between chord triggers.
 * Actual seconds are derived from BPM: measures * 4 * (60 / bpm).
 * Synth envelopes scale proportionally to the computed duration in seconds,
 * so consecutive chords naturally overlap and crossfade at any tempo.
 */

/** Minor keys the engine can land on (matches taste-profile MINOR_KEYS) */
export const DARK_ROOTS = ['C', 'G', 'D', 'A', 'E', 'F', 'Bb', 'Eb', 'Ab'];

const rulesConfig = {
  tempo: {
    min: 45,
    max: 72,
    current: 56,
  },

  rootNote: 'C',

  /** Number of 4/4 measures between chord triggers */
  chordDuration: 2,

  /** Envelope multipliers (0 = instant, 1.0 = default proportional scaling) */
  attackLevel: 1.0,
  releaseLevel: 1.0,

  /** Whether to enable Archive.org ambient texture layer */
  archiveEnabled: true,

  /** Whether to enable Freesound SFX layer */
  freesoundEnabled: true,
};

export default rulesConfig;
