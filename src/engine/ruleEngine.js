import * as Tone from 'tone';
import rulesConfig from './rules.config.js';
import { generateProgression, MINOR_KEYS, TICKS_PER_UNIT } from '../harmony/progression.js';
import { voiceChord } from '../harmony/voicing.js';
import { triggerPadChord, triggerDrone, triggerTexture, triggerBell } from '../rhythm/scheduler.js';
import {
  startClock, stopClock,
  setTempoImmediate, rampTempo, getTargetBpm,
} from '../rhythm/clock.js';

let config = { ...rulesConfig };
let synths = null;
let running = false;
let chordCount = 0;
let loopTimeoutId = null;

// ── Loop state ──
// A loop is a variable-length progression that repeats `REPEATS_PER_CYCLE`
// times before a fresh progression is generated.
const REPEATS_PER_CYCLE = 4;

let loop = [];           // Array of pre-built chord snapshots (variable length)
let loopPosition = 0;    // Current chord within the loop
let loopRepeatCount = 0; // How many times the current loop has fully played

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
 * Picks a base octave appropriate for dark music (octaves 3–4).
 */
function pickOctave() {
  return 3 + Math.floor(Math.random() * 2);
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
    // Chain: the previous progression's last chord becomes this one's first
    opts.startChordRoot = lastChord.root;
    opts.startChordQuality = lastChord.quality;
  } else {
    maybeChangeRoot();
    opts.key = config.rootNote;
  }

  const prog = generateProgression(opts);

  const chords = prog.chords.map((chord, idx) => {
    const { notes: voicedNotes, offsets } = voiceChord(chord.notes, 1, true);
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

  loop = chords;
  loopPosition = 0;
  loopRepeatCount = 0;

  const symbols = chords.map(c => c.symbol).join(' → ');
  const rhythmStr = prog.rhythm.map(t => `×${t / TICKS_PER_UNIT}`).join(' ');
  console.log(
    `[loop] ── new progression ──  ${prog.key} | ${symbols} ` +
    `| rhythm [${rhythmStr}] ` +
    `(${config.tempo.current}bpm)`
  );
}

/**
 * Returns the next chord snapshot from the loop, advancing position.
 * Automatically regenerates the progression after REPEATS_PER_CYCLE full plays.
 */
function advanceLoop() {
  const needsNewLoop = loop.length === 0 || (loopPosition === 0 && loopRepeatCount >= REPEATS_PER_CYCLE);

  if (needsNewLoop) {
    loopRepeatCount = 0;
    loopPosition = 0;

    try {
      generateLoopProgression();
    } catch (err) {
      console.error('[loop] generation failed, replaying previous loop:', err);
      if (loop.length === 0) throw err;
    }
  }

  const chord = loop[loopPosition];
  chord._newCycle = needsNewLoop;
  loopPosition++;

  if (loopPosition >= loop.length) {
    loopPosition = 0;
    loopRepeatCount++;
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

  // ── Trigger all instruments at current audio time ──
  const now = Tone.now();

  // Pad: release old + attack new = crossfade
  triggerPadChord(synths, voicedNotes, offsets, now);

  // Drone: root note, lasts the full chord duration
  const bassNoteName = notes[0].match(/^([A-G]#?)/)[1];
  const droneNote = `${bassNoteName}2`;
  triggerDrone(synths, droneNote, chordSec, now);

  // Texture: atmospheric wash
  triggerTexture(synths, chordSec, now);

  // Bell: arpeggiate highest chord notes across 4 quarter-divisions
  triggerBell(synths, voicedNotes, chordSec, now);

  // ── Drift tempo on new cycles ──
  if (chord._newCycle) {
    driftTempo();
  }

  // ── Schedule next chord ──
  // Recalculate base in case driftTempo changed the target BPM
  const nextBaseSec = chord._newCycle ? chordDurationInSeconds() : baseSec;
  const nextChordSec = nextBaseSec * durationTicks / TICKS_PER_UNIT;
  loopTimeoutId = setTimeout(scheduleNextChord, nextChordSec * 1000);
}

/**
 * Starts the generative engine.
 * @param {object} mixerSynths - Synths from the mixer
 */
export function start(mixerSynths) {
  if (running) return;
  synths = mixerSynths;
  running = true;
  chordCount = 0;
  loop = [];
  loopPosition = 0;
  loopRepeatCount = 0;

  setTempoImmediate(config.tempo.current);
  syncEnvelopesToDuration();

  console.log(`[engine] starting — ${config.rootNote} minor, ${config.tempo.current}bpm`);

  startClock();

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

  if (synths && synths.pad && synths.pad.releaseAll) {
    synths.pad.releaseAll(Tone.now());
  }

  chordCount = 0;
  loop = [];
  loopPosition = 0;
  loopRepeatCount = 0;
  lastChord = null;
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
}

export function getConfig() {
  return { ...config };
}
