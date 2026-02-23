import * as Tone from 'tone';

/**
 * Creates a drone synth: sub-bass / root tone drone.
 * Uses MonoSynth with sawtooth wave, heavy low-pass filtering,
 * and octave transposition down. Attack and release scale
 * proportionally to chord duration so they stay locked to BPM.
 *
 * @param {Tone.ToneAudioNode} destination - Effects chain node to connect to
 * @returns {object}
 */
export function createDroneSynth(destination) {
  const synth = new Tone.MonoSynth({
    oscillator: {
      type: 'sawtooth',
    },
    filter: {
      type: 'lowpass',
      frequency: 150,
      Q: 1,
    },
    filterEnvelope: {
      attack: 10,
      decay: 6,
      sustain: 0.3,
      release: 14,
      baseFrequency: 60,
      octaves: 1.2,
    },
    envelope: {
      attack: 10,
      decay: 4,
      sustain: 0.85,
      release: 16,
      attackCurve: 'linear',
      releaseCurve: 'exponential',
    },
    volume: -20,
  });

  // Slight detune for warmth/thickness
  synth.detune.value = -8;

  synth.connect(destination);

  return {
    triggerAttackRelease(note, duration, time) {
      synth.triggerAttackRelease(note, duration, time);
    },

    /**
     * Scales amplitude and filter envelopes as fractions of chord duration,
     * further scaled by user-controlled attack/release levels.
     *
     * @param {number} chordSec - Chord duration in seconds (derived from BPM)
     * @param {number} atkLevel - Attack multiplier (0 = instant, 1.0 = default)
     * @param {number} relLevel - Release multiplier (0 = instant, 1.0 = default)
     */
    updateEnvelopes(chordSec, atkLevel = 1.0, relLevel = 1.0) {
      const floor = 0.01;
      const attack = Math.max(floor, chordSec * 1.0 * atkLevel);
      const decay = Math.max(floor, chordSec * 0.4 * atkLevel);
      const release = Math.max(floor, chordSec * 1.6 * relLevel);
      const fAttack = Math.max(floor, chordSec * 1.0 * atkLevel);
      const fDecay = Math.max(floor, chordSec * 0.6 * atkLevel);
      const fRelease = Math.max(floor, chordSec * 1.4 * relLevel);
      synth.set({
        envelope: { attack, decay, release },
        filterEnvelope: { attack: fAttack, decay: fDecay, release: fRelease },
      });
    },

    dispose() {
      synth.dispose();
    },
  };
}
