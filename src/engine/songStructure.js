/**
 * Song structure state machine.
 *
 * Defines the higher-level form of a song cycle:
 *   transition → intro → main → innerTransition → main2 → outro → (repeat)
 *
 * Each section has a duration measured in "loop passes" — one pass = one
 * complete play-through of the chord progression. A single chord progression
 * is generated at the start of each cycle (transition) and loops through all
 * sections until the next transition generates a fresh one.
 *
 * Sections carry a `tracks` config that gates which instruments are active.
 * For now all tracks are enabled; per-section sound design will be layered
 * on top of this foundation.
 */

import { SECTION_DURATIONS } from './rules.config.js';

// ── Section definitions ──

const SONG_SECTIONS = [
  {
    type: 'transition',
    duration: SECTION_DURATIONS.transition,
    tracks: { pad: true, drone: true, archive: true, freesound: true, choir: true },
  },
  {
    type: 'intro',
    duration: SECTION_DURATIONS.intro,
    tracks: { pad: true, drone: true, archive: true, freesound: true, choir: true },
  },
  {
    type: 'main',
    duration: SECTION_DURATIONS.main,
    tracks: { pad: true, drone: true, archive: true, freesound: true, choir: true },
  },
  {
    type: 'innerTransition',
    duration: SECTION_DURATIONS.innerTransition,
    tracks: { pad: true, drone: true, archive: true, freesound: true, choir: true },
  },
  {
    type: 'main2',
    duration: SECTION_DURATIONS.main2,
    tracks: { pad: true, drone: true, archive: true, freesound: true, choir: true },
  },
  {
    type: 'outro',
    duration: SECTION_DURATIONS.outro,
    tracks: { pad: true, drone: true, archive: true, freesound: true, choir: true },
  },
];

// ── State ──

let currentSectionIndex = 0;
let progressionsInSection = 0;   // loop passes completed in current section
let cycleCount = 0;              // how many full song cycles have completed

/**
 * Resets the song structure to the beginning (first transition).
 */
export function initSongStructure() {
  currentSectionIndex = 0;
  progressionsInSection = 0;
  cycleCount = 0;
  console.log(`[song] ── ${SONG_SECTIONS[0].type} ── (cycle 1)`);
}

/**
 * Returns the current section object.
 * @returns {{ type: string, duration: number, tracks: object }}
 */
export function getCurrentSection() {
  return SONG_SECTIONS[currentSectionIndex];
}

/**
 * Called after each full loop pass (all chords in the progression played once).
 * Increments the progression counter for the current section and advances
 * to the next section when the duration is met.
 *
 * @returns {{ sectionChanged: boolean, isNewCycle: boolean }}
 */
export function advanceSongProgression() {
  progressionsInSection++;

  const section = SONG_SECTIONS[currentSectionIndex];

  if (progressionsInSection < section.duration) {
    return { sectionChanged: false, isNewCycle: false };
  }

  // Section complete — advance to next
  progressionsInSection = 0;
  currentSectionIndex++;

  // Wrap around = new cycle
  const isNewCycle = currentSectionIndex >= SONG_SECTIONS.length;
  if (isNewCycle) {
    currentSectionIndex = 0;
    cycleCount++;
  }

  const newSection = SONG_SECTIONS[currentSectionIndex];
  console.log(
    `[song] ── ${newSection.type} ── ` +
    `(cycle ${cycleCount + 1}, pass ${progressionsInSection + 1}/${newSection.duration})`
  );

  return { sectionChanged: true, isNewCycle };
}

/**
 * Returns the full song state for logging / debug.
 */
export function getSongState() {
  const section = SONG_SECTIONS[currentSectionIndex];
  return {
    section: section.type,
    sectionIndex: currentSectionIndex,
    progressionsInSection,
    sectionDuration: section.duration,
    cycleCount,
    totalSections: SONG_SECTIONS.length,
  };
}
