import * as Tone from 'tone';

/**
 * Creates a texture synth: high-frequency shimmer / airy noise.
 * Uses NoiseSynth shaped with filtering and envelope to create
 * a very subtle atmospheric texture. Ultra-gentle attack.
 *
 * @param {Tone.ToneAudioNode} destination - Effects chain node to connect to
 * @returns {object} Wrapper with triggerAttackRelease and dispose methods
 */
export function createTextureSynth(destination) {
  const filter = new Tone.Filter({
    type: 'bandpass',
    frequency: 3000,
    Q: 0.6,
  });

  const synth = new Tone.NoiseSynth({
    noise: {
      type: 'pink',
    },
    envelope: {
      attack: 6,         // slightly faster fade-in so it's audible sooner
      decay: 5,
      sustain: 0.55,     // sustain at 55% — much more present
      release: 14,       // longer tail
      attackCurve: 'linear',
      releaseCurve: 'exponential',
    },
    volume: -18,          // boosted from -28 dB
  });

  // LFO to slowly modulate the filter frequency for movement
  const lfo = new Tone.LFO({
    frequency: 0.03,
    min: 2000,
    max: 6000,
    type: 'sine',
  });
  lfo.connect(filter.frequency);
  lfo.start();

  synth.connect(filter);
  filter.connect(destination);

  return {
    triggerAttackRelease(duration, time) {
      synth.triggerAttackRelease(duration, time);
    },
    dispose() {
      lfo.stop();
      lfo.dispose();
      synth.dispose();
      filter.dispose();
    },
  };
}
