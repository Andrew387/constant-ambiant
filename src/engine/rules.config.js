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

/**
 * Song structure section durations, measured in loop passes
 * (one pass = one complete play-through of the chord progression).
 */
export const SECTION_DURATIONS = {
  transition: 4,
  intro: 4,
  main: 4,
  innerTransition: 1,
  main2: 4,
  outro: 2,
};

/**
 * Per-section probability (0–1) that any individual chord in a progression
 * is skipped (silence instead of playing). Evaluated once per chord per play.
 * Sections not listed default to 0 (no skipping).
 */
export const CHORD_SKIP_PROBABILITY = {
  transition: 0.30,
  intro: 0.20,
  outro: 0.10,
};

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
