import scales from './scales.js';

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/**
 * Converts a MIDI-style note number to a Tone.js note string.
 * @param {number} midi - semitone offset where C0 = 0
 * @returns {string} e.g. "C3", "F#4"
 */
function midiToNote(midi) {
  const octave = Math.floor(midi / 12);
  const name = NOTE_NAMES[((midi % 12) + 12) % 12];
  return `${name}${octave}`;
}

/**
 * Resolves a root note name to its pitch-class index (0–11).
 * @param {string} root - e.g. "C", "F#", "Bb"
 * @returns {number}
 */
function rootToIndex(root) {
  const normalized = root.replace('b', '').length < root.length
    ? NOTE_NAMES[(NOTE_NAMES.indexOf(root.replace('b', '')) - 1 + 12) % 12]
    : root;
  const idx = NOTE_NAMES.indexOf(normalized);
  if (idx === -1) throw new Error(`Unknown root note: ${root}`);
  return idx;
}

/**
 * Chord-type definitions as arrays of scale-degree indices (0-based).
 * For types that add extensions beyond the scale length, raw semitone
 * offsets from the root are used via a different path.
 */
const CHORD_DEGREES = {
  unison:     [0],
  fifth:      [0, 4],           // root + 5th degree (index 4 in 7-note scale)
  triad:      [0, 2, 4],        // root, 3rd, 5th
  seventh:    [0, 2, 4, 6],     // root, 3rd, 5th, 7th
  ninth:      [0, 2, 4, 6, 1],  // root, 3rd, 5th, 7th, 9th (2nd degree up an octave)
  eleventh:   [0, 2, 4, 6, 1, 3], // root, 3rd, 5th, 7th, 9th, 11th
  thirteenth: [0, 2, 4, 6, 1, 3, 5], // root, 3rd, 5th, 7th, 9th, 11th, 13th
  suspended2: [0, 1, 4],        // root, 2nd, 5th
  suspended4: [0, 3, 4],        // root, 4th, 5th
  add9:       [0, 2, 4, 1],     // root, 3rd, 5th, 9th (2nd degree up an octave)
  add11:      [0, 2, 4, 3],     // root, 3rd, 5th, 11th
  add9add11:  [0, 2, 4, 1, 3],  // root, 3rd, 5th, 9th, 11th
};

/**
 * Builds a chord from a root note, scale, chord type, and base octave.
 *
 * @param {string} root - Root note name, e.g. "C", "F#"
 * @param {string} scaleKey - Key into scales.js, e.g. "major", "dorian"
 * @param {string} chordType - One of the CHORD_DEGREES keys
 * @param {number} [octave=3] - Base octave for the chord
 * @returns {string[]} Array of Tone.js note strings, e.g. ["C3", "E3", "G3"]
 */
export function buildChord(root, scaleKey, chordType, octave = 3) {
  const scale = scales[scaleKey];
  if (!scale) throw new Error(`Unknown scale: ${scaleKey}`);

  const degrees = CHORD_DEGREES[chordType];
  if (!degrees) throw new Error(`Unknown chord type: ${chordType}`);

  const rootIdx = rootToIndex(root);
  const intervals = scale.intervals;

  // Collect the "stacked" degrees (0,2,4,6) vs "extension" degrees (1,3,5) that
  // should be voiced an octave up to avoid cluster voicings
  const stackedOrder = [0, 2, 4, 6];
  const notes = degrees.map((deg) => {
    const isExtension = !stackedOrder.includes(deg) && degrees.length > 3;
    const octaveOffset = isExtension ? 1 : 0;

    const semitone = intervals[deg % intervals.length]
      + 12 * Math.floor(deg / intervals.length);

    const midi = rootIdx + octave * 12 + semitone + octaveOffset * 12;
    return midiToNote(midi);
  });

  return notes;
}

/**
 * Builds a diatonic chord on a given scale degree.
 *
 * Unlike buildChord (which always builds from a single root), this function
 * picks notes from the scale starting at the given degree — so the chord
 * quality emerges naturally from the scale (e.g. degree 2 in major → minor,
 * degree 4 → major, degree 7 → diminished).
 *
 * @param {string} keyRoot - Key center note, e.g. "C"
 * @param {string} scaleKey - Key into scales.js, e.g. "major", "dorian"
 * @param {number} degree - Scale degree (1-based: 1–7)
 * @param {string} chordType - One of the CHORD_DEGREES keys
 * @param {number} [octave=3] - Base octave for the chord
 * @returns {string[]} Array of Tone.js note strings
 */
export function buildDiatonicChord(keyRoot, scaleKey, degree, chordType, octave = 3) {
  const scale = scales[scaleKey];
  if (!scale) throw new Error(`Unknown scale: ${scaleKey}`);

  const chordDegs = CHORD_DEGREES[chordType];
  if (!chordDegs) throw new Error(`Unknown chord type: ${chordType}`);

  const rootIdx = rootToIndex(keyRoot);
  const intervals = scale.intervals;
  const scaleLen = intervals.length;

  // degree is 1-based → convert to 0-based offset into the scale
  const degreeOffset = (degree - 1) % scaleLen;

  const stackedOrder = [0, 2, 4, 6];
  const notes = chordDegs.map((deg) => {
    const isExtension = !stackedOrder.includes(deg) && chordDegs.length > 3;
    const extOctave = isExtension ? 1 : 0;

    // Walk up the scale from the degree offset
    const scalePos = degreeOffset + deg;
    const octaveWrap = Math.floor(scalePos / scaleLen);
    const semitone = intervals[scalePos % scaleLen] + 12 * octaveWrap;

    const midi = rootIdx + octave * 12 + semitone + extOctave * 12;
    return midiToNote(midi);
  });

  return notes;
}
