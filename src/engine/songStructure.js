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
 * Section definitions are centralized in sections.config.js.
 */

import { SECTIONS } from './sections.config.js';

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
  console.log(`[song] ── ${SECTIONS[0].type} ── (cycle 1)`);
}

/**
 * Returns the current section object.
 * @returns {{ type: string, duration: number, tracks: object }}
 */
export function getCurrentSection() {
  return SECTIONS[currentSectionIndex];
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

  const section = SECTIONS[currentSectionIndex];

  if (progressionsInSection < section.duration) {
    return { sectionChanged: false, isNewCycle: false };
  }

  // Section complete — advance to next
  progressionsInSection = 0;
  currentSectionIndex++;

  // Wrap around = new cycle
  const isNewCycle = currentSectionIndex >= SECTIONS.length;
  if (isNewCycle) {
    currentSectionIndex = 0;
    cycleCount++;
  }

  const newSection = SECTIONS[currentSectionIndex];
  console.log(
    `[song] ── ${newSection.type} ── ` +
    `(cycle ${cycleCount + 1}, pass ${progressionsInSection + 1}/${newSection.duration})`
  );

  return { sectionChanged: true, isNewCycle };
}

/**
 * Returns the next section in the cycle (wraps around).
 * @returns {{ type: string, duration: number, tracks: object }}
 */
export function getNextSection() {
  const nextIndex = (currentSectionIndex + 1) % SECTIONS.length;
  return SECTIONS[nextIndex];
}

/**
 * Returns how far through the current section we are (0–1).
 * Coarse resolution: increments per loop pass, not per chord.
 * @returns {number}
 */
export function getSectionProgress() {
  const section = SECTIONS[currentSectionIndex];
  if (section.duration <= 1) return 0.5; // single-pass sections stay at midpoint
  return progressionsInSection / section.duration;
}

/**
 * Returns the full song state for logging / debug.
 */
export function getSongState() {
  const section = SECTIONS[currentSectionIndex];
  return {
    section: section.type,
    sectionIndex: currentSectionIndex,
    progressionsInSection,
    sectionDuration: section.duration,
    cycleCount,
    totalSections: SECTIONS.length,
  };
}
