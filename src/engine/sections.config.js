/**
 * Centralized section configuration.
 *
 * Single source of truth for all section-related metadata:
 * types, durations, hold thresholds, skip probabilities, and track gating.
 *
 * Every module that needs section info should import from here
 * instead of hardcoding section names.
 */

/**
 * Section types in playback order.
 * Adding a new section = add an entry here and all downstream
 * modules automatically pick it up.
 */
export const SECTIONS = [
  {
    type: 'transition',
    duration: 4,           // loop passes
    holdUntil: 0,          // automation hold threshold (0–1)
    chordSkipProbability: 0.30,
    tracks: { drone: true, bassSupport: true, archive: true, freesound: true, lead: true, leadReversed: true },
  },
  {
    type: 'intro',
    duration: 4,
    holdUntil: 0.5,
    chordSkipProbability: 0.20,
    tracks: { drone: true, bassSupport: true, archive: true, freesound: true, lead: true, leadReversed: true },
  },
  {
    type: 'main',
    duration: 4,
    holdUntil: 0.8,
    chordSkipProbability: 0,
    tracks: { drone: true, bassSupport: true, archive: true, freesound: true, lead: true, leadReversed: true },
  },
  {
    type: 'innerTransition',
    duration: 1,
    holdUntil: 0,
    chordSkipProbability: 0,
    tracks: { drone: true, bassSupport: true, archive: true, freesound: true, lead: true, leadReversed: true },
  },
  {
    type: 'main2',
    duration: 4,
    holdUntil: 0.8,
    chordSkipProbability: 0,
    tracks: { drone: true, bassSupport: true, archive: true, freesound: true, lead: true, leadReversed: true },
  },
  {
    type: 'outro',
    duration: 2,
    holdUntil: 0.4,
    chordSkipProbability: 0,
    tracks: { drone: true, bassSupport: true, archive: true, freesound: true, lead: true, leadReversed: true },
  },
];

/** Section order index lookup (for fast comparison). */
export const SECTION_ORDER = Object.fromEntries(
  SECTIONS.map((s, i) => [s.type, i])
);

/** Duration lookup by section type. */
export const SECTION_DURATIONS = Object.fromEntries(
  SECTIONS.map(s => [s.type, s.duration])
);

/** Hold threshold lookup by section type. */
export const SECTION_HOLD_UNTIL = Object.fromEntries(
  SECTIONS.map(s => [s.type, s.holdUntil])
);

/** Chord skip probability lookup by section type. */
export const CHORD_SKIP_PROBABILITY = Object.fromEntries(
  SECTIONS.filter(s => s.chordSkipProbability > 0).map(s => [s.type, s.chordSkipProbability])
);

// ── Dynamic duration scaling ──

const BASE_DURATIONS = SECTIONS.map(s => s.duration);
const REFERENCE_CHORD_DURATION = 1.0;

/**
 * Scales section durations inversely with chord duration.
 * Longer chords → fewer loops; short chords stay at base (cap).
 * Mutates SECTIONS[].duration and SECTION_DURATIONS in place.
 *
 * @param {number} chordDuration — current chord duration in measures
 */
export function scaleSectionDurations(chordDuration) {
  const ratio = REFERENCE_CHORD_DURATION / chordDuration;

  SECTIONS.forEach((section, i) => {
    const base = BASE_DURATIONS[i];
    const scaled = Math.max(1, Math.min(base, Math.round(base * ratio)));
    section.duration = scaled;
    SECTION_DURATIONS[section.type] = scaled;
  });

  const summary = SECTIONS.map(s => `${s.type}:${s.duration}`).join(', ');
  console.log(`[song] section durations scaled (chord ${chordDuration.toFixed(2)}m) → ${summary}`);
}
