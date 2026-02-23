import * as Tone from 'tone';

/**
 * Creates a bell synth: bright, metallic, short-attack tones that play
 * the highest notes of the current chord in randomized arpeggio patterns.
 *
 * Uses a PolySynth with FM synthesis for bell-like timbres:
 * short attack, medium decay, no sustain, moderate release.
 *
 * @param {Tone.ToneAudioNode} destination - Effects chain node to connect to
 * @returns {object}
 */
export function createBellSynth(destination) {
  const synth = new Tone.PolySynth(Tone.FMSynth, {
    maxPolyphony: 8,
    harmonicity: 3.01,
    modulationIndex: 14,
    oscillator: { type: 'sine' },
    envelope: {
      attack: 0.005,
      decay: 3.0,
      sustain: 0.05,
      release: 8.0,
    },
    modulation: { type: 'square' },
    modulationEnvelope: {
      attack: 0.002,
      decay: 1.2,
      sustain: 0.0,
      release: 4.0,
    },
    volume: -22,
  });

  synth.connect(destination);

  return {
    /**
     * Plays a single bell note at the given time.
     * @param {string} note - Tone.js note string
     * @param {number} duration - Duration in seconds
     * @param {number} time - Audio-context time
     */
    triggerNote(note, duration, time) {
      synth.triggerAttackRelease(note, duration, time);
    },

    dispose() {
      synth.dispose();
    },
  };
}
