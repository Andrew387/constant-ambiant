import * as Tone from 'tone';

/**
 * Creates a pad synth: very slow attack, long release, detuned oscillators.
 * Uses triggerAttack/triggerRelease (NOT triggerAttackRelease) so each chord
 * sustains indefinitely until the next chord event releases it.
 * Attack and release scale proportionally to chord duration (in seconds),
 * so crossfades stay musical at any BPM and measure count.
 *
 * @param {Tone.ToneAudioNode} destination - Effects chain node to connect to
 * @returns {object}
 */
export function createPadSynth(destination) {
  const synth = new Tone.PolySynth(Tone.Synth, {
    maxPolyphony: 16,
    oscillator: {
      type: 'sine',
      detune: -8,
    },
    envelope: {
      attack: 8,
      decay: 4,
      sustain: 0.7,
      release: 12,
      attackCurve: 'linear',
      releaseCurve: 'exponential',
    },
    volume: -26,
  });

  const synth2 = new Tone.PolySynth(Tone.Synth, {
    maxPolyphony: 16,
    oscillator: {
      type: 'sine',
      detune: 7,
    },
    envelope: {
      attack: 10,
      decay: 5,
      sustain: 0.5,
      release: 14,
      attackCurve: 'linear',
      releaseCurve: 'exponential',
    },
    volume: -30,
  });

  // High-pass filter to cut low frequencies and leave room for the drone
  const hpFilter = new Tone.Filter({
    type: 'highpass',
    frequency: 180,
    rolloff: -12,
  });
  hpFilter.connect(destination);

  synth.connect(hpFilter);
  synth2.connect(hpFilter);

  let heldNotes = [];

  return {
    /**
     * Scales attack/release envelopes as fractions of chord duration,
     * further scaled by the user-controlled attack/release levels.
     *
     * @param {number} chordSec - Chord duration in seconds (derived from BPM)
     * @param {number} atkLevel - Attack multiplier (0 = instant, 1.0 = default)
     * @param {number} relLevel - Release multiplier (0 = instant, 1.0 = default)
     */
    updateEnvelopes(chordSec, atkLevel = 1.0, relLevel = 1.0) {
      // Minimum 0.01s to avoid Tone.js zero-length envelope errors
      const floor = 0.01;

      // Synth 1: base ratios attack=0.8, decay=0.4, release=1.2
      const s1Attack = Math.max(floor, chordSec * 0.8 * atkLevel);
      const s1Decay = Math.max(floor, chordSec * 0.4 * atkLevel);
      const s1Release = Math.max(floor, chordSec * 1.2 * relLevel);
      synth.set({ envelope: { attack: s1Attack, decay: s1Decay, release: s1Release } });

      // Synth 2: base ratios attack=1.0, decay=0.5, release=1.4
      const s2Attack = Math.max(floor, chordSec * 1.0 * atkLevel);
      const s2Decay = Math.max(floor, chordSec * 0.5 * atkLevel);
      const s2Release = Math.max(floor, chordSec * 1.4 * relLevel);
      synth2.set({ envelope: { attack: s2Attack, decay: s2Decay, release: s2Release } });
    },

    /**
     * Releases previous notes and attacks new ones at the same time.
     * Old release tails blend with new attack ramps = seamless crossfade.
     */
    playChord(notes, time) {
      if (heldNotes.length > 0) {
        synth.triggerRelease(heldNotes, time);
        synth2.triggerRelease(heldNotes, time);
      }
      synth.triggerAttack(notes, time);
      synth2.triggerAttack(notes, time);
      heldNotes = [...notes];
    },

    /**
     * Adds notes to the currently held chord without releasing existing notes.
     * Used by sequential chord playing rules to bloom higher notes over time.
     */
    addNotes(notes, time) {
      // Cap total held notes at maxPolyphony to prevent unbounded growth.
      // Release oldest notes first to make room for new ones.
      const MAX_HELD = 16;
      const overflow = (heldNotes.length + notes.length) - MAX_HELD;
      if (overflow > 0) {
        const toRelease = heldNotes.slice(0, overflow);
        synth.triggerRelease(toRelease, time);
        synth2.triggerRelease(toRelease, time);
        heldNotes = heldNotes.slice(overflow);
      }
      synth.triggerAttack(notes, time);
      synth2.triggerAttack(notes, time);
      heldNotes = [...heldNotes, ...notes];
    },

    releaseAll(time) {
      if (heldNotes.length > 0) {
        synth.triggerRelease(heldNotes, time);
        synth2.triggerRelease(heldNotes, time);
        heldNotes = [];
      }
    },

    dispose() {
      synth.dispose();
      synth2.dispose();
      hpFilter.dispose();
    },
  };
}
