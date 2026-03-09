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
 *
 * Section-specific config (durations, skip probabilities, hold thresholds)
 * is centralized in sections.config.js.
 */

// Re-export section config so existing imports from rules.config.js still work
export { SECTION_DURATIONS, CHORD_SKIP_PROBABILITY } from './sections.config.js';

/** Minor keys the engine can land on (matches taste-profile MINOR_KEYS) */
export const DARK_ROOTS = ['C', 'G', 'D', 'A', 'E', 'F', 'Bb', 'Eb', 'Ab'];

/**
 * Per-track flag: should held notes be released when a chord is skipped?
 * true = release on skip (creates breathing space),
 * false = sustain through skip (continuous pad/drone).
 */
export const TRACK_SKIP_RELEASE = {
  lead: true,
  drone: false,
  bassSupport: false,
};

/** Humanization: random timing offset range in seconds (±half this value). */
export const HUMANIZE_RANGE = 0.06; // ±30ms

/** Minimum envelope time in seconds (prevents clicks from zero-length envelopes). */
export const ENVELOPE_FLOOR = 0.01;

/** Texture player tuning. */
export const TEXTURE_CONFIG = {
  count: 79,
  playbackRate: 1.5,
  loopStart: 1.0,
  loopEnd: 13.0,
  attackTime: 4.0,
  releaseTime: 4.0,
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
