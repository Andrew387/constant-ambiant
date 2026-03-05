/**
 * Sample-based instrument — OSC wrapper for SuperCollider SynthDefs.
 *
 * Uses \sampleLoop for loopable instruments and \sampleOneShot for plucked.
 * Each voice is a single SC synth node reading from a pre-loaded buffer.
 *
 * The crossfade looping is handled entirely by the SC SynthDef (two BufRd
 * readers with equal-power sin/cos gains) — no JS-side segment scheduling.
 */

import { synthNew, nodeSet, nodeFree } from '../../sc/osc.js';
import { allocNodeId, GROUPS, BUSES } from '../../sc/nodeIds.js';
import { ENVELOPE_FLOOR } from '../../engine/rules.config.js';
import {
  loadInstrumentSamples, freeInstrumentSamples, getInstrumentBuffers,
} from '../../sc/bufferManager.js';

const DEFAULT_LOOP_START = 0.8;
const DEFAULT_LOOP_END = 6.0;

/**
 * Creates a sample-based instrument.
 *
 * @param {object} config
 * @param {string}  config.id - Instrument identifier
 * @param {string}  config.folder - Path relative to samples/
 * @param {string}  config.filePrefix - Filename prefix
 * @param {boolean} config.plucked - true → one-shot, false → looped
 * @param {number}  [config.loopStart]
 * @param {number}  [config.loopEnd]
 * @param {object}  [options]
 * @param {number}  [options.outBus] - Output bus
 * @param {number}  [options.groupId] - SC group to place synths in
 * @returns {Promise<object>}
 */
export async function createSampleSynth(config, options = {}) {
  const {
    id: instrumentId, folder, filePrefix, plucked,
    loopStart = DEFAULT_LOOP_START, loopEnd = DEFAULT_LOOP_END,
  } = config;
  const outBus = options.outBus ?? BUSES.LEAD;
  const groupId = options.groupId ?? GROUPS.LEAD;

  // Load samples into SC buffers
  const noteBuffers = await loadInstrumentSamples(instrumentId, folder, filePrefix);

  console.log(
    `[samplePlayer] ${filePrefix} ready ` +
    `(${plucked ? 'plucked' : `loop ${loopStart}–${loopEnd}s`})`
  );

  // Active voices: Map<string, { nodeId }>
  const activeVoices = new Map();

  let attackTime = 2;
  let releaseTime = 4;

  function noteToFreq(note) {
    const match = note.match(/^([A-G]#?)(\d+)$/);
    if (!match) return 440;
    const noteNames = { 'C': 0, 'C#': 1, 'D': 2, 'D#': 3, 'E': 4, 'F': 5, 'F#': 6, 'G': 7, 'G#': 8, 'A': 9, 'A#': 10, 'B': 11 };
    const semitone = noteNames[match[1]];
    const octave = parseInt(match[2]);
    return semitone !== undefined ? 440 * Math.pow(2, ((octave + 1) * 12 + semitone - 69) / 12) : 440;
  }

  function startVoice(note) {
    const bufNum = noteBuffers.get(note);
    if (bufNum === undefined) {
      console.warn(`[samplePlayer] no buffer for ${note}`);
      return;
    }

    const nodeId = allocNodeId();
    const defName = plucked ? 'sampleOneShot' : 'sampleLoop';

    const params = {
      out: outBus,
      buf: bufNum,
      gate: 1,
      amp: 1,
      rate: 1.0,
    };

    if (plucked) {
      params.atkTime = 0.01;
      params.relTime = Math.min(releaseTime, 0.3);
    } else {
      params.loopStart = loopStart;
      params.loopEnd = loopEnd;
      params.atkTime = attackTime;
      params.relTime = releaseTime;
    }

    synthNew(defName, nodeId, 0, groupId, params);
    activeVoices.set(note, { nodeId });
  }

  function stopVoice(note) {
    const voice = activeVoices.get(note);
    if (!voice) return;

    // Set gate=0 → triggers release envelope → SC frees via doneAction: 2
    nodeSet(voice.nodeId, { gate: 0 });
    activeVoices.delete(note);
  }

  const api = {
    updateEnvelopes(chordSec, atkLevel = 1.0, relLevel = 1.0) {
      const floor = ENVELOPE_FLOOR;
      attackTime = Math.max(floor, chordSec * 0.8 * atkLevel);
      releaseTime = Math.max(floor, chordSec * 1.2 * relLevel);
    },

    playChord(notes) {
      for (const note of [...activeVoices.keys()]) {
        stopVoice(note);
      }
      for (const note of notes) {
        startVoice(note);
      }
    },

    addNotes(notes) {
      for (const note of notes) {
        startVoice(note);
      }
    },

    triggerAttackRelease(note, duration) {
      for (const n of [...activeVoices.keys()]) {
        stopVoice(n);
      }
      startVoice(note);
      // Auto-release after duration
      setTimeout(() => {
        stopVoice(note);
      }, duration * 1000);
    },

    releaseAll() {
      for (const note of [...activeVoices.keys()]) {
        stopVoice(note);
      }
    },

    dispose() {
      for (const [note, voice] of activeVoices) {
        nodeFree(voice.nodeId);
      }
      activeVoices.clear();
      // Don't free buffers here — bufferManager handles that on instrument swap
    },
  };

  return api;
}
