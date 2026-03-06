/**
 * Rule engine — the central brain of the generative system.
 *
 * Generates chord progressions, schedules chord events via setTimeout,
 * manages the song structure state machine, and triggers synths via
 * the scheduler module (which sends OSC to SuperCollider).
 *
 * This module is almost identical to the Tone.js version. The key
 * differences:
 *   - No Tone.js imports
 *   - No audio-context time — just uses setTimeout scheduling
 *   - Synth triggers don't pass a `time` parameter (SC handles timing)
 *   - Release calls don't pass a `time` parameter
 */

import rulesConfig, { CHORD_SKIP_PROBABILITY, TRACK_SKIP_RELEASE, SECTION_DURATIONS } from './rules.config.js';
import { generateProgression, rebuildChordWithColor, MINOR_KEYS, TICKS_PER_UNIT } from '../harmony/progression.js';
import { voiceChord } from '../harmony/voicing.js';
// Synth triggers are now provided via the chordTriggers registry from mixer
import {
  startClock, stopClock,
  setTempoImmediate, rampTempo, getTargetBpm,
} from '../rhythm/clock.js';
import {
  initSongStructure, getCurrentSection, getNextSection, getSectionProgress,
  advanceSongProgression, getSongState,
} from './songStructure.js';
import { updateSectionAutomation } from '../audio/effects/sectionAutomation.js';
import { pickChordPlayingRule, applyChordPlayingRule, getCurrentRule, getBassOffsetBeat, getRuleState } from './chordPlayingRule.js';
import {
  setPedalSynth, findPedalNote, startPedalFadeIn,
  schedulePedalFadeOut, stopPedal,
} from './pedalTone.js';

let config = { ...rulesConfig };
let synths = null;
let texturePlayer = null;
let chordTriggers = [];
let swapLeadFn = null;
let swapBassFn = null;
let swapPedalPadFn = null;
let running = false;
let chordCount = 0;
let loopTimeoutId = null;

// ── Plucked instrument state ──
let leadIsPlucked = false;
let bassIsPlucked = false;

// ── Loop state ──
let baseLoop = [];
let loop = [];
let loopPosition = 0;
let loopPassCount = 0;
let lastPlayedPosition = 0;

/**
 * Converts chordDuration (in measures of 4/4) to seconds.
 */
function chordDurationInSeconds() {
  const bpm = getTargetBpm();
  return config.chordDuration * 4 * (60 / bpm);
}

function pickOctave() {
  return Math.random() < 0.7 ? 4 : 3;
}

function maybeChangeRoot() {
  if (Math.random() < 0.3) {
    config.rootNote = MINOR_KEYS[Math.floor(Math.random() * MINOR_KEYS.length)];
  }
}

function driftTempo() {
  const { min, max } = config.tempo;
  const drift = (Math.random() - 0.5) * 8;
  const newBpm = Math.round(Math.min(max, Math.max(min, config.tempo.current + drift)));
  config.tempo.current = newBpm;
  rampTempo(newBpm);
}

function swapInstrumentsForCycle() {
  const swaps = [];
  if (swapLeadFn) swaps.push(swapLeadFn().catch(err => { console.warn('[engine] lead swap failed:', err); return null; }));
  if (swapBassFn) swaps.push(swapBassFn().catch(err => { console.warn('[engine] bass swap failed:', err); return null; }));

  if (swaps.length === 0) {
    pickChordPlayingRule({ leadPlucked: leadIsPlucked, bassPlucked: bassIsPlucked, progressionLength: baseLoop.length });
    return;
  }

  Promise.all(swaps).then(results => {
    if (!running) return;

    // Update plucked state from whichever swaps succeeded
    for (const result of results) {
      if (!result) continue;
      if ('plucked' in result) {
        // swapLeadRandom returns first, swapBassRandom second
        if (results.indexOf(result) === 0 && swapLeadFn) {
          leadIsPlucked = result.plucked ?? false;
        } else {
          bassIsPlucked = result.plucked ?? false;
        }
      }
    }

    // Pick rule AFTER swaps complete so plucked state is accurate
    pickChordPlayingRule({ leadPlucked: leadIsPlucked, bassPlucked: bassIsPlucked, progressionLength: baseLoop.length });
    syncEnvelopesToDuration();

    console.log(
      `[engine] instruments swapped — lead ${leadIsPlucked ? 'plucked' : 'loopable'}, ` +
      `bass ${bassIsPlucked ? 'plucked' : 'loopable'}`
    );
  });
}

let lastChord = null;

// Pre-generated progression for the next song cycle (created during outro)
let pendingProgression = null;

// ── Loop variation helpers ──

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

function createVariedLoop(base) {
  const varied = base.map(c => ({ ...c }));
  const count = varied.length;
  if (count === 0) return varied;

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

  if (numChanges === 0) return varied;

  const indices = new Set();
  while (indices.size < numChanges) {
    indices.add(Math.floor(Math.random() * count));
  }

  for (const idx of indices) {
    const fn = VARIATION_FNS[Math.floor(Math.random() * VARIATION_FNS.length)];
    varied[idx] = fn(varied[idx]);
  }

  return varied;
}

function generateLoopProgression() {
  const loopOctave = pickOctave();
  const opts = { octave: loopOctave };

  if (lastChord) {
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

  lastChord = chords[chords.length - 1];

  baseLoop = chords;
  loop = chords;
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
 * Pre-generates the next progression during the outro so the pedal tone
 * system can find and start playing a common note before the cycle ends.
 * Does NOT mutate loop state — stores result in pendingProgression.
 */
function preGenerateNextProgression() {
  const loopOctave = pickOctave();
  const opts = { octave: loopOctave };

  if (lastChord) {
    opts.startChordRoot = lastChord.root;
  } else {
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

  pendingProgression = { chords, prog };

  const symbols = chords.map(c => c.symbol).join(' → ');
  console.log(`[pedal] pre-generated next progression: ${prog.key} | ${symbols}`);
  return { chords, key: prog.key };
}

function advanceLoop() {
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

  if (!needsFirstLoop && loopPosition === 0) {
    loopPassCount++;
    const { sectionChanged, isNewCycle } = advanceSongProgression();

    // Entering the outro → swap pad, pre-generate next progression, start pedal tone
    if (sectionChanged && !isNewCycle && getCurrentSection().type === 'outro') {
      let pedalPC, outroSec;
      try {
        const { chords, key } = preGenerateNextProgression();
        const keyRoot = key.replace(' minor', '');
        pedalPC = findPedalNote(chords, keyRoot);
        const baseSec = chordDurationInSeconds();
        outroSec = SECTION_DURATIONS.outro * loop.length * baseSec;
      } catch (err) {
        console.warn('[pedal] pre-generation failed:', err);
      }

      // Swap pad sample first, then start pedal tone on the new instrument
      const swapDone = swapPedalPadFn
        ? swapPedalPadFn().catch(err => { console.warn('[engine] pedalPad swap failed:', err); })
        : Promise.resolve();

      if (pedalPC) {
        swapDone.then(() => {
          if (!running) return;
          if (synths.pedalPad) setPedalSynth(synths.pedalPad);
          startPedalFadeIn(pedalPC, outroSec);
        });
      }
    }

    if (isNewCycle) {
      // Use pre-generated progression if available
      if (pendingProgression) {
        const { chords, prog } = pendingProgression;
        baseLoop = chords;
        loop = chords;
        loopPosition = 0;
        lastChord = chords[chords.length - 1];

        const symbols = chords.map(c => c.symbol).join(' → ');
        const section = getCurrentSection();
        console.log(
          `[loop] ── new progression (pre-generated) ──  ${prog.key} | ${symbols} ` +
          `(${config.tempo.current}bpm) [${section.type}]`
        );
        pendingProgression = null;
      } else {
        try {
          generateLoopProgression();
        } catch (err) {
          console.error('[loop] generation failed, replaying previous loop:', err);
        }
      }
      loopPassCount = 0;
      driftTempo();

      // Schedule pedal tone fade-out during intro or main1
      const baseSec = chordDurationInSeconds();
      const transitionSec = SECTION_DURATIONS.transition * loop.length * baseSec;
      const introSec = SECTION_DURATIONS.intro * loop.length * baseSec;
      const mainSec = SECTION_DURATIONS.main * loop.length * baseSec;
      schedulePedalFadeOut(transitionSec, introSec, mainSec);

      if (texturePlayer) {
        texturePlayer.swap();
      }

      swapInstrumentsForCycle();
    } else if (loopPassCount > 0) {
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
 */
function scheduleNextChord() {
  if (!running) return;

  let nextDelayMs = 4000; // fallback delay if everything fails

  try {
    chordCount++;
    const baseSec = chordDurationInSeconds();

    const chord = advanceLoop();
    const { voicedNotes, offsets, notes, durationTicks } = chord;

    const chordSec = baseSec * durationTicks / TICKS_PER_UNIT;

    // ── Section-aware chord skip ──
    const section = getCurrentSection();
    const skipChance = CHORD_SKIP_PROBABILITY[section.type] || 0;
    const skipThisChord = skipChance > 0 && Math.random() < skipChance;

    if (skipThisChord) {
      console.log(`[engine] skipping chord ${chord.symbol} (${section.type} skip, ${Math.round(skipChance * 100)}%)`);

      // Release held notes on tracks configured for skip release
      for (const [trackName, synth] of Object.entries(synths)) {
        if (synth?.releaseAll && TRACK_SKIP_RELEASE[trackName]) {
          synth.releaseAll();
        }
      }
    } else {
      const schedule = applyChordPlayingRule(voicedNotes, chordSec);

      // Derive drone context for the bass trigger
      const bassNoteName = notes[0].match(/^([A-G]#?)/)[1];
      const droneNote = `${bassNoteName}2`;
      const bassOffset = getBassOffsetBeat(lastPlayedPosition);

      const triggerCtx = { schedule, offsets, chordSec, droneNote, bassOffset };

      // Fire all registered chord triggers for tracks active in this section
      for (const entry of chordTriggers) {
        if (!section.tracks[entry.track]) continue;
        try {
          entry.trigger(synths, triggerCtx);
        } catch (err) {
          console.warn(`[engine] error triggering ${entry.track}, continuing:`, err);
        }
      }
    }

    // Update section automation on every chord
    try {
      const coarseProgress = getSectionProgress();
      const chordFraction = loop.length > 0 ? ((lastPlayedPosition + 1) / loop.length) / section.duration : 0;
      const progress = Math.min(1, coarseProgress + chordFraction);
      updateSectionAutomation(section.type, getNextSection().type, progress, chordSec * 0.8);
    } catch (err) {
      console.warn('[engine] error updating section automation:', err);
    }

    // ── Schedule next chord ──
    const nextBaseSec = chord._isNewCycle ? chordDurationInSeconds() : baseSec;
    const nextChordSec = nextBaseSec * durationTicks / TICKS_PER_UNIT;
    nextDelayMs = nextChordSec * 1000;
  } catch (err) {
    console.error('[engine] scheduleNextChord error, recovering:', err);
  }

  // Always re-schedule — even after an error — to keep the engine alive
  loopTimeoutId = setTimeout(scheduleNextChord, nextDelayMs);
}

/**
 * Starts the generative engine.
 */
export function start(mixerSynths, mixerTexturePlayer, callbacks = {}) {
  if (running) return;
  synths = mixerSynths;
  texturePlayer = mixerTexturePlayer || null;
  chordTriggers = callbacks.chordTriggers || [];
  swapLeadFn = callbacks.onSwapLead || null;
  swapBassFn = callbacks.onSwapBass || null;
  swapPedalPadFn = callbacks.onSwapPedalPad || null;
  running = true;
  chordCount = 0;
  baseLoop = [];
  loop = [];
  loopPosition = 0;
  loopPassCount = 0;
  lastPlayedPosition = 0;
  leadIsPlucked = false;
  bassIsPlucked = false;

  initSongStructure();
  pickChordPlayingRule();
  setTempoImmediate(config.tempo.current);
  syncEnvelopesToDuration();

  // Wire up pedal tone synth
  if (synths.pedalPad) {
    setPedalSynth(synths.pedalPad);
  }

  console.log(`[engine] starting — ${config.rootNote} minor, ${config.tempo.current}bpm`);

  startClock();

  if (texturePlayer) {
    texturePlayer.start();
  }

  swapInstrumentsForCycle();

  // First chord after a short delay
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

  if (texturePlayer) {
    texturePlayer.stop();
  }

  if (synths && synths.pad && synths.pad.releaseAll)   synths.pad.releaseAll();
  if (synths && synths.lead && synths.lead.releaseAll)  synths.lead.releaseAll();
  if (synths && synths.drone && synths.drone.releaseAll) synths.drone.releaseAll();

  stopPedal();

  chordCount = 0;
  baseLoop = [];
  loop = [];
  loopPosition = 0;
  loopPassCount = 0;
  lastPlayedPosition = 0;
  lastChord = null;
  pendingProgression = null;
  swapLeadFn = null;
  swapBassFn = null;
  swapPedalPadFn = null;
  leadIsPlucked = false;
  bassIsPlucked = false;
}

export function updateRules(partialConfig) {
  Object.assign(config, partialConfig);

  if (partialConfig.tempo) {
    rampTempo(config.tempo.current);
  }

  syncEnvelopesToDuration();
}

function syncEnvelopesToDuration() {
  if (!synths) return;
  const chordSec = chordDurationInSeconds();
  const atk = config.attackLevel;
  const rel = config.releaseLevel;
  if (synths.pad && synths.pad.updateEnvelopes)   synths.pad.updateEnvelopes(chordSec, atk, rel);
  if (synths.drone && synths.drone.updateEnvelopes) synths.drone.updateEnvelopes(chordSec, atk, rel);
  if (synths.lead && synths.lead.updateEnvelopes)  synths.lead.updateEnvelopes(chordSec, atk, rel);
}

export function getConfig() {
  return { ...config };
}

/**
 * Returns a snapshot of the full engine state for the debug UI.
 */
export function getEngineState() {
  const baseSec = running ? chordDurationInSeconds() : 0;
  return {
    running,
    chordCount,
    loopPosition,
    loopLength: loop.length,
    loopPassCount,
    lastPlayedPosition,
    leadIsPlucked,
    bassIsPlucked,
    currentRule: getCurrentRule(),
    ruleState: getRuleState(),
    baseDurationSec: Math.round(baseSec * 100) / 100,
    progression: loop.map(c => {
      const actualSec = baseSec * c.durationTicks / TICKS_PER_UNIT;
      return {
        symbol: c.symbol,
        root: c.root,
        quality: c.quality,
        octave: c.octave,
        voicedNotes: c.voicedNotes,
        notes: c.notes,
        durationTicks: c.durationTicks,
        durationSec: Math.round(actualSec * 100) / 100,
        rhythmMultiplier: c.durationTicks / TICKS_PER_UNIT,
      };
    }),
    lastChordSymbol: lastChord ? lastChord.symbol : null,
  };
}
