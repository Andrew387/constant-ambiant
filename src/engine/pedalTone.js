/**
 * Pedal tone system.
 *
 * Finds a single note that sounds good across an entire chord progression
 * and plays it on a sample-based pad synth as a sustained bridge between
 * song cycles.
 *
 * Lifecycle per cycle:
 *   1. Previous song's outro begins → pre-generate next progression,
 *      find pedal note, start playing with slow attack.
 *   2. New song's transition begins → pedal is at full volume.
 *   3. Random moment during intro or main1 → release and stop.
 */

const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT_TO_SHARP = { 'Eb': 'D#', 'Ab': 'G#', 'Bb': 'A#' };

function normalizePC(pc) {
  return FLAT_TO_SHARP[pc] || pc;
}

function noteIndex(note) {
  return NOTES.indexOf(normalizePC(note));
}

function transpose(note, semitones) {
  const idx = noteIndex(note);
  return NOTES[((idx + semitones) % 12 + 12) % 12];
}

let pedalSynth = null;
let fadeOutTimer = null;
let active = false;

/**
 * Assigns the sample synth used for pedal tones.
 */
export function setPedalSynth(synth) {
  pedalSynth = synth;
}

/**
 * Finds the single pitch class that appears in the most chords of a
 * progression. Ties are broken by preferring the key root, then the 5th.
 *
 * @param {Array} chords - Array of chord objects with `notes` (e.g. ['C4', 'Eb4', 'G4'])
 * @param {string} keyRoot - Root pitch class of the key (e.g. 'C')
 * @returns {string} Best pedal pitch class (e.g. 'G')
 */
export function findPedalNote(chords, keyRoot) {
  const pcRegex = /^([A-G]#?)(\d+)$/;

  // Count how many chords contain each pitch class
  const counts = {};
  for (const chord of chords) {
    const seen = new Set();
    for (const note of chord.notes) {
      const match = note.match(pcRegex);
      if (!match) continue;
      const pc = normalizePC(match[1]);
      if (!seen.has(pc)) {
        counts[pc] = (counts[pc] || 0) + 1;
        seen.add(pc);
      }
    }
  }

  const maxCount = Math.max(...Object.values(counts));
  const candidates = Object.entries(counts)
    .filter(([, count]) => count === maxCount)
    .map(([pc]) => pc);

  // Prefer root, then 5th of the key
  const normalRoot = normalizePC(keyRoot);
  if (candidates.includes(normalRoot)) return normalRoot;
  const fifth = transpose(keyRoot, 7);
  if (candidates.includes(fifth)) return fifth;

  return candidates[0];
}

/**
 * Starts the pedal tone. Called when entering the outro section.
 * The sample synth's attack envelope handles the fade-in.
 *
 * @param {string} pedalPC - Pitch class to play (e.g. 'G')
 * @param {number} fadeInSec - Duration for the attack envelope (roughly the outro length)
 */
export function startPedalFadeIn(pedalPC, fadeInSec) {
  if (!pedalSynth) return;
  stopPedal();

  // Play in octave 3 for a warm low pad
  const note = `${pedalPC}3`;

  // Set very slow attack so the note swells in over the outro
  pedalSynth.updateEnvelopes(fadeInSec, 1.0, 1.0);
  pedalSynth.playChord([note]);

  active = true;
  console.log(`[pedal] fade-in started: ${note} over ${fadeInSec.toFixed(0)}s`);
}

/**
 * Called when the new cycle starts (transition section begins).
 * The pedal is now at full volume. Schedules a random fade-out sometime
 * during intro or main1.
 *
 * @param {number} transitionSec - Duration of the transition section in seconds
 * @param {number} introSec - Duration of the intro section in seconds
 * @param {number} mainSec - Duration of the main section in seconds
 */
export function schedulePedalFadeOut(transitionSec, introSec, mainSec) {
  if (!active || !pedalSynth) return;

  // Random fade-out start: somewhere from mid-intro to mid-main1
  const earliestOffset = transitionSec + introSec * 0.3;
  const latestOffset = transitionSec + introSec + mainSec * 0.5;
  const fadeOutAt = earliestOffset + Math.random() * (latestOffset - earliestOffset);

  fadeOutTimer = setTimeout(() => {
    fadeOutTimer = null;
    if (!active || !pedalSynth) return;
    console.log(`[pedal] fading out`);
    pedalSynth.releaseAll();
    active = false;
  }, fadeOutAt * 1000);

  console.log(`[pedal] fade-out scheduled in ${fadeOutAt.toFixed(0)}s`);
}

/**
 * Immediately stops the pedal tone and clears any pending fade-out.
 */
export function stopPedal() {
  if (fadeOutTimer) {
    clearTimeout(fadeOutTimer);
    fadeOutTimer = null;
  }
  if (active && pedalSynth) {
    pedalSynth.releaseAll();
  }
  active = false;
}

export function isPedalActive() {
  return active;
}
