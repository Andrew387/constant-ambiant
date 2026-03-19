/**
 * Loop Manager — owns the chord progression loop state.
 *
 * Manages: baseLoop, current loop, loop position/pass tracking,
 * lead reversed loop, loop variation, and progression generation.
 *
 * Extracted from ruleEngine.js to keep the engine focused on
 * scheduling and orchestration.
 */

import { generateProgression, rebuildChordWithColor, TICKS_PER_UNIT } from '../harmony/progression.js';
import { voiceChord } from '../harmony/voicing.js';
import { getCurrentRule } from './chordPlayingRule.js';

// ── Loop state ──
let baseLoop = [];
let loop = [];
let loopPosition = 0;
let loopPassCount = 0;
let lastPlayedPosition = 0;
let lastChord = null;

// ── Lead reversed loop state ──
let leadReversedLoop = [];
let leadReversedPosition = 0;

// ── Pre-generated progression for the next song cycle ──
let pendingProgression = null;

// ── Variation helpers ──

function applyInversion(chord) {
  const voiced = [...chord.voicedNotes];
  if (voiced.length < 2) return chord;

  let lowestIdx = 0;
  let lowestOctave = Infinity;
  voiced.forEach((n, i) => {
    const oct = Number(n.match(/\d+$/)[0]);
    if (oct < lowestOctave) { lowestOctave = oct; lowestIdx = i; }
  });

  voiced[lowestIdx] = voiced[lowestIdx].replace(/\d+$/, String(lowestOctave + 1));
  const label = `${chord.symbol} (inv)`;
  return { ...chord, voicedNotes: voiced, symbol: label };
}

function applyRevoice(chord) {
  const spread = Math.random() < 0.5 ? 1 : 3;
  const { notes: revoiced, offsets } = voiceChord(chord.notes, spread, true);
  return { ...chord, voicedNotes: revoiced, offsets };
}

function applyColorChange(chord) {
  const currentColor = chord.symbol.includes('sus2') ? 'sus2'
    : chord.symbol.includes('add9') ? 'add9' : '';

  const options = ['', 'sus2', 'add9'].filter(c => c !== currentColor);
  const newColor = options[Math.floor(Math.random() * options.length)];

  const { notes } = rebuildChordWithColor(chord.root, chord.quality, newColor, chord.octave);
  const { notes: voicedNotes, offsets } = voiceChord(notes, 2, true);

  let symbol = chord.root;
  if (chord.quality === 'min') symbol += ' min';
  else if (chord.quality === 'maj') symbol += ' maj';
  else if (chord.quality === 'dim') symbol += ' dim';
  if (newColor) symbol += ` ${newColor}`;

  return { ...chord, notes, voicedNotes, offsets, symbol: symbol.trim() };
}

function applyOctaveShift(chord) {
  const direction = -1;
  const voiced = chord.voicedNotes.map(n => {
    const oct = Number(n.match(/\d+$/)[0]);
    const newOct = Math.max(2, Math.min(6, oct + direction));
    return n.replace(/\d+$/, String(newOct));
  });
  const label = `${chord.symbol} (8vb)`;
  return { ...chord, voicedNotes: voiced, symbol: label };
}

function applyDropFifth(chord) {
  const voiced = [...chord.voicedNotes];
  if (voiced.length < 3) return chord;

  const removeIdx = 1 + Math.floor(Math.random() * (voiced.length - 2));
  voiced.splice(removeIdx, 1);

  const label = `${chord.symbol} (open)`;
  return { ...chord, voicedNotes: voiced, symbol: label };
}

const VARIATION_FNS = [applyInversion, applyRevoice, applyColorChange, applyOctaveShift, applyDropFifth];

/**
 * Applies random variations to a subset of chords in a loop.
 *
 * @param {Array} chords - Array of chord objects to vary
 * @param {number} numChanges - Number of chords to modify
 * @param {number} [opsPerChord=1] - Max variation ops per chord (1 or 2)
 * @returns {Array} New array with varied chords
 */
function applyVariations(chords, numChanges, opsPerChord = 1) {
  const varied = chords.map(c => ({ ...c }));
  const count = varied.length;
  if (count === 0 || numChanges === 0) return varied;

  const indices = new Set();
  while (indices.size < numChanges) {
    indices.add(Math.floor(Math.random() * count));
  }

  for (const idx of indices) {
    const numOps = opsPerChord > 1 ? (Math.random() < 0.5 ? 1 : 2) : 1;
    let chord = varied[idx];
    for (let i = 0; i < numOps; i++) {
      const fn = VARIATION_FNS[Math.floor(Math.random() * VARIATION_FNS.length)];
      chord = fn(chord);
    }
    varied[idx] = chord;
  }

  return varied;
}

function createVariedLoop(base) {
  const count = base.length;
  if (count === 0) return base.map(c => ({ ...c }));

  const rule = getCurrentRule();
  const isSequential = rule.includes('sequential');

  let numChanges;
  if (count <= 2) {
    numChanges = isSequential ? 0 : 1;
  } else if (isSequential) {
    numChanges = Math.random() < 0.7 ? 0 : 1;
  } else {
    const roll = Math.random();
    if (roll < 0.25) numChanges = 1;
    else if (roll < 0.65) numChanges = 2;
    else numChanges = Math.min(3, count);
  }

  return applyVariations(base, numChanges);
}

/**
 * Creates a reversed + heavily varied version of a progression for the
 * leadReversed track. 40–70% of chords receive 1–2 random variations.
 */
function createLeadReversedLoop(base) {
  const reversed = [...base].reverse().map(c => ({ ...c }));
  const count = reversed.length;
  if (count === 0) return reversed;

  const numChanges = Math.max(1, Math.floor(count * (0.4 + Math.random() * 0.3)));
  return applyVariations(reversed, numChanges, 2);
}

// ── Chord building ──

function pickOctave() {
  return Math.random() < 0.7 ? 4 : 3;
}

function buildChordObjects(prog, loopOctave) {
  return prog.chords.map((chord, idx) => {
    const { notes: voicedNotes, offsets } = voiceChord(chord.notes, 2, true);
    return {
      symbol: chord.symbol,
      root: chord.root,
      quality: chord.quality,
      octave: loopOctave,
      notes: chord.notes,
      voicedNotes,
      offsets,
      durationTicks: prog.rhythm[idx],
    };
  });
}

// ── Public API ──

/**
 * Generates a new chord progression and replaces the current loop.
 *
 * @param {object} config - { rootNote }
 * @param {function} maybeChangeRoot - Callback to optionally change root note
 */
export function generateLoopProgression(config, maybeChangeRoot) {
  const loopOctave = pickOctave();
  const opts = { octave: loopOctave };

  if (lastChord) {
    opts.startChordRoot = lastChord.root;
  } else {
    maybeChangeRoot();
    opts.key = config.rootNote;
  }

  const prog = generateProgression(opts);
  const chords = buildChordObjects(prog, loopOctave);

  lastChord = chords[chords.length - 1];

  baseLoop = chords;
  loop = chords;
  loopPosition = 0;
  loopPassCount = 0;
  leadReversedLoop = createLeadReversedLoop(chords);
  leadReversedPosition = 0;

  const symbols = chords.map(c => c.symbol).join(' → ');
  const rhythmStr = prog.rhythm.map(t => `×${t / TICKS_PER_UNIT}`).join(' ');
  console.log(
    `[loop] ── new progression ──  ${prog.key} | ${symbols} ` +
    `| rhythm [${rhythmStr}] `
  );
}

/**
 * Pre-generates the next progression during the outro.
 * Does NOT mutate loop state — stores result in pendingProgression.
 */
export function preGenerateNextProgression() {
  const loopOctave = pickOctave();
  const opts = { octave: loopOctave };

  if (lastChord) {
    opts.startChordRoot = lastChord.root;
  } else {
    opts.key = 'C';
  }

  const prog = generateProgression(opts);
  const chords = buildChordObjects(prog, loopOctave);

  pendingProgression = { chords, prog };

  const symbols = chords.map(c => c.symbol).join(' → ');
  console.log(`[pedal] pre-generated next progression: ${prog.key} | ${symbols}`);
  return { chords, key: prog.key };
}

/**
 * Installs the pre-generated progression as the active loop.
 * Returns true if a pending progression was consumed.
 */
export function installPendingProgression() {
  if (!pendingProgression) return false;

  const { chords, prog } = pendingProgression;
  baseLoop = chords;
  loop = chords;
  loopPosition = 0;
  leadReversedLoop = createLeadReversedLoop(chords);
  leadReversedPosition = 0;
  lastChord = chords[chords.length - 1];

  const symbols = chords.map(c => c.symbol).join(' → ');
  console.log(
    `[loop] ── new progression (pre-generated) ──  ${prog.key} | ${symbols}`
  );
  pendingProgression = null;
  return true;
}

/**
 * Increments the loop pass counter and applies variation.
 * Called by ruleEngine when the loop position wraps to 0.
 */
export function incrementLoopPass() {
  loopPassCount++;
  loop = createVariedLoop(baseLoop);
  leadReversedLoop = createLeadReversedLoop(baseLoop);
}

/**
 * Resets the loop pass counter (called on new cycle).
 */
export function resetLoopPassCount() {
  loopPassCount = 0;
}

/**
 * Returns the current chord and advances position.
 * Also advances the lead reversed position in sync.
 *
 * @returns {{ chord: object, leadReversedChord: object|null }}
 */
export function getCurrentChordAndAdvance() {
  const chord = loop[loopPosition];
  lastPlayedPosition = loopPosition;

  // Advance lead reversed in sync
  let leadReversedChord = null;
  if (leadReversedLoop.length > 0) {
    leadReversedChord = leadReversedLoop[leadReversedPosition];
    leadReversedPosition = (leadReversedPosition + 1) % leadReversedLoop.length;
  }

  loopPosition = (loopPosition + 1) % loop.length;

  return { chord, leadReversedChord };
}

/**
 * Checks if loop position is at the start (needs pass advancement).
 */
export function isAtLoopStart() {
  return loopPosition === 0 && loop.length > 0;
}

/**
 * Resets all loop state. Called on engine stop.
 */
export function resetLoopState() {
  baseLoop = [];
  loop = [];
  loopPosition = 0;
  loopPassCount = 0;
  lastPlayedPosition = 0;
  lastChord = null;
  pendingProgression = null;
  leadReversedLoop = [];
  leadReversedPosition = 0;
}

// ── Getters ──

export function getBaseLoop() { return baseLoop; }
export function getLoop() { return loop; }
export function getLoopPosition() { return loopPosition; }
export function getLoopPassCount() { return loopPassCount; }
export function getLastPlayedPosition() { return lastPlayedPosition; }
export function getLastChord() { return lastChord; }
