/**
 * Chord progression generator tuned to an emotional, choral minor aesthetic.
 *
 * Uses explicit degree→semitone mapping (Aeolian-based) and mood-aware,
 * role-aware chord coloring. Mostly plain triads with occasional sus2 / add9
 * for warmth. All patterns start on i so the last chord of one progression
 * can seed the next for smooth chaining.
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

// --------------------------------------
// PROGRESSION PATTERNS (CHOIR-FRIENDLY)
// Each pattern has a mood tag so we can steer the vibe.
// --------------------------------------

const PROGRESSION_PATTERNS = [
  // --- SAD / INTIMATE ---

  // Classic i – bVI – bVII – i
  {
    mood: 'sad',
    degrees: [
      { degree: 'i',    quality: 'min', role: 'tonic' },
      { degree: 'bVI',  quality: 'maj', role: 'predominant' },
      { degree: 'bVII', quality: 'maj', role: 'predominant' },
      { degree: 'i',    quality: 'min', role: 'tonic' },
    ],
  },

  // i – bIII – bVI – i (gently melancholic)
  {
    mood: 'sad',
    degrees: [
      { degree: 'i',    quality: 'min', role: 'tonic' },
      { degree: 'bIII', quality: 'maj', role: 'tonicLike' },
      { degree: 'bVI',  quality: 'maj', role: 'predominant' },
      { degree: 'i',    quality: 'min', role: 'tonic' },
    ],
  },

  // i – iv – bVI – bVII – i (hymn-like)
  {
    mood: 'sad',
    degrees: [
      { degree: 'i',    quality: 'min', role: 'tonic' },
      { degree: 'iv',   quality: 'min', role: 'predominant' },
      { degree: 'bVI',  quality: 'maj', role: 'predominant' },
      { degree: 'bVII', quality: 'maj', role: 'predominant' },
      { degree: 'i',    quality: 'min', role: 'tonic' },
    ],
  },

  // --- HOPEFUL / LIFTING ---

  // i – bVII – bIII – bVI – i (cinematic lift then return)
  {
    mood: 'hopeful',
    degrees: [
      { degree: 'i',    quality: 'min', role: 'tonic' },
      { degree: 'bVII', quality: 'maj', role: 'predominant' },
      { degree: 'bIII', quality: 'maj', role: 'tonicLike' },
      { degree: 'bVI',  quality: 'maj', role: 'predominant' },
      { degree: 'i',    quality: 'min', role: 'tonic' },
    ],
  },

  // i – iv – bVII – i (simple and singable)
  {
    mood: 'hopeful',
    degrees: [
      { degree: 'i',    quality: 'min', role: 'tonic' },
      { degree: 'iv',   quality: 'min', role: 'predominant' },
      { degree: 'bVII', quality: 'maj', role: 'predominant' },
      { degree: 'i',    quality: 'min', role: 'tonic' },
    ],
  },

  // i – bVI – bIII – bVII – i (bright minor)
  {
    mood: 'hopeful',
    degrees: [
      { degree: 'i',    quality: 'min', role: 'tonic' },
      { degree: 'bVI',  quality: 'maj', role: 'predominant' },
      { degree: 'bIII', quality: 'maj', role: 'tonicLike' },
      { degree: 'bVII', quality: 'maj', role: 'predominant' },
      { degree: 'i',    quality: 'min', role: 'tonic' },
    ],
  },

  // --- DRAMATIC / DARKER (still choir, not jazzy) ---

  // i – bII – bVI – bVII – i (phrygian drama)
  {
    mood: 'dramatic',
    degrees: [
      { degree: 'i',    quality: 'min', role: 'tonic' },
      { degree: 'bII',  quality: 'maj', role: 'predominant' },
      { degree: 'bVI',  quality: 'maj', role: 'predominant' },
      { degree: 'bVII', quality: 'maj', role: 'predominant' },
      { degree: 'i',    quality: 'min', role: 'tonic' },
    ],
  },

  // i – iv – bII – i (short, intense)
  {
    mood: 'dramatic',
    degrees: [
      { degree: 'i',   quality: 'min', role: 'tonic' },
      { degree: 'iv',  quality: 'min', role: 'predominant' },
      { degree: 'bII', quality: 'maj', role: 'predominant' },
      { degree: 'i',   quality: 'min', role: 'tonic' },
    ],
  },

  // --- CIRCULAR / LOOPING ---

  // i – bVI – bVII – bIII – i (circular)
  {
    mood: 'circular',
    degrees: [
      { degree: 'i',    quality: 'min', role: 'tonic' },
      { degree: 'bVI',  quality: 'maj', role: 'predominant' },
      { degree: 'bVII', quality: 'maj', role: 'predominant' },
      { degree: 'bIII', quality: 'maj', role: 'tonicLike' },
      { degree: 'i',    quality: 'min', role: 'tonic' },
    ],
  },

  // i – iv – bIII – bVI – i (song-like)
  {
    mood: 'circular',
    degrees: [
      { degree: 'i',    quality: 'min', role: 'tonic' },
      { degree: 'iv',   quality: 'min', role: 'predominant' },
      { degree: 'bIII', quality: 'maj', role: 'tonicLike' },
      { degree: 'bVI',  quality: 'maj', role: 'predominant' },
      { degree: 'i',    quality: 'min', role: 'tonic' },
    ],
  },

  // --- PLAGAL / HYMN ---

  // i – iv – i (amen cadence, very choral)
  {
    mood: 'sad',
    degrees: [
      { degree: 'i',  quality: 'min', role: 'tonic' },
      { degree: 'iv', quality: 'min', role: 'predominant' },
      { degree: 'i',  quality: 'min', role: 'tonic' },
    ],
  },

  // i – iv – bVI – iv – i (gospel / hymn-like)
  {
    mood: 'hopeful',
    degrees: [
      { degree: 'i',   quality: 'min', role: 'tonic' },
      { degree: 'iv',  quality: 'min', role: 'predominant' },
      { degree: 'bVI', quality: 'maj', role: 'predominant' },
      { degree: 'iv',  quality: 'min', role: 'predominant' },
      { degree: 'i',   quality: 'min', role: 'tonic' },
    ],
  },

  // --- DESCENDING ---

  // i – bVII – bVI – v – i (cinematic choral descent)
  {
    mood: 'dramatic',
    degrees: [
      { degree: 'i',    quality: 'min', role: 'tonic' },
      { degree: 'bVII', quality: 'maj', role: 'predominant' },
      { degree: 'bVI',  quality: 'maj', role: 'predominant' },
      { degree: 'v',    quality: 'min', role: 'predominant' },
      { degree: 'i',    quality: 'min', role: 'tonic' },
    ],
  },

  // i – bVII – bVI – bVII – i (swaying descent and return)
  {
    mood: 'circular',
    degrees: [
      { degree: 'i',    quality: 'min', role: 'tonic' },
      { degree: 'bVII', quality: 'maj', role: 'predominant' },
      { degree: 'bVI',  quality: 'maj', role: 'predominant' },
      { degree: 'bVII', quality: 'maj', role: 'predominant' },
      { degree: 'i',    quality: 'min', role: 'tonic' },
    ],
  },

  // --- LONGER JOURNEYS ---

  // i – bIII – bVII – iv – bVI – i (wide arc)
  {
    mood: 'hopeful',
    degrees: [
      { degree: 'i',    quality: 'min', role: 'tonic' },
      { degree: 'bIII', quality: 'maj', role: 'tonicLike' },
      { degree: 'bVII', quality: 'maj', role: 'predominant' },
      { degree: 'iv',   quality: 'min', role: 'predominant' },
      { degree: 'bVI',  quality: 'maj', role: 'predominant' },
      { degree: 'i',    quality: 'min', role: 'tonic' },
    ],
  },

  // i – bVI – iv – bVII – bIII – i (winding return)
  {
    mood: 'circular',
    degrees: [
      { degree: 'i',    quality: 'min', role: 'tonic' },
      { degree: 'bVI',  quality: 'maj', role: 'predominant' },
      { degree: 'iv',   quality: 'min', role: 'predominant' },
      { degree: 'bVII', quality: 'maj', role: 'predominant' },
      { degree: 'bIII', quality: 'maj', role: 'tonicLike' },
      { degree: 'i',    quality: 'min', role: 'tonic' },
    ],
  },

  // --- PHRYGIAN / DARK ---

  // i – bII – bIII – i (dark Eastern-choir feel)
  {
    mood: 'dramatic',
    degrees: [
      { degree: 'i',    quality: 'min', role: 'tonic' },
      { degree: 'bII',  quality: 'maj', role: 'predominant' },
      { degree: 'bIII', quality: 'maj', role: 'tonicLike' },
      { degree: 'i',    quality: 'min', role: 'tonic' },
    ],
  },

  // i – bII – bVII – bVI – i (phrygian processional)
  {
    mood: 'dramatic',
    degrees: [
      { degree: 'i',    quality: 'min', role: 'tonic' },
      { degree: 'bII',  quality: 'maj', role: 'predominant' },
      { degree: 'bVII', quality: 'maj', role: 'predominant' },
      { degree: 'bVI',  quality: 'maj', role: 'predominant' },
      { degree: 'i',    quality: 'min', role: 'tonic' },
    ],
  },

  // --- SPACIOUS / MEDITATIVE ---

  // i – bVI – i (wide, open)
  {
    mood: 'sad',
    degrees: [
      { degree: 'i',   quality: 'min', role: 'tonic' },
      { degree: 'bVI', quality: 'maj', role: 'predominant' },
      { degree: 'i',   quality: 'min', role: 'tonic' },
    ],
  },

  // i – bVII – i (bright, breathing)
  {
    mood: 'hopeful',
    degrees: [
      { degree: 'i',    quality: 'min', role: 'tonic' },
      { degree: 'bVII', quality: 'maj', role: 'predominant' },
      { degree: 'i',    quality: 'min', role: 'tonic' },
    ],
  },
];

// --------------------------------------
// COLOR PALETTES (STILL VERY SIMPLE)
// --------------------------------------

// Very simple colors: no 7ths, 9ths, 11ths, 13ths as separate chords.
// Just sus2 or add9 and mostly plain triads.
const MINOR_COLORS = ['', '', '', 'sus2', 'add9']; // 60% plain
const MAJOR_COLORS = ['', '', 'sus2', 'add9'];      // also mostly plain

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

// Mood affects how much color we allow on tonic vs predominant
function pickColorForChord(quality, role, mood) {
  // Mood-tuned palettes
  let minorPalette = MINOR_COLORS;
  let majorPalette = MAJOR_COLORS;

  if (mood === 'sad') {
    minorPalette = ['', '', '', 'sus2', 'add9'];
    majorPalette = ['', '', '', 'sus2'];
  } else if (mood === 'hopeful') {
    minorPalette = ['', '', 'add9', 'sus2', 'add9'];
    majorPalette = ['', 'sus2', 'add9', 'add9'];
  } else if (mood === 'dramatic') {
    minorPalette = ['', '', 'sus2', 'sus2', 'add9'];
    majorPalette = ['', '', 'sus2', 'sus2'];
  }
  // circular: use default base palettes

  // Tonics can be slightly more expressive
  if (role === 'tonic' || role === 'tonicLike') {
    if (quality === 'min') {
      return minorPalette[Math.floor(Math.random() * minorPalette.length)];
    }
    if (quality === 'maj') {
      return majorPalette[Math.floor(Math.random() * majorPalette.length)];
    }
  }

  // Predominants: mostly plain, occasional sus2
  if (role === 'predominant') {
    if (chance(0.15)) return 'sus2';
    return '';
  }

  return '';
}

// Build a choir-friendly chord with Tone.js-compatible note output
function buildChord(root, chordSpec, octave, mood) {
  const { quality, role } = chordSpec;
  const color = pickColorForChord(quality, role || 'tonic', mood);

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

  // sus2: replace 3rd with 2nd (1,2,5)
  // add9: keep triad, add 9th (2nd, octave up)
  if (color === 'sus2') {
    intervals = [0, 2, 7];
  } else if (color === 'add9') {
    intervals.push(14); // 9th = 2nd an octave up for Tone.js voicing
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
  // Scale total ticks so longer progressions don't get compressed
  const TOTAL   = Math.max(4, chordCount) * TICKS_PER_UNIT;
  const BASE    = TICKS_PER_UNIT;     // 4 ticks = ×1, always
  const allowed = new Set(ALLOWED_TICKS);
  const nonBase = ALLOWED_TICKS.filter(t => t !== BASE);

  // ~40 % chance: perfectly even (only possible when TOTAL divides evenly)
  if (BASE * chordCount === TOTAL && Math.random() < 0.4) {
    return Array(chordCount).fill(BASE);
  }

  for (let attempt = 0; attempt < 40; attempt++) {
    const variedCount = chordCount <= 2 ? chordCount
      : 1 + Math.floor(Math.random() * 2);   // 1 or 2

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
// KEY MODULATION
// --------------------------------------

/**
 * Pivot relationships: given a chord root interpreted as degree X,
 * the new key root is found by transposing DOWN by that degree's offset.
 *
 * E.g. if lastChord root is C and we pick 'iv', the new key root is
 * C transposed down 5 semitones = G → we're now in G minor, where C is iv.
 */
const PIVOT_DEGREES = [
  { degree: 'i',    offset: 0 },   // stay in same key
  { degree: 'iv',   offset: 5 },   // last chord becomes iv of new key
  { degree: 'bIII', offset: 3 },   // last chord becomes bIII of new key
  { degree: 'bVI',  offset: 8 },   // last chord becomes bVI of new key
  { degree: 'bVII', offset: 10 },  // last chord becomes bVII of new key
];

/**
 * Given the last chord's root, decide whether to modulate to a related key
 * or stay put. Returns the new key root note.
 *
 * ~50% chance to stay, ~50% to modulate via a pivot reinterpretation.
 */
function modulateFromChord(lastRoot) {
  // 50% stay in current key
  if (chance(0.5)) return lastRoot;

  // Pick a modulation pivot (excluding 'i' which means stay)
  const modulations = PIVOT_DEGREES.filter(p => p.degree !== 'i');
  const pivot = modulations[Math.floor(Math.random() * modulations.length)];

  // New key root = last root transposed DOWN by the pivot offset
  return transpose(lastRoot, -pivot.offset);
}

// --------------------------------------
// PATTERN SELECTION
// --------------------------------------

function pickRandomPattern(mood) {
  const candidates = mood
    ? PROGRESSION_PATTERNS.filter(p => p.mood === mood)
    : PROGRESSION_PATTERNS;

  if (candidates.length === 0) return PROGRESSION_PATTERNS[0];
  return candidates[Math.floor(Math.random() * candidates.length)];
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
 * @param {string} [options.mood] - "sad", "hopeful", "dramatic", "circular" (null = any)
 * @param {string} [options.startChordRoot] - Force first chord root for smooth chaining
 * @param {string} [options.startChordQuality] - Quality of the forced first chord (default "min")
 * @returns {{ key: string, mood: string, chords: { symbol: string, notes: string[], root: string, quality: string }[], rhythm: number[] }}
 */
export function generateProgression(options = {}) {
  let keyRoot;

  if (options.startChordRoot) {
    // Modulate: sometimes reinterpret the last chord as a degree in a new key
    keyRoot = modulateFromChord(options.startChordRoot);
  } else {
    keyRoot = options.key || MINOR_KEYS[Math.floor(Math.random() * MINOR_KEYS.length)];
  }

  const octave = options.octave || 3;
  const mood = options.mood || null;
  const pattern = pickRandomPattern(mood);

  const chords = pattern.degrees.map((ch, idx) => {
    const degreeRoot = degreeToNote(keyRoot, ch.degree);
    const chord = buildChord(degreeRoot, ch, octave, pattern.mood);
    return maybeAddInversion(chord);
  });

  const rhythm = generateRhythm(chords.length);

  return { key: `${keyRoot} minor`, mood: pattern.mood, chords, rhythm };
}

export { MINOR_KEYS, TICKS_PER_UNIT };
