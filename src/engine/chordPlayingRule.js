/**
 * Chord Playing Rule — per-song variation in how chords are voiced and timed.
 *
 * Each song cycle randomly picks one of four rules that controls whether
 * all notes play simultaneously or bloom sequentially, and whether a random
 * subset or the full chord is used.  The rule persists for the entire cycle
 * and is re-rolled at the start of each new song.
 *
 * For partial-sequential the note selection and sequential split are locked
 * at cycle start so every chord in the song uses the same structural pattern.
 */

const RULES = {
  PARTIAL_SIMULTANEOUS: 'partial-simultaneous',
  PARTIAL_SEQUENTIAL: 'partial-sequential',
  COMPLETE_SIMULTANEOUS: 'complete-simultaneous',
  COMPLETE_SEQUENTIAL: 'complete-sequential',
};

const RULE_LIST = Object.values(RULES);

let currentRule = RULES.COMPLETE_SIMULTANEOUS;

// Locked config for partial-sequential (persists for the whole song cycle).
// Maps chord size → which sorted-pitch indices to keep.
let lockedPartialSeq = null;

// Locked config for partial-simultaneous (persists for the whole song cycle).
// Same structure as lockedPartialSeq — selected once so every chord in the
// cycle uses the same subset of note indices.  Chord variations that change
// the base chord (color swaps, revoicing, etc.) naturally alter the notes at
// those indices, so the subset stays musically responsive.
let lockedPartialSim = null;

// Locked plucked-bass beat offsets (persists for the whole song cycle).
// Array indexed by chord position in the progression. Each entry is either
// 0 (bass on beat 1) or 1–3 (delayed to beat 2, 3, or 4).
// Each position is independently rolled at 20% — the resulting pattern
// repeats identically every loop pass. null when bass is not plucked.
let lockedBassOffsets = null;

// ── Helpers ──

/**
 * Converts a note string like "C#4" to a numeric pitch for sorting.
 */
function noteToPitch(noteStr) {
  const match = noteStr.match(/^([A-G]#?)(\d+)$/);
  if (!match) return 0;
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  return names.indexOf(match[1]) + Number(match[2]) * 12;
}

/**
 * Randomly selects `count` indices from [0..total), sorted ascending.
 */
function randomIndices(total, count) {
  const indices = new Set();
  while (indices.size < count) {
    indices.add(Math.floor(Math.random() * total));
  }
  return [...indices].sort((a, b) => a - b);
}

/**
 * Pre-computes which note indices to keep for each possible chord size (2–5).
 * Called once per song cycle when partial-sequential is selected.
 */
function lockPartialSequentialConfig() {
  lockedPartialSeq = {};

  for (const n of [2, 3, 4, 5]) {
    if (n <= 2) {
      // Can't do partial with <=2 notes — keep all
      lockedPartialSeq[n] = { keepIndices: Array.from({ length: n }, (_, i) => i) };
    } else {
      // Subset size: random from 2 to n-1
      const keepCount = 2 + Math.floor(Math.random() * (n - 2));
      lockedPartialSeq[n] = { keepIndices: randomIndices(n, keepCount) };
    }
  }

  // Log the pattern for the most common chord size (3 notes)
  const example = lockedPartialSeq[3];
  console.log(`[rule] partial-seq locked — keep indices: ${JSON.stringify(example.keepIndices)} (for 3-note chords)`);
}

/**
 * Pre-computes which note indices to keep for each possible chord size (2–5).
 * Called once per song cycle when partial-simultaneous is selected.
 * Identical logic to lockPartialSequentialConfig — the difference is only
 * in *how* the selected notes are scheduled (all at once vs. blooming).
 */
function lockPartialSimultaneousConfig() {
  lockedPartialSim = {};

  for (const n of [2, 3, 4, 5]) {
    if (n <= 2) {
      lockedPartialSim[n] = { keepIndices: Array.from({ length: n }, (_, i) => i) };
    } else {
      const keepCount = 2 + Math.floor(Math.random() * (n - 2));
      lockedPartialSim[n] = { keepIndices: randomIndices(n, keepCount) };
    }
  }

  const example = lockedPartialSim[3];
  console.log(`[rule] partial-sim locked — keep indices: ${JSON.stringify(example.keepIndices)} (for 3-note chords)`);
}

/**
 * Pre-computes per-chord-position bass beat offsets for this song cycle.
 * Generates exactly one entry per chord in the progression. Each position
 * independently: 20% chance of delayed entry on beat 2, 3, or 4.
 * The pattern repeats identically every loop pass.
 * Called once per cycle from pickChordPlayingRule.
 *
 * @param {boolean} bassPlucked       - Whether the current bass is a plucked instrument
 * @param {number}  progressionLength - Number of chords in the current progression
 */
function lockBassOffsetConfig(bassPlucked, progressionLength) {
  if (!bassPlucked || progressionLength === 0) {
    lockedBassOffsets = null;
    return;
  }

  lockedBassOffsets = [];
  for (let i = 0; i < progressionLength; i++) {
    if (Math.random() < 0.2) {
      lockedBassOffsets.push(1 + Math.floor(Math.random() * 3)); // 1, 2, or 3 → beats 2, 3, 4
    } else {
      lockedBassOffsets.push(0);
    }
  }

  const beatNames = lockedBassOffsets.map(b => b === 0 ? '1' : String(b + 1));
  console.log(`[rule] plucked bass offsets locked — beats [${beatNames.join(', ')}] (${progressionLength} chords)`);
}

// ── Public API ──

/**
 * Randomly picks a chord playing rule for this song cycle.
 * Call once per cycle (at isNewCycle or engine start).
 *
 * When the lead is a plucked instrument, sequential rules are heavily
 * favoured — plucked notes bloom naturally one at a time, so the
 * sequential pattern complements their percussive attack.
 *
 * @param {object} [options]
 * @param {boolean} [options.leadPlucked=false]       - Whether the current lead is plucked
 * @param {boolean} [options.bassPlucked=false]        - Whether the current bass is plucked
 * @param {number}  [options.progressionLength=0]      - Number of chords in the current progression
 */
export function pickChordPlayingRule({ leadPlucked = false, bassPlucked = false, progressionLength = 0 } = {}) {
  if (leadPlucked) {
    // Plucked lead: 70% sequential (35% each), 30% simultaneous (15% each)
    const roll = Math.random();
    if (roll < 0.15)      currentRule = RULES.PARTIAL_SIMULTANEOUS;
    else if (roll < 0.50) currentRule = RULES.PARTIAL_SEQUENTIAL;
    else if (roll < 0.65) currentRule = RULES.COMPLETE_SIMULTANEOUS;
    else                  currentRule = RULES.COMPLETE_SEQUENTIAL;
  } else {
    // Non-plucked: equal 25% probability for each rule
    currentRule = RULE_LIST[Math.floor(Math.random() * RULE_LIST.length)];
  }

  if (currentRule === RULES.PARTIAL_SEQUENTIAL) {
    lockPartialSequentialConfig();
  } else {
    lockedPartialSeq = null;
  }

  if (currentRule === RULES.PARTIAL_SIMULTANEOUS) {
    lockPartialSimultaneousConfig();
  } else {
    lockedPartialSim = null;
  }

  lockBassOffsetConfig(bassPlucked, progressionLength);

  console.log(`[rule] chord playing: ${currentRule}`);
}

/**
 * Returns the active rule name (for debug/logging).
 */
export function getCurrentRule() {
  return currentRule;
}

/**
 * Returns the locked bass beat offset for a given chord position.
 * 0 = on beat (no delay), 1–3 = delayed to that quarter-beat.
 * Positions beyond the pre-generated array return 0 (on-beat).
 *
 * @param {number} chordPosition - Index of the chord in the progression (0-based)
 * @returns {number}
 */
export function getBassOffsetBeat(chordPosition) {
  if (!lockedBassOffsets) return 0;
  return lockedBassOffsets[chordPosition] ?? 0;
}

/**
 * Applies the current chord playing rule to a set of voiced notes.
 *
 * @param {string[]} voicedNotes - Note strings (e.g. ["C3", "Eb4", "G4"])
 * @param {number}   chordSec   - Chord duration in seconds
 * @returns {{ simultaneous: string[], sequential: { note: string, timeOffset: number }[] }}
 */
export function applyChordPlayingRule(voicedNotes, chordSec) {
  // Sort by pitch (ascending) — variation functions can reorder notes
  const sorted = [...voicedNotes].sort((a, b) => noteToPitch(a) - noteToPitch(b));

  const isPartial = currentRule === RULES.PARTIAL_SIMULTANEOUS ||
                    currentRule === RULES.PARTIAL_SEQUENTIAL;
  const isSequential = currentRule === RULES.PARTIAL_SEQUENTIAL ||
                       currentRule === RULES.COMPLETE_SEQUENTIAL;

  // ── Select notes ──
  let selected;

  if (currentRule === RULES.PARTIAL_SEQUENTIAL && lockedPartialSeq) {
    // Use locked indices for this chord size (deterministic per song)
    const config = lockedPartialSeq[sorted.length] || lockedPartialSeq[Math.min(sorted.length, 5)];
    selected = config.keepIndices
      .filter(i => i < sorted.length)
      .map(i => sorted[i]);
    if (selected.length < 2) selected = sorted; // safety fallback
  } else if (currentRule === RULES.PARTIAL_SIMULTANEOUS && lockedPartialSim) {
    // Partial-simultaneous: use locked indices for this chord size
    // (deterministic per song — chord variations change the notes at these
    // indices but the structural pattern stays the same)
    const config = lockedPartialSim[sorted.length] || lockedPartialSim[Math.min(sorted.length, 5)];
    selected = config.keepIndices
      .filter(i => i < sorted.length)
      .map(i => sorted[i]);
    if (selected.length < 2) selected = sorted; // safety fallback
  } else if (isPartial && sorted.length > 2) {
    // Fallback for any future partial rule without locked config
    const subsetSize = 2 + Math.floor(Math.random() * (sorted.length - 2));
    const indices = randomIndices(sorted.length, subsetSize);
    selected = indices.map(i => sorted[i]);
  } else {
    // Complete (or fallback for <=2 note chords)
    selected = sorted;
  }

  // ── Build schedule ──
  if (!isSequential || selected.length <= 1) {
    return { simultaneous: selected, sequential: [] };
  }

  // Sequential: lowest note anchors simultaneously, higher notes bloom
  // at exact 1/4 divisions of the chord duration (beat 2, 3, 4).
  const simultaneous = [selected[0]];
  const seqNotes = selected.slice(1);

  const sequential = seqNotes.map((note, i) => ({
    note,
    timeOffset: chordSec * (i + 1) / 4,
  }));

  return { simultaneous, sequential };
}
