import * as Tone from 'tone';
import rulesConfig from './rules.config.js';
import { generateProgression, rebuildChordWithColor, MINOR_KEYS, TICKS_PER_UNIT } from '../harmony/progression.js';
import { voiceChord } from '../harmony/voicing.js';
import { triggerPadChord, triggerDrone, triggerLeadChord } from '../rhythm/scheduler.js';
import {
  startClock, stopClock,
  setTempoImmediate, rampTempo, getTargetBpm,
} from '../rhythm/clock.js';
import {
  initSongStructure, getCurrentSection, getNextSection, getSectionProgress,
  advanceSongProgression, getSongState,
} from './songStructure.js';
import { updateSectionAutomation } from '../audio/effects/sectionAutomation.js';

let config = { ...rulesConfig };
let synths = null;
let texturePlayer = null;
let swapLeadFn = null;
let running = false;
let chordCount = 0;
let loopTimeoutId = null;

// ── Loop state ──
// A loop is a variable-length progression that loops continuously.
// The song structure state machine controls when new progressions are generated
// (only at the start of each song cycle / transition section).
let baseLoop = [];       // Original unvaried chord snapshots (source of truth)
let loop = [];           // Active loop — may be a varied copy of baseLoop
let loopPosition = 0;    // Current chord within the loop
let loopPassCount = 0;   // How many full passes of the current loop have played
let lastPlayedPosition = 0; // Index of the chord that was just played (for progress)

/**
 * Converts chordDuration (in measures of 4/4) to seconds.
 * Uses the TARGET BPM (not the live/ramping value) so calculations are
 * always stable and predictable.
 * @returns {number} duration in seconds
 */
function chordDurationInSeconds() {
  const bpm = getTargetBpm();
  return config.chordDuration * 4 * (60 / bpm);
}

/**
 * Picks a base octave, biased toward the higher register (octave 4 ~70%).
 */
function pickOctave() {
  return Math.random() < 0.7 ? 4 : 3;
}

/**
 * Only changes root ~30% of cycles to avoid too much key-hopping.
 */
function maybeChangeRoot() {
  if (Math.random() < 0.3) {
    config.rootNote = MINOR_KEYS[Math.floor(Math.random() * MINOR_KEYS.length)];
  }
}

/**
 * Gently drifts the tempo within the dark range each cycle.
 */
function driftTempo() {
  const { min, max } = config.tempo;
  const drift = (Math.random() - 0.5) * 8; // ±4 BPM
  const newBpm = Math.round(Math.min(max, Math.max(min, config.tempo.current + drift)));
  config.tempo.current = newBpm;
  rampTempo(newBpm);
}

// Track the last chord so the next progression can chain from it
let lastChord = null;

// ── Loop variation helpers ──
// On repeats 2+, apply 1–2 subtle changes so no two passes are identical.

/**
 * Inversion: move the lowest voiced note up one octave.
 * Creates a smoother, lifted voicing without changing the harmony.
 */
function applyInversion(chord) {
  const voiced = [...chord.voicedNotes];
  if (voiced.length < 2) return chord;

  // Find lowest note by parsing octave numbers
  let lowestIdx = 0;
  let lowestOctave = Infinity;
  voiced.forEach((n, i) => {
    const oct = Number(n.match(/\d+$/)[0]);
    if (oct < lowestOctave) { lowestOctave = oct; lowestIdx = i; }
  });

  // Shift that note up one octave
  voiced[lowestIdx] = voiced[lowestIdx].replace(/\d+$/, String(lowestOctave + 1));

  const label = `${chord.symbol} (inv)`;
  return { ...chord, voicedNotes: voiced, symbol: label };
}

/**
 * Re-voice: run voiceChord again with a different spread value,
 * giving a new octave distribution of the same pitches.
 */
function applyRevoice(chord) {
  const spread = Math.random() < 0.5 ? 1 : 3; // original is 2
  const { notes: revoiced, offsets } = voiceChord(chord.notes, spread, true);
  return { ...chord, voicedNotes: revoiced, offsets };
}

/**
 * Color toggle: swap between plain / sus2 / add9.
 * Rebuilds the note set from the chord root so intervals are correct.
 */
function applyColorChange(chord) {
  const currentColor = chord.symbol.includes('sus2') ? 'sus2'
    : chord.symbol.includes('add9') ? 'add9' : '';

  // Pick a different color
  const options = ['', 'sus2', 'add9'].filter(c => c !== currentColor);
  const newColor = options[Math.floor(Math.random() * options.length)];

  const { notes } = rebuildChordWithColor(chord.root, chord.quality, newColor, chord.octave);
  const { notes: voicedNotes, offsets } = voiceChord(notes, 2, true);

  // Update symbol
  let symbol = chord.root;
  if (chord.quality === 'min') symbol += ' min';
  else if (chord.quality === 'maj') symbol += ' maj';
  else if (chord.quality === 'dim') symbol += ' dim';
  if (newColor) symbol += ` ${newColor}`;

  return { ...chord, notes, voicedNotes, offsets, symbol: symbol.trim() };
}

/**
 * Octave shift: transpose all voiced notes up or down one octave.
 * Gives a wider/narrower feel without changing harmony.
 */
function applyOctaveShift(chord) {
  const direction = Math.random() < 0.5 ? 1 : -1;
  const voiced = chord.voicedNotes.map(n => {
    const oct = Number(n.match(/\d+$/)[0]);
    const newOct = Math.max(2, Math.min(6, oct + direction));
    return n.replace(/\d+$/, String(newOct));
  });
  const label = `${chord.symbol} (${direction > 0 ? '8va' : '8vb'})`;
  return { ...chord, voicedNotes: voiced, symbol: label };
}

/**
 * Drop fifth: remove the 5th from the voicing for a more open, hollow sound.
 * Only applies when there are 3+ notes so we don't strip too much.
 */
function applyDropFifth(chord) {
  const voiced = [...chord.voicedNotes];
  if (voiced.length < 3) return chord;

  // Remove one inner note (not root or top) to thin the voicing
  const removeIdx = 1 + Math.floor(Math.random() * (voiced.length - 2));
  voiced.splice(removeIdx, 1);

  const label = `${chord.symbol} (open)`;
  return { ...chord, voicedNotes: voiced, symbol: label };
}

const VARIATION_FNS = [applyInversion, applyRevoice, applyColorChange, applyOctaveShift, applyDropFifth];

/**
 * Creates a varied copy of the base loop for a given repeat.
 * Picks 1–2 random chord positions and applies a random micro-variation
 * to each. The base loop is never mutated.
 */
function createVariedLoop(base) {
  const varied = base.map(c => ({ ...c }));
  const count = varied.length;
  if (count === 0) return varied;

  // Pick 1–3 chord indices to vary (biased toward more changes)
  let numChanges;
  if (count <= 2) {
    numChanges = 1;
  } else {
    const roll = Math.random();
    if (roll < 0.25) numChanges = 1;
    else if (roll < 0.65) numChanges = 2;
    else numChanges = Math.min(3, count);
  }
  const indices = new Set();
  while (indices.size < numChanges) {
    indices.add(Math.floor(Math.random() * count));
  }

  const changes = [];
  for (const idx of indices) {
    const fn = VARIATION_FNS[Math.floor(Math.random() * VARIATION_FNS.length)];
    varied[idx] = fn(varied[idx]);
    changes.push(`#${idx + 1}→${varied[idx].symbol}`);
  }

  return varied;
}

/**
 * Generates a fresh loop progression using the taste-profile generator.
 *
 * Each cycle:
 *   - chains from the last chord of the previous progression (smooth transition)
 *   - may shift root note (~30% chance) if no previous chord to chain from
 *   - picks a progression pattern with quality-based chord building + random colors
 *   - gently drifts tempo
 */
function generateLoopProgression() {
  const loopOctave = pickOctave();

  const opts = { octave: loopOctave };

  if (lastChord) {
    // Pass the last chord root — generateProgression will decide whether
    // to stay in this key or modulate to a related one via pivot chords
    opts.startChordRoot = lastChord.root;
  } else {
    maybeChangeRoot();
    opts.key = config.rootNote;
  }

  const prog = generateProgression(opts);

  const chords = prog.chords.map((chord, idx) => {
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

  // Remember the last chord for next cycle's chaining
  lastChord = chords[chords.length - 1];

  baseLoop = chords;
  loop = chords;   // first pass plays the original
  loopPosition = 0;
  loopPassCount = 0;

  const symbols = chords.map(c => c.symbol).join(' → ');
  const rhythmStr = prog.rhythm.map(t => `×${t / TICKS_PER_UNIT}`).join(' ');
  const section = getCurrentSection();
  console.log(
    `[loop] ── new progression ──  ${prog.key} | ${symbols} ` +
    `| rhythm [${rhythmStr}] ` +
    `(${config.tempo.current}bpm) [${section.type}]`
  );
}

/**
 * Returns the next chord snapshot from the loop, advancing position.
 *
 * Progression generation is driven by the song structure state machine:
 * a new progression is only generated at the start of each song cycle
 * (when entering the transition section). Between cycles the same
 * progression loops with micro-variations on every pass.
 */
function advanceLoop() {
  // First-ever call — need an initial progression
  const needsFirstLoop = loop.length === 0;

  if (needsFirstLoop) {
    loopPosition = 0;
    loopPassCount = 0;

    try {
      generateLoopProgression();
    } catch (err) {
      console.error('[loop] generation failed:', err);
      if (loop.length === 0) throw err;
    }
  }

  // At the start of each new pass (not the very first), apply variation
  // and notify the song structure that a pass completed
  if (!needsFirstLoop && loopPosition === 0) {
    loopPassCount++;
    const { sectionChanged, isNewCycle } = advanceSongProgression();

    if (isNewCycle) {
      // New song cycle — generate a fresh chord progression
      try {
        generateLoopProgression();
      } catch (err) {
        console.error('[loop] generation failed, replaying previous loop:', err);
      }
      loopPassCount = 0;
      driftTempo();

      // Swap to a new random texture sample for this cycle
      if (texturePlayer) {
        texturePlayer.swap();
      }

      // Swap to a new random lead instrument for this cycle
      // Re-sync envelopes after swap so attack/release config applies to the new synth
      if (swapLeadFn) {
        swapLeadFn().then(() => syncEnvelopesToDuration());
      }
    } else if (loopPassCount > 0) {
      // Same cycle — apply micro-variations to keep it fresh
      loop = createVariedLoop(baseLoop);
    }
  }

  const chord = loop[loopPosition];
  lastPlayedPosition = loopPosition;
  chord._isNewCycle = needsFirstLoop;
  loopPosition++;

  if (loopPosition >= loop.length) {
    loopPosition = 0;
  }

  return chord;
}

/**
 * Core chord event — fires every chordDuration via setTimeout.
 *
 * Uses setTimeout instead of Tone.Transport.scheduleOnce to avoid
 * accumulated timing drift and time-domain mixing between Transport
 * time and audio-context time. For 7+ second chord intervals the
 * ~15ms jitter of setTimeout is completely inaudible.
 */
function scheduleNextChord() {
  if (!running) return;

  chordCount++;
  const baseSec = chordDurationInSeconds();

  // ── Get chord from loop ──
  const chord = advanceLoop();
  const { voicedNotes, offsets, notes, durationTicks } = chord;

  // Per-chord duration scaled by its rhythm weight
  const chordSec = baseSec * durationTicks / TICKS_PER_UNIT;

  // ── Section-aware instrument triggers ──
  const section = getCurrentSection();
  const now = Tone.now();

  if (section.tracks.pad) {
    triggerPadChord(synths, voicedNotes, offsets, now);
  }

  if (section.tracks.lead) {
    triggerLeadChord(synths, voicedNotes, offsets, now);
  }

  // Update dynamic filters (lead ↔ texture brightness) on every chord.
  // Pass section progress (refined with chord position) so values interpolate
  // gradually toward the next section rather than jumping at boundaries.
  // Use lastPlayedPosition+1 (not the post-increment loopPosition) to avoid
  // progress dropping backward when loopPosition wraps to 0.
  const coarseProgress = getSectionProgress();
  const chordFraction = loop.length > 0 ? ((lastPlayedPosition + 1) / loop.length) / section.duration : 0;
  const progress = Math.min(1, coarseProgress + chordFraction);
  updateSectionAutomation(section.type, getNextSection().type, progress, chordSec * 0.8);

  if (section.tracks.drone) {
    const bassNoteName = notes[0].match(/^([A-G]#?)/)[1];
    const droneNote = `${bassNoteName}2`;
    triggerDrone(synths, droneNote, chordSec, now);
  }

  // ── Schedule next chord ──
  // Recalculate base in case driftTempo changed the target BPM
  const nextBaseSec = chord._isNewCycle ? chordDurationInSeconds() : baseSec;
  const nextChordSec = nextBaseSec * durationTicks / TICKS_PER_UNIT;
  loopTimeoutId = setTimeout(scheduleNextChord, nextChordSec * 1000);
}

/**
 * Starts the generative engine.
 * @param {object} mixerSynths - Synths from the mixer
 * @param {object} [mixerTexturePlayer] - Texture sample player from the mixer
 * @param {object} [callbacks] - Optional callbacks for cycle events
 * @param {Function} [callbacks.onSwapLead] - Called each new cycle to swap lead instrument
 */
export function start(mixerSynths, mixerTexturePlayer, callbacks = {}) {
  if (running) return;
  synths = mixerSynths;
  texturePlayer = mixerTexturePlayer || null;
  swapLeadFn = callbacks.onSwapLead || null;
  running = true;
  chordCount = 0;
  baseLoop = [];
  loop = [];
  loopPosition = 0;
  loopPassCount = 0;
  lastPlayedPosition = 0;

  initSongStructure();
  setTempoImmediate(config.tempo.current);
  syncEnvelopesToDuration();

  console.log(`[engine] starting — ${config.rootNote} minor, ${config.tempo.current}bpm`);

  startClock();

  // Start the texture sample layer (loops a random file continuously)
  if (texturePlayer) {
    texturePlayer.start();
  }

  // First chord after a short delay to let audio context settle
  loopTimeoutId = setTimeout(scheduleNextChord, 100);
}

/**
 * Stops the generative engine.
 */
export function stop() {
  if (!running) return;
  console.log('[engine] stopped');
  running = false;

  if (loopTimeoutId !== null) {
    clearTimeout(loopTimeoutId);
    loopTimeoutId = null;
  }

  stopClock();

  // Stop the texture sample layer
  if (texturePlayer) {
    texturePlayer.stop();
  }

  if (synths && synths.pad && synths.pad.releaseAll) {
    synths.pad.releaseAll(Tone.now());
  }
  if (synths && synths.lead && synths.lead.releaseAll) {
    synths.lead.releaseAll(Tone.now());
  }
  if (synths && synths.drone && synths.drone.releaseAll) {
    synths.drone.releaseAll(Tone.now());
  }

  chordCount = 0;
  baseLoop = [];
  loop = [];
  loopPosition = 0;
  loopPassCount = 0;
  lastPlayedPosition = 0;
  lastChord = null;
  swapLeadFn = null;
}

/**
 * Updates the rules configuration. Accepts a partial config.
 * @param {object} partialConfig
 */
export function updateRules(partialConfig) {
  Object.assign(config, partialConfig);

  if (partialConfig.tempo) {
    rampTempo(config.tempo.current);
  }

  syncEnvelopesToDuration();
}

/**
 * Scales pad and drone envelopes proportionally to chord duration.
 */
function syncEnvelopesToDuration() {
  if (!synths) return;
  const chordSec = chordDurationInSeconds();
  const atk = config.attackLevel;
  const rel = config.releaseLevel;
  if (synths.pad && synths.pad.updateEnvelopes) {
    synths.pad.updateEnvelopes(chordSec, atk, rel);
  }
  if (synths.drone && synths.drone.updateEnvelopes) {
    synths.drone.updateEnvelopes(chordSec, atk, rel);
  }
  if (synths.lead && synths.lead.updateEnvelopes) {
    synths.lead.updateEnvelopes(chordSec, atk, rel);
  }
}

export function getConfig() {
  return { ...config };
}
