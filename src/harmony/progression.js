/**
 * Chord progression generator tuned to an emotional, choral minor aesthetic.
 *
 * Uses explicit degree→semitone mapping (Aeolian-based) and role-aware
 * chord coloring. Mostly plain triads with occasional sus2 / add9 for warmth.
 * All patterns start on i so the last chord of one progression can seed
 * the next for smooth chaining.
 */

// --------------------------------------
// BASIC CONFIG
// --------------------------------------

const NOTES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

// Minor keys with emotional / choral flavor
const MINOR_KEYS = ['C', 'G', 'D', 'A', 'E', 'F', 'Bb', 'Eb', 'Ab'];

// Natural minor degrees to semitone offsets
const DEGREE_OFFSETS = {
  'i':    0,
  'bII':  1,
  'ii°':  2,
  'bIII': 3,
  'iii':  4,
  'iv':   5,
  'v':    7,
  'bVI':  8,
  'VI':   9,
  'bVII': 10,
  'VII':  11,
};

// Progression patterns aimed at emotional, clear, "choral" motion.
// Very few chords per progression, lots of i / iv / bVI / bVII / bIII.
const PROGRESSION_PATTERNS = [
  // ── 3-chord ──
  // i – bVI – bVII
  [
    { degree: 'i', quality: 'min', role: 'tonic' },
    { degree: 'bVI', quality: 'maj', role: 'predominant' },
    { degree: 'bVII', quality: 'maj', role: 'predominant' },
  ],
  // i – iv – bVII
  [
    { degree: 'i', quality: 'min', role: 'tonic' },
    { degree: 'iv', quality: 'min', role: 'predominant' },
    { degree: 'bVII', quality: 'maj', role: 'predominant' },
  ],
  // i – bIII – bVI
  [
    { degree: 'i', quality: 'min', role: 'tonic' },
    { degree: 'bIII', quality: 'maj', role: 'tonicLike' },
    { degree: 'bVI', quality: 'maj', role: 'predominant' },
  ],

  // ── 4-chord ──
  // Classic minor hymn feel
  [
    { degree: 'i', quality: 'min', role: 'tonic' },
    { degree: 'bVI', quality: 'maj', role: 'predominant' },
    { degree: 'bVII', quality: 'maj', role: 'predominant' },
    { degree: 'i', quality: 'min', role: 'tonic' },
  ],
  // i – bVII – bIII – bVI (cinematic, simple)
  [
    { degree: 'i', quality: 'min', role: 'tonic' },
    { degree: 'bVII', quality: 'maj', role: 'predominant' },
    { degree: 'bIII', quality: 'maj', role: 'tonicLike' },
    { degree: 'bVI', quality: 'maj', role: 'predominant' },
  ],
  // i – iv – bVI – bVII – i (cinematic 5-chord)
  [
    { degree: 'i', quality: 'min', role: 'tonic' },
    { degree: 'iv', quality: 'min', role: 'predominant' },
    { degree: 'bVI', quality: 'maj', role: 'predominant' },
    { degree: 'bVII', quality: 'maj', role: 'predominant' },
    { degree: 'i', quality: 'min', role: 'tonic' },
  ],
  // i – bIII – bVI – i (gentle and clear)
  [
    { degree: 'i', quality: 'min', role: 'tonic' },
    { degree: 'bIII', quality: 'maj', role: 'tonicLike' },
    { degree: 'bVI', quality: 'maj', role: 'predominant' },
    { degree: 'i', quality: 'min', role: 'tonic' },
  ],
  // i – iv – bVII – i (dorian-ish choir progression)
  [
    { degree: 'i', quality: 'min', role: 'tonic' },
    { degree: 'iv', quality: 'min', role: 'predominant' },
    { degree: 'bVII', quality: 'maj', role: 'predominant' },
    { degree: 'i', quality: 'min', role: 'tonic' },
  ],
];

// Very *simple* colors: no 7ths, 9ths, 11ths, 13ths flying everywhere.
// Mostly plain triads, with occasional sus2 / add9 for emotion.
const MINOR_COLORS = ['', '', '', 'sus2', 'add9']; // mostly plain
const MAJOR_COLORS = ['', '', 'sus2', 'add9'];      // mostly plain

function chance(prob) {
  return Math.random() < prob;
}

// --------------------------------------
// NOTE / CHORD UTILITIES
// --------------------------------------

function noteIndex(note) {
  const idx = NOTES.indexOf(note);
  if (idx === -1) throw new Error(`Unknown note name: ${note}`);
  return idx;
}

function transpose(note, semitones) {
  return NOTES[((noteIndex(note) + semitones) % 12 + 12) % 12];
}

function degreeToNote(keyRoot, degree) {
  const offset = DEGREE_OFFSETS[degree];
  if (offset === undefined) throw new Error(`Unknown degree: ${degree}`);
  return transpose(keyRoot, offset);
}

const FLAT_TO_SHARP = { 'Eb': 'D#', 'Ab': 'G#', 'Bb': 'A#' };

function toToneNote(pitchClass, octave) {
  const name = FLAT_TO_SHARP[pitchClass] || pitchClass;
  return `${name}${octave}`;
}

// Decide how much color to allow based on harmonic role
function pickColorForChord(quality, role) {
  // Tonics can be a bit more expressive (sus2 / add9 sometimes)
  if (role === 'tonic' || role === 'tonicLike') {
    if (quality === 'min') {
      return MINOR_COLORS[Math.floor(Math.random() * MINOR_COLORS.length)];
    }
    if (quality === 'maj') {
      return MAJOR_COLORS[Math.floor(Math.random() * MAJOR_COLORS.length)];
    }
  }

  // Predominants: mostly plain triads, very rarely sus2
  if (role === 'predominant') {
    if (chance(0.15)) return 'sus2';
    return '';
  }

  return '';
}

// Build a choir-friendly chord with Tone.js-compatible note output
function buildChord(root, chordSpec, octave) {
  const { quality, role } = chordSpec;
  const color = pickColorForChord(quality, role || 'tonic');

  let intervals;

  // Base triads
  if (quality === 'min') {
    intervals = [0, 3, 7];
  } else if (quality === 'maj') {
    intervals = [0, 4, 7];
  } else if (quality === 'dim') {
    intervals = [0, 3, 6];
  } else {
    intervals = [0, 4, 7]; // default to major
  }

  // Apply gentle color
  if (color === 'sus2') {
    intervals = [0, 2, 7]; // replace 3rd with 2nd
  } else if (color === 'add9') {
    intervals.push(14); // add 9th (2nd, octave up) for Tone.js voicing
  }

  // Build symbol
  let symbol = root;
  if (quality === 'min') symbol += ' min';
  else if (quality === 'maj') symbol += ' maj';
  else if (quality === 'dim') symbol += ' dim';
  if (color) symbol += ` ${color}`;
  symbol = symbol.trim();

  // Convert intervals to Tone.js note strings with proper octave wrapping
  const notes = intervals.map(i => {
    const pitchClass = transpose(root, ((i % 12) + 12) % 12);
    const octaveOffset = Math.floor(i / 12);
    return toToneNote(pitchClass, octave + octaveOffset);
  });

  return { symbol, notes, root, quality };
}

// Optional inversion (rare, to keep things smooth)
function maybeAddInversion(chord) {
  if (!chance(0.25)) return chord;

  const { root, quality } = chord;
  const third = transpose(root, quality === 'maj' ? 4 : 3);
  const fifth = transpose(root, 7);
  const bass = [third, fifth][Math.floor(Math.random() * 2)];

  return { ...chord, symbol: `${chord.symbol} / ${bass}` };
}

// --------------------------------------
// RHYTHM (chord-length variation within a progression)
// --------------------------------------

const TICKS_PER_UNIT = 4;
const ALLOWED_TICKS  = [1, 2, 4, 5, 6, 8, 10, 12];

function generateRhythm(chordCount) {
  const TOTAL   = 4 * TICKS_PER_UNIT; // always 16 ticks
  const BASE    = TICKS_PER_UNIT;     // 4 ticks = ×1, always
  const allowed = new Set(ALLOWED_TICKS);
  const nonBase = ALLOWED_TICKS.filter(t => t !== BASE);

  // ~40 % chance: perfectly even (only possible for 2 and 4 chords)
  if (BASE * chordCount === TOTAL && Math.random() < 0.4) {
    return Array(chordCount).fill(BASE);
  }

  // Rule: at most 2 chords may differ from ×1 (BASE = 4).
  // For 2-chord progressions both always differ (4+4=8 ≠ 16).
  // The non-varied slots lock to BASE; the varied slots absorb the rest.

  for (let attempt = 0; attempt < 40; attempt++) {
    const variedCount = chordCount <= 2 ? chordCount
      : 1 + Math.floor(Math.random() * 2);   // 1 or 2

    // Pick unique random positions
    const positions = [];
    while (positions.length < variedCount) {
      const p = Math.floor(Math.random() * chordCount);
      if (!positions.includes(p)) positions.push(p);
    }

    const fixedTotal   = (chordCount - variedCount) * BASE;
    const variedTarget = TOTAL - fixedTotal;

    if (variedCount === 1) {
      if (variedTarget > 0 && allowed.has(variedTarget) && variedTarget !== BASE) {
        const w = Array(chordCount).fill(BASE);
        w[positions[0]] = variedTarget;
        return w;
      }
      continue;
    }

    // variedCount === 2: pick random first, derive second
    const shuffled = [...nonBase].sort(() => Math.random() - 0.5);
    for (const v1 of shuffled) {
      const v2 = variedTarget - v1;
      if (v2 > 0 && allowed.has(v2) && (v1 !== BASE || v2 !== BASE)) {
        const w = Array(chordCount).fill(BASE);
        w[positions[0]] = v1;
        w[positions[1]] = v2;
        return w;
      }
    }
  }

  // Fallback: even rhythm
  return Array(chordCount).fill(BASE);
}

// --------------------------------------
// PUBLIC API
// --------------------------------------

/**
 * Generate a full chord progression in a random (or specified) minor key.
 *
 * @param {object} [options]
 * @param {string} [options.key] - Root note of the minor key (e.g. "C")
 * @param {number} [options.octave] - Base octave for voicing (default 3)
 * @param {string} [options.startChordRoot] - Force first chord root for smooth chaining
 * @param {string} [options.startChordQuality] - Quality of the forced first chord (default "min")
 * @returns {{ key: string, chords: { symbol: string, notes: string[], root: string, quality: string }[], rhythm: number[] }}
 */
export function generateProgression(options = {}) {
  let keyRoot;

  if (options.startChordRoot) {
    keyRoot = options.startChordRoot;
  } else {
    keyRoot = options.key || MINOR_KEYS[Math.floor(Math.random() * MINOR_KEYS.length)];
  }

  const octave = options.octave || 3;
  const pattern = PROGRESSION_PATTERNS[Math.floor(Math.random() * PROGRESSION_PATTERNS.length)];

  const chords = pattern.map((ch, idx) => {
    if (idx === 0 && options.startChordRoot) {
      const forcedChord = buildChord(
        options.startChordRoot,
        { quality: options.startChordQuality || ch.quality, role: ch.role },
        octave,
      );
      return maybeAddInversion(forcedChord);
    }
    const degreeRoot = degreeToNote(keyRoot, ch.degree);
    const chord = buildChord(degreeRoot, ch, octave);
    return maybeAddInversion(chord);
  });

  const rhythm = generateRhythm(chords.length);

  return { key: `${keyRoot} minor`, chords, rhythm };
}

export { MINOR_KEYS, TICKS_PER_UNIT };
