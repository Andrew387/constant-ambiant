/**
 * Sine synth — OSC wrapper for SuperCollider \padVoice SynthDef.
 *
 * Dual detuned sine voices with overlapping attack/release envelopes
 * for seamless crossfades between chords. Selectable as a lead
 * instrument alongside sample-based leads.
 *
 * Maintains a map of held notes → SC node IDs. When a chord changes:
 *   - Old notes: send gate=0 (triggers release envelope, SC frees after)
 *   - New notes: /s_new with gate=1 (starts attack envelope)
 */

import { synthNew, nodeSet, nodeFree } from '../../sc/osc.js';
import { allocNodeId, GROUPS } from '../../sc/nodeIds.js';
import { ENVELOPE_FLOOR } from '../../engine/rules.config.js';

const MAX_VOICES = 16;

/**
 * Creates a sine synth controller.
 *
 * @param {object} [options]
 * @param {number} [options.outBus] - Output bus
 * @param {number} [options.groupId] - SC group for synth nodes
 * @returns {object} Sine synth API (same interface as samplePlayer)
 */
export function createSineSynth(options = {}) {
  const outBus = options.outBus;
  const groupId = options.groupId ?? GROUPS.LEAD;

  // Map of note name → { nodeId }
  const heldNotes = new Map();

  // Current envelope parameters (scaled by ruleEngine)
  let atk1 = 8, dec1 = 4, sus1 = 0.7, rel1 = 12;
  let atk2 = 10, dec2 = 5, sus2 = 0.5, rel2 = 14;

  function noteToFreq(note) {
    const match = note.match(/^([A-G]#?)(\d+)$/);
    if (!match) return 440;
    const noteNames = { 'C': 0, 'C#': 1, 'D': 2, 'D#': 3, 'E': 4, 'F': 5, 'F#': 6, 'G': 7, 'G#': 8, 'A': 9, 'A#': 10, 'B': 11 };
    const semitone = noteNames[match[1]];
    const octave = parseInt(match[2]);
    const midi = (octave + 1) * 12 + semitone;
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  function startVoice(note) {
    const freq = noteToFreq(note);
    const nodeId = allocNodeId();

    synthNew('padVoice', nodeId, 0, groupId, {
      out: outBus,
      freq,
      gate: 1,
      atk1, dec1, sus1, rel1,
      atk2, dec2, sus2, rel2,
      amp1: 0.3,
      amp2: 0.2,
      detune1: -8,
      detune2: 7,
      hpFreq: 180,
    });

    heldNotes.set(note, { nodeId });
  }

  function releaseVoice(note) {
    const voice = heldNotes.get(note);
    if (!voice) return;

    // Set gate=0 to trigger the release envelope
    // SC will free the synth via doneAction: 2
    nodeSet(voice.nodeId, { gate: 0 });
    heldNotes.delete(note);
  }

  return {
    /**
     * Scales attack/release envelopes as fractions of chord duration.
     */
    updateEnvelopes(chordSec, atkLevel = 1.0, relLevel = 1.0) {
      const floor = ENVELOPE_FLOOR;
      atk1 = Math.max(floor, chordSec * 0.8 * atkLevel);
      dec1 = Math.max(floor, chordSec * 0.4 * atkLevel);
      rel1 = Math.max(floor, chordSec * 1.2 * relLevel);
      atk2 = Math.max(floor, chordSec * 1.0 * atkLevel);
      dec2 = Math.max(floor, chordSec * 0.5 * atkLevel);
      rel2 = Math.max(floor, chordSec * 1.4 * relLevel);
    },

    /**
     * Releases previous notes and attacks new ones.
     * Old release tails blend with new attack ramps = seamless crossfade.
     */
    playChord(notes) {
      for (const note of [...heldNotes.keys()]) {
        releaseVoice(note);
      }
      for (const note of notes) {
        startVoice(note);
      }
    },

    /**
     * Adds notes without releasing existing ones (bloom).
     */
    addNotes(notes) {
      const overflow = (heldNotes.size + notes.length) - MAX_VOICES;
      if (overflow > 0) {
        const keys = [...heldNotes.keys()];
        for (let i = 0; i < overflow; i++) {
          releaseVoice(keys[i]);
        }
      }
      for (const note of notes) {
        startVoice(note);
      }
    },

    releaseAll() {
      for (const note of [...heldNotes.keys()]) {
        releaseVoice(note);
      }
    },

    dispose() {
      for (const [note, voice] of heldNotes) {
        nodeFree(voice.nodeId);
      }
      heldNotes.clear();
    },
  };
}
