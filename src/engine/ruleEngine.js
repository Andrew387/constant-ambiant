/**
 * Rule engine — the central brain of the generative system.
 *
 * Schedules chord events via setTimeout, manages the song structure
 * state machine, orchestrates instrument swaps, and triggers synths
 * via the scheduler module (which sends OSC to SuperCollider).
 *
 * Loop state (progressions, variation, position tracking) is delegated
 * to loopManager.js. This module focuses on scheduling and orchestration.
 */

import rulesConfig, { CHORD_SKIP_PROBABILITY, TRACK_SKIP_RELEASE, SECTION_DURATIONS, scaleSectionDurations } from './rules.config.js';
import { MINOR_KEYS, TICKS_PER_UNIT } from '../harmony/progression.js';
import {
  startClock, stopClock,
  setTempoImmediate, rampTempo, getTargetBpm,
} from '../rhythm/clock.js';
import {
  initSongStructure, getCurrentSection, getNextSection, getSectionProgress,
  advanceSongProgression, getSongState,
} from './songStructure.js';
import { updateSectionAutomation, setMainPresenceOverrides } from '../audio/effects/sectionAutomation.js';
import { pickChordPlayingRule, applyChordPlayingRule, getCurrentRule, getBassOffsetBeat, getRuleState, resetChordPlayingRule } from './chordPlayingRule.js';
import {
  setPedalSynth, findPedalNote, startPedalFadeIn,
  schedulePedalFadeOut, stopPedal,
} from './pedalTone.js';
import { setLeadPlucked } from '../audio/effects/leadReversedSwell.js';
import { setRiserBoomerLeadPlucked } from '../fx/riserBoomerPlayer.js';
import {
  generateLoopProgression, preGenerateNextProgression, installPendingProgression,
  getCurrentChordAndAdvance, isAtLoopStart, incrementLoopPass,
  resetLoopState, getBaseLoop, getLoop, getLoopPosition, getLoopPassCount,
  getLastPlayedPosition, getLastChord,
} from './loopManager.js';

let config = { ...rulesConfig };
let synths = null;
let texturePlayer = null;
let chordTriggers = [];
let swapLeadFn = null;
let swapBassFn = null;
let swapPedalPadFn = null;
let swapBassSupportFn = null;
let swapLeadReversedFn = null;
let randomizeMasterEffectsFn = null;
let randomizeTrackEffectsFn = null;
let running = false;
let chordCount = 0;
let loopTimeoutId = null;

// ── Plucked instrument state ──
let leadIsPlucked = false;
let bassIsPlucked = false;

// ── First chord flag ──
let needsFirstLoop = true;

/**
 * Converts chordDuration (in measures of 4/4) to seconds.
 */
function chordDurationInSeconds() {
  const bpm = getTargetBpm();
  return config.chordDuration * 4 * (60 / bpm);
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

/**
 * Randomizes chordDuration, attackLevel, and releaseLevel per song cycle.
 *
 * Shorter chords get sharper (faster) attack/release; longer chords get
 * slower, more gradual envelopes. The ranges interpolate linearly across
 * the full [0.25, 2] chordDuration span for smooth granularity.
 *
 * No glitch risk: envelope params only affect newly-triggered notes.
 * Currently-sounding notes keep their old release tails, so the
 * transition section naturally crossfades between old and new character.
 */
function randomizeChordCharacter() {
  const prevDuration = config.chordDuration;
  const prevAttack = config.attackLevel;
  const prevRelease = config.releaseLevel;

  // Pick new chord duration in [0.25, 2]
  const newDuration = 0.25 + Math.random() * 1.75;

  // Normalize t ∈ [0, 1] across the full range
  const t = (newDuration - 0.25) / 1.75;

  // Interpolate attack bounds:  t=0 → [0, 0.5],  t=1 → [0.3, 1.0]
  const atkMin = 0 + t * 0.3;
  const atkMax = 0.5 + t * 0.5;
  const newAttack = atkMin + Math.random() * (atkMax - atkMin);

  // Interpolate release bounds: t=0 → [0.1, 1.0], t=1 → [0.7, 2.0]
  const relMin = 0.1 + t * 0.6;
  const relMax = 1.0 + t * 1.0;
  const newRelease = relMin + Math.random() * (relMax - relMin);

  config.chordDuration = newDuration;
  config.attackLevel = newAttack;
  config.releaseLevel = newRelease;

  console.log(
    `[engine] chord character — duration ${prevDuration.toFixed(2)}→${newDuration.toFixed(2)} measures, ` +
    `attack ${prevAttack.toFixed(2)}→${newAttack.toFixed(2)}, ` +
    `release ${prevRelease.toFixed(2)}→${newRelease.toFixed(2)}`
  );
}

function swapInstrumentsForCycle() {
  const swaps = [];
  if (swapLeadFn) swaps.push(swapLeadFn().catch(err => { console.warn('[engine] lead swap failed:', err); return null; }));
  if (swapBassFn) swaps.push(swapBassFn().catch(err => { console.warn('[engine] bass swap failed:', err); return null; }));

  // Swap bass-support and lead-reversed pads independently (fire-and-forget)
  if (swapBassSupportFn) {
    swapBassSupportFn().catch(err => { console.warn('[engine] bassSupport swap failed:', err); });
  }
  if (swapLeadReversedFn) {
    swapLeadReversedFn().catch(err => { console.warn('[engine] leadReversed swap failed:', err); });
  }

  if (swaps.length === 0) {
    pickChordPlayingRule({ leadPlucked: leadIsPlucked, bassPlucked: bassIsPlucked, progressionLength: getBaseLoop().length });
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
    pickChordPlayingRule({ leadPlucked: leadIsPlucked, bassPlucked: bassIsPlucked, progressionLength: getBaseLoop().length });
    setLeadPlucked(leadIsPlucked);
    setRiserBoomerLeadPlucked(leadIsPlucked);
    syncEnvelopesToDuration();

    console.log(
      `[engine] instruments swapped — lead ${leadIsPlucked ? 'plucked' : 'loopable'}, ` +
      `bass ${bassIsPlucked ? 'plucked' : 'loopable'}`
    );
  });
}

/**
 * Handles a new song cycle: installs progression, randomizes character,
 * swaps instruments, schedules pedal fade-out.
 */
function handleNewCycle() {
  if (!installPendingProgression()) {
    try {
      generateLoopProgression(config, maybeChangeRoot);
    } catch (err) {
      console.error('[loop] generation failed, replaying previous loop:', err);
    }
  }

  randomizeChordCharacter();
  scaleSectionDurations(config.chordDuration);
  driftTempo();
  syncEnvelopesToDuration();

  // Randomize main-section presence for pedalPad and archive.
  // Uses previous cycle's leadIsPlucked (swaps haven't completed yet).
  // Plucked lead → higher minimum ensures these layers stay audible.
  const presenceMin = leadIsPlucked ? 0.2 : 0;
  const ppPresence  = presenceMin + Math.random() * (0.7 - presenceMin);
  const archPresence = presenceMin + Math.random() * (0.7 - presenceMin);
  setMainPresenceOverrides({ archive: archPresence, pedalPad: ppPresence });

  // Schedule pedal tone fade-out — presence pushes release later
  const loop = getLoop();
  const baseSec = chordDurationInSeconds();
  const transitionSec = SECTION_DURATIONS.transition * loop.length * baseSec;
  const introSec = SECTION_DURATIONS.intro * loop.length * baseSec;
  const mainSec = SECTION_DURATIONS.main * loop.length * baseSec;
  const innerTransitionSec = SECTION_DURATIONS.innerTransition * loop.length * baseSec;
  const main2Sec = SECTION_DURATIONS.main2 * loop.length * baseSec;
  schedulePedalFadeOut(transitionSec, introSec, mainSec, innerTransitionSec, main2Sec, ppPresence);

  if (texturePlayer) {
    texturePlayer.swap();
  }

  if (randomizeMasterEffectsFn) {
    randomizeMasterEffectsFn();
  }
  if (randomizeTrackEffectsFn) {
    randomizeTrackEffectsFn();
  }

  swapInstrumentsForCycle();
}

/**
 * Handles entering the outro section: pre-generates next progression
 * and starts pedal tone.
 */
function handleOutroEntry() {
  let pedalPC, outroSec;
  try {
    const { chords, key } = preGenerateNextProgression();
    const keyRoot = key.replace(' minor', '');
    pedalPC = findPedalNote(chords, keyRoot);
    const baseSec = chordDurationInSeconds();
    outroSec = SECTION_DURATIONS.outro * getLoop().length * baseSec;
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

/**
 * Called by loopManager when the loop wraps around (loopPassCount incremented).
 * Advances song structure and triggers cycle/section transitions.
 *
 * @param {number} loopPassCount - Current loop pass (already incremented)
 * @returns {{ newCycle: boolean }}
 */
function onLoopPass(loopPassCount) {
  const { sectionChanged, isNewCycle } = advanceSongProgression();

  // Entering the outro → swap pad, pre-generate next progression, start pedal tone
  if (sectionChanged && !isNewCycle && getCurrentSection().type === 'outro') {
    handleOutroEntry();
  }

  if (isNewCycle) {
    handleNewCycle();
    return { newCycle: true };
  }

  return { newCycle: false };
}

/**
 * Core chord event — fires every chordDuration via setTimeout.
 */
function scheduleNextChord() {
  if (!running) return;

  let nextDelayMs = 4000; // fallback delay if everything fails

  try {
    chordCount++;
    const isFirst = needsFirstLoop;
    if (needsFirstLoop) needsFirstLoop = false;

    const baseSec = chordDurationInSeconds();

    // Generate first progression if needed
    if (isFirst || getLoop().length === 0) {
      try {
        generateLoopProgression(config, maybeChangeRoot);
      } catch (err) {
        console.error('[loop] generation failed:', err);
        if (getLoop().length === 0) throw err;
      }
    }

    // Handle loop wrap (but not on the very first chord)
    if (!isFirst && isAtLoopStart()) {
      incrementLoopPass();
      onLoopPass(getLoopPassCount());
    }

    // Get current chord and advance position
    const { chord, leadReversedChord } = getCurrentChordAndAdvance();

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
      const bassOffset = getBassOffsetBeat(getLastPlayedPosition());

      const triggerCtx = { schedule, offsets, chordSec, droneNote, bassOffset, bassIsPlucked, leadReversedChord };

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
      const loop = getLoop();
      const section = getCurrentSection();
      const coarseProgress = getSectionProgress();
      const chordFraction = loop.length > 0 ? ((getLastPlayedPosition() + 1) / loop.length) / section.duration : 0;
      const progress = Math.min(1, coarseProgress + chordFraction);
      updateSectionAutomation(section.type, getNextSection().type, progress, chordSec * 0.8);
    } catch (err) {
      console.warn('[engine] error updating section automation:', err);
    }

    // ── Schedule next chord ──
    const nextBaseSec = isFirst ? chordDurationInSeconds() : baseSec;
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
  swapBassSupportFn = callbacks.onSwapBassSupport || null;
  swapLeadReversedFn = callbacks.onSwapLeadReversed || null;
  randomizeMasterEffectsFn = callbacks.onRandomizeMasterEffects || null;
  randomizeTrackEffectsFn = callbacks.onRandomizeTrackEffects || null;
  running = true;
  chordCount = 0;
  needsFirstLoop = true;
  leadIsPlucked = false;
  bassIsPlucked = false;
  setLeadPlucked(false);
  setRiserBoomerLeadPlucked(false);

  resetLoopState();
  initSongStructure();
  resetChordPlayingRule();
  pickChordPlayingRule();
  randomizeChordCharacter();
  setTempoImmediate(config.tempo.current);
  syncEnvelopesToDuration();

  // Wire up pedal tone synth
  if (synths.pedalPad) {
    setPedalSynth(synths.pedalPad);
  }

  // Randomize effects for the first song cycle
  if (randomizeMasterEffectsFn) {
    randomizeMasterEffectsFn();
  }
  if (randomizeTrackEffectsFn) {
    randomizeTrackEffectsFn();
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

  if (synths && synths.lead && synths.lead.releaseAll)  synths.lead.releaseAll();
  if (synths && synths.drone && synths.drone.releaseAll) synths.drone.releaseAll();
  if (synths && synths.drone2 && synths.drone2.releaseAll) synths.drone2.releaseAll();
  if (synths && synths.leadReversed && synths.leadReversed.releaseAll) synths.leadReversed.releaseAll();

  stopPedal();

  resetLoopState();
  swapLeadFn = null;
  swapBassFn = null;
  swapPedalPadFn = null;
  swapBassSupportFn = null;
  swapLeadReversedFn = null;
  randomizeMasterEffectsFn = null;
  randomizeTrackEffectsFn = null;
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
  if (synths.drone && synths.drone.updateEnvelopes) synths.drone.updateEnvelopes(chordSec, atk, rel);
  if (synths.drone2 && synths.drone2.updateEnvelopes) synths.drone2.updateEnvelopes(chordSec, atk, rel);
  if (synths.lead && synths.lead.updateEnvelopes)  synths.lead.updateEnvelopes(chordSec, atk, rel);
  if (synths.bassSupport && synths.bassSupport.updateEnvelopes) synths.bassSupport.updateEnvelopes(chordSec, atk, rel);
  if (synths.leadReversed && synths.leadReversed.updateEnvelopes) synths.leadReversed.updateEnvelopes(chordSec, atk, rel);
}

export function getConfig() {
  return { ...config };
}

/**
 * Returns a snapshot of the full engine state for the debug UI.
 */
export function getEngineState() {
  const baseSec = running ? chordDurationInSeconds() : 0;
  const loop = getLoop();
  return {
    running,
    chordCount,
    loopPosition: getLoopPosition(),
    loopLength: loop.length,
    loopPassCount: getLoopPassCount(),
    lastPlayedPosition: getLastPlayedPosition(),
    leadIsPlucked,
    bassIsPlucked,
    currentRule: getCurrentRule(),
    ruleState: getRuleState(),
    baseDurationSec: Math.round(baseSec * 100) / 100,
    chordDuration: Math.round(config.chordDuration * 100) / 100,
    attackLevel: Math.round(config.attackLevel * 100) / 100,
    releaseLevel: Math.round(config.releaseLevel * 100) / 100,
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
    lastChordSymbol: getLastChord() ? getLastChord().symbol : null,
  };
}
