/**
 * Chord progression generator tuned to an emotional, choral minor aesthetic.
 *
 * Uses explicit degree→semitone mapping (Aeolian-based) and mood-aware,
 * role-aware chord coloring. Mostly plain triads with occasional sus2 / add9
 * for warmth. Patterns start on i but end on various degrees so progressions
 * don't always loop back to the tonic. The last chord seeds the next
 * progression for smooth chaining regardless of what degree it lands on.
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

  // i – bVI – bVII (opens outward)
  {
    mood: 'sad',
    degrees: [
      { degree: 'i',    quality: 'min', role: 'tonic' },
      { degree: 'bVI',  quality: 'maj', role: 'predominant' },
      { degree: 'bVII', quality: 'maj', role: 'predominant' },
    ],
  },

  // i – bIII – bVI (gently melancholic, settles on bVI)
  {
    mood: 'sad',
    degrees: [
      { degree: 'i',    quality: 'min', role: 'tonic' },
      { degree: 'bIII', quality: 'maj', role: 'tonicLike' },
      { degree: 'bVI',  quality: 'maj', role: 'predominant' },
    ],
  },

  // i – iv – bVI – bVII (hymn-like, doesn't resolve)
  {
    mood: 'sad',
    degrees: [
      { degree: 'i',    quality: 'min', role: 'tonic' },
      { degree: 'iv',   quality: 'min', role: 'predominant' },
      { degree: 'bVI',  quality: 'maj', role: 'predominant' },
      { degree: 'bVII', quality: 'maj', role: 'predominant' },
    ],
  },

  // --- HOPEFUL / LIFTING ---

  // i – bVII – bIII – bVI (cinematic lift, hangs on bVI)
  {
    mood: 'hopeful',
    degrees: [
      { degree: 'i',    quality: 'min', role: 'tonic' },
      { degree: 'bVII', quality: 'maj', role: 'predominant' },
      { degree: 'bIII', quality: 'maj', role: 'tonicLike' },
      { degree: 'bVI',  quality: 'maj', role: 'predominant' },
    ],
  },

  // i – iv – bVII (simple, lifts away)
  {
    mood: 'hopeful',
    degrees: [
      { degree: 'i',    quality: 'min', role: 'tonic' },
      { degree: 'iv',   quality: 'min', role: 'predominant' },
      { degree: 'bVII', quality: 'maj', role: 'predominant' },
    ],
  },

  // i – bVI – bIII – bVII (bright minor, ends bright)
  {
    mood: 'hopeful',
    degrees: [
      { degree: 'i',    quality: 'min', role: 'tonic' },
      { degree: 'bVI',  quality: 'maj', role: 'predominant' },
      { degree: 'bIII', quality: 'maj', role: 'tonicLike' },
      { degree: 'bVII', quality: 'maj', role: 'predominant' },
    ],
  },

  // --- DRAMATIC / DARKER (still choir, not jazzy) ---

  // i – bII – bVI – bVII (phrygian drama, unresolved)
  {
    mood: 'dramatic',
    degrees: [
      { degree: 'i',    quality: 'min', role: 'tonic' },
      { degree: 'bII',  quality: 'maj', role: 'predominant' },
      { degree: 'bVI',  quality: 'maj', role: 'predominant' },
      { degree: 'bVII', quality: 'maj', role: 'predominant' },
    ],
  },

  // i – iv – bII (short, tense)
  {
    mood: 'dramatic',
    degrees: [
      { degree: 'i',   quality: 'min', role: 'tonic' },
      { degree: 'iv',  quality: 'min', role: 'predominant' },
      { degree: 'bII', quality: 'maj', role: 'predominant' },
    ],
  },

  // --- CIRCULAR / LOOPING ---

  // i – bVI – bVII – bIII (circular, lands on relative major)
  {
    mood: 'circular',
    degrees: [
      { degree: 'i',    quality: 'min', role: 'tonic' },
      { degree: 'bVI',  quality: 'maj', role: 'predominant' },
      { degree: 'bVII', quality: 'maj', role: 'predominant' },
      { degree: 'bIII', quality: 'maj', role: 'tonicLike' },
    ],
  },

  // i – iv – bIII – bVI (song-like, hangs on bVI)
  {
    mood: 'circular',
    degrees: [
      { degree: 'i',    quality: 'min', role: 'tonic' },
      { degree: 'iv',   quality: 'min', role: 'predominant' },
      { degree: 'bIII', quality: 'maj', role: 'tonicLike' },
      { degree: 'bVI',  quality: 'maj', role: 'predominant' },
    ],
  },

  // --- PLAGAL / HYMN ---

  // i – iv (amen cadence, open)
  {
    mood: 'sad',
    degrees: [
      { degree: 'i',  quality: 'min', role: 'tonic' },
      { degree: 'iv', quality: 'min', role: 'predominant' },
    ],
  },

  // i – iv – bVI – iv (gospel / hymn-like, rests on iv)
  {
    mood: 'hopeful',
    degrees: [
      { degree: 'i',   quality: 'min', role: 'tonic' },
      { degree: 'iv',  quality: 'min', role: 'predominant' },
      { degree: 'bVI', quality: 'maj', role: 'predominant' },
      { degree: 'iv',  quality: 'min', role: 'predominant' },
    ],
  },

  // --- DESCENDING ---

  // i – bVII – bVI – v (cinematic choral descent)
  {
    mood: 'dramatic',
    degrees: [
      { degree: 'i',    quality: 'min', role: 'tonic' },
      { degree: 'bVII', quality: 'maj', role: 'predominant' },
      { degree: 'bVI',  quality: 'maj', role: 'predominant' },
      { degree: 'v',    quality: 'min', role: 'predominant' },
    ],
  },

  // i – bVII – bVI – bVII (swaying descent)
  {
    mood: 'circular',
    degrees: [
      { degree: 'i',    quality: 'min', role: 'tonic' },
      { degree: 'bVII', quality: 'maj', role: 'predominant' },
      { degree: 'bVI',  quality: 'maj', role: 'predominant' },
      { degree: 'bVII', quality: 'maj', role: 'predominant' },
    ],
  },

  // --- LONGER JOURNEYS ---

  // i – bIII – bVII – iv – bVI (wide arc)
  {
    mood: 'hopeful',
    degrees: [
      { degree: 'i',    quality: 'min', role: 'tonic' },
      { degree: 'bIII', quality: 'maj', role: 'tonicLike' },
      { degree: 'bVII', quality: 'maj', role: 'predominant' },
      { degree: 'iv',   quality: 'min', role: 'predominant' },
      { degree: 'bVI',  quality: 'maj', role: 'predominant' },
    ],
  },

  // i – bVI – iv – bVII – bIII (winding, lands on bIII)
  {
    mood: 'circular',
    degrees: [
      { degree: 'i',    quality: 'min', role: 'tonic' },
      { degree: 'bVI',  quality: 'maj', role: 'predominant' },
      { degree: 'iv',   quality: 'min', role: 'predominant' },
      { degree: 'bVII', quality: 'maj', role: 'predominant' },
      { degree: 'bIII', quality: 'maj', role: 'tonicLike' },
    ],
  },

  // --- PHRYGIAN / DARK ---

  // i – bII – bIII (dark Eastern-choir feel, opens up)
  {
    mood: 'dramatic',
    degrees: [
      { degree: 'i',    quality: 'min', role: 'tonic' },
      { degree: 'bII',  quality: 'maj', role: 'predominant' },
      { degree: 'bIII', quality: 'maj', role: 'tonicLike' },
    ],
  },

  // i – bII – bVII – bVI (phrygian processional)
  {
    mood: 'dramatic',
    degrees: [
      { degree: 'i',    quality: 'min', role: 'tonic' },
      { degree: 'bII',  quality: 'maj', role: 'predominant' },
      { degree: 'bVII', quality: 'maj', role: 'predominant' },
      { degree: 'bVI',  quality: 'maj', role: 'predominant' },
    ],
  },

  // --- SAD / LAMENT (additional) ---

  // i – iv – v (choral lament, ends on minor dominant)
  {
    mood: 'sad',
    degrees: [
      { degree: 'i',  quality: 'min', role: 'tonic' },
      { degree: 'iv', quality: 'min', role: 'predominant' },
      { degree: 'v',  quality: 'min', role: 'predominant' },
    ],
  },

  // i – bIII – iv (warm ascent)
  {
    mood: 'sad',
    degrees: [
      { degree: 'i',    quality: 'min', role: 'tonic' },
      { degree: 'bIII', quality: 'maj', role: 'tonicLike' },
      { degree: 'iv',   quality: 'min', role: 'predominant' },
    ],
  },

  // i – v – bVI – iv (descending lament arc)
  {
    mood: 'sad',
    degrees: [
      { degree: 'i',   quality: 'min', role: 'tonic' },
      { degree: 'v',   quality: 'min', role: 'predominant' },
      { degree: 'bVI', quality: 'maj', role: 'predominant' },
      { degree: 'iv',  quality: 'min', role: 'predominant' },
    ],
  },

  // --- HOPEFUL (additional) ---

  // i – bIII – iv – bVII (ascending stepwise lift)
  {
    mood: 'hopeful',
    degrees: [
      { degree: 'i',    quality: 'min', role: 'tonic' },
      { degree: 'bIII', quality: 'maj', role: 'tonicLike' },
      { degree: 'iv',   quality: 'min', role: 'predominant' },
      { degree: 'bVII', quality: 'maj', role: 'predominant' },
    ],
  },

  // i – iv – bVI – bVII – bIII (wide hopeful arc)
  {
    mood: 'hopeful',
    degrees: [
      { degree: 'i',    quality: 'min', role: 'tonic' },
      { degree: 'iv',   quality: 'min', role: 'predominant' },
      { degree: 'bVI',  quality: 'maj', role: 'predominant' },
      { degree: 'bVII', quality: 'maj', role: 'predominant' },
      { degree: 'bIII', quality: 'maj', role: 'tonicLike' },
    ],
  },

  // --- DRAMATIC (additional) ---

  // i – bII – iv – v (phrygian climb to minor dominant)
  {
    mood: 'dramatic',
    degrees: [
      { degree: 'i',   quality: 'min', role: 'tonic' },
      { degree: 'bII', quality: 'maj', role: 'predominant' },
      { degree: 'iv',  quality: 'min', role: 'predominant' },
      { degree: 'v',   quality: 'min', role: 'predominant' },
    ],
  },

  // i – v – bVI – bII (dramatic drop, phrygian tension)
  {
    mood: 'dramatic',
    degrees: [
      { degree: 'i',   quality: 'min', role: 'tonic' },
      { degree: 'v',   quality: 'min', role: 'predominant' },
      { degree: 'bVI', quality: 'maj', role: 'predominant' },
      { degree: 'bII', quality: 'maj', role: 'predominant' },
    ],
  },

  // --- CIRCULAR (additional) ---

  // i – bVII – bVI – iv (smooth chromatic descent)
  {
    mood: 'circular',
    degrees: [
      { degree: 'i',    quality: 'min', role: 'tonic' },
      { degree: 'bVII', quality: 'maj', role: 'predominant' },
      { degree: 'bVI',  quality: 'maj', role: 'predominant' },
      { degree: 'iv',   quality: 'min', role: 'predominant' },
    ],
  },

  // i – bIII – bVII – bVI (orbiting thirds)
  {
    mood: 'circular',
    degrees: [
      { degree: 'i',    quality: 'min', role: 'tonic' },
      { degree: 'bIII', quality: 'maj', role: 'tonicLike' },
      { degree: 'bVII', quality: 'maj', role: 'predominant' },
      { degree: 'bVI',  quality: 'maj', role: 'predominant' },
    ],
  },

  // i – iv – bVII – bIII – bVI (long winding path)
  {
    mood: 'circular',
    degrees: [
      { degree: 'i',    quality: 'min', role: 'tonic' },
      { degree: 'iv',   quality: 'min', role: 'predominant' },
      { degree: 'bVII', quality: 'maj', role: 'predominant' },
      { degree: 'bIII', quality: 'maj', role: 'tonicLike' },
      { degree: 'bVI',  quality: 'maj', role: 'predominant' },
    ],
  },

  // --- SPACIOUS / MEDITATIVE ---

  // i – bVI (wide, open)
  {
    mood: 'sad',
    degrees: [
      { degree: 'i',   quality: 'min', role: 'tonic' },
      { degree: 'bVI', quality: 'maj', role: 'predominant' },
    ],
  },

  // i – bVII (bright, breathing)
  {
    mood: 'hopeful',
    degrees: [
      { degree: 'i',    quality: 'min', role: 'tonic' },
      { degree: 'bVII', quality: 'maj', role: 'predominant' },
    ],
  },
];

// --------------------------------------
// COLOR PALETTES (STILL VERY SIMPLE)
// --------------------------------------

// Very simple colors: no 7ths, 9ths, 11ths, 13ths as separate chords.
// Just sus2 or add9, balanced with plain triads.
const MINOR_COLORS = ['', '', 'sus2', 'add9', 'add9']; // 40% plain
const MAJOR_COLORS = ['', 'sus2', 'sus2', 'add9'];      // 25% plain

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
    minorPalette = ['', '', 'sus2', 'sus2', 'add9'];
    majorPalette = ['', '', 'sus2', 'add9'];
  } else if (mood === 'hopeful') {
    minorPalette = ['', 'add9', 'sus2', 'add9'];
    majorPalette = ['sus2', 'add9', 'add9', ''];
  } else if (mood === 'dramatic') {
    minorPalette = ['', 'sus2', 'sus2', 'add9'];
    majorPalette = ['', 'sus2', 'sus2', 'add9'];
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

  // Predominants: plain ~65%, sus2 ~20%, add9 ~15%
  if (role === 'predominant') {
    const roll = Math.random();
    if (roll < 0.20) return 'sus2';
    if (roll < 0.35) return 'add9';
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
  if (!chance(0.35)) return chord;

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

function generateRhythm(chordCount) {
  const TOTAL  = 4 * TICKS_PER_UNIT;  // always 4 beats = 16 ticks
  const BASE   = TICKS_PER_UNIT;      // 4 ticks = ×1
  const HALF   = BASE / 2;            // 2 ticks = ×0.5
  const DOUBLE = BASE * 2;            // 8 ticks = ×2

  // Even rhythm when it fits exactly (chordCount === 4)
  if (BASE * chordCount === TOTAL && Math.random() < 0.4) {
    return Array(chordCount).fill(BASE);
  }

  // Start everyone at BASE, then adjust to hit TOTAL
  const w = Array(chordCount).fill(BASE);
  let sum = chordCount * BASE;

  // Too many beats → shrink random chords to ×0.5
  while (sum > TOTAL) {
    const candidates = [];
    for (let i = 0; i < chordCount; i++) {
      if (w[i] > HALF) candidates.push(i);
    }
    if (candidates.length === 0) break;
    const idx = candidates[Math.floor(Math.random() * candidates.length)];
    w[idx] -= HALF;
    sum -= HALF;
  }

  // Too few beats → grow random chords (up to ×2)
  while (sum < TOTAL) {
    const candidates = [];
    for (let i = 0; i < chordCount; i++) {
      if (w[i] < DOUBLE) candidates.push(i);
    }
    if (candidates.length === 0) break;
    const idx = candidates[Math.floor(Math.random() * candidates.length)];
    w[idx] += HALF;
    sum += HALF;
  }

  // Optional variation for even distributions: swap durations between two chords
  if (chordCount >= 3 && Math.random() > 0.4) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const i = Math.floor(Math.random() * chordCount);
      const j = Math.floor(Math.random() * chordCount);
      if (i === j) continue;
      if (w[i] > HALF && w[j] < DOUBLE) {
        w[i] -= HALF;
        w[j] += HALF;
        break;
      }
    }
  }

  return w;
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

/**
 * Rebuild a chord's notes with a different color (sus2 / add9 / plain).
 * Used by the loop variation system to create subtle per-repeat differences.
 *
 * @param {string} root - Root pitch class (e.g. "C")
 * @param {string} quality - "min", "maj", or "dim"
 * @param {string} color - "", "sus2", or "add9"
 * @param {number} octave - Base octave
 * @returns {{ notes: string[], colorLabel: string }}
 */
export function rebuildChordWithColor(root, quality, color, octave) {
  let intervals;
  if (quality === 'min') intervals = [0, 3, 7];
  else if (quality === 'dim') intervals = [0, 3, 6];
  else intervals = [0, 4, 7];

  if (color === 'sus2') {
    intervals = [0, 2, 7];
  } else if (color === 'add9') {
    intervals.push(14);
  }

  const notes = intervals.map(i => {
    const pitchClass = transpose(root, ((i % 12) + 12) % 12);
    const octaveOffset = Math.floor(i / 12);
    return toToneNote(pitchClass, octave + octaveOffset);
  });

  return { notes, colorLabel: color };
}

export { MINOR_KEYS, TICKS_PER_UNIT };
