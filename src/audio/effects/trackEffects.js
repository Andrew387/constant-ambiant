import * as Tone from 'tone';

/**
 * Creates per-track effect groups.
 * Each group has an input and output node with effects chained between them.
 * Empty groups use a single pass-through gain (zero DSP overhead).
 *
 * Signal flow per track: trackGain → effectGroup.input → [effects] → effectGroup.output → masterGain
 */

/**
 * Creates the pad effect group: oscillating lowpass filter.
 * LFO sweeps the cutoff between 400–4000 Hz over ~30 seconds
 * for a slow breathing movement that darkens and opens the pad.
 *
 * @returns {{ input: Tone.ToneAudioNode, output: Tone.ToneAudioNode, dispose: Function }}
 */
export function createPadEffects() {
  const passthrough = new Tone.Gain(1);
  return {
    input: passthrough,
    output: passthrough,
    dispose() {
      passthrough.dispose();
    },
  };
}

/**
 * Creates the drone effect group: pass-through (ready for future effects).
 *
 * @returns {{ input: Tone.ToneAudioNode, output: Tone.ToneAudioNode, dispose: Function }}
 */
export function createDroneEffects() {
  const passthrough = new Tone.Gain(1);
  return {
    input: passthrough,
    output: passthrough,
    dispose() {
      passthrough.dispose();
    },
  };
}

/**
 * Creates the freesound effect group: pass-through.
 * Per-sound reverb is applied in the player itself.
 *
 * @returns {{ input: Tone.ToneAudioNode, output: Tone.ToneAudioNode, dispose: Function }}
 */
export function createFreesoundEffects() {
  const passthrough = new Tone.Gain(1);
  return {
    input: passthrough,
    output: passthrough,
    dispose() {
      passthrough.dispose();
    },
  };
}

/**
 * Creates the archive effect group: pass-through (ready for future effects).
 *
 * @returns {{ input: Tone.ToneAudioNode, output: Tone.ToneAudioNode, dispose: Function }}
 */
export function createArchiveEffects() {
  const passthrough = new Tone.Gain(1);
  return {
    input: passthrough,
    output: passthrough,
    dispose() {
      passthrough.dispose();
    },
  };
}

/**
 * Creates the choir (lead) effect group: large reverb to blur/smear the sound.
 *
 * @returns {{ input: Tone.ToneAudioNode, output: Tone.ToneAudioNode, dispose: Function }}
 */
export function createChoirEffects() {
  const reverb = new Tone.Reverb({
    decay: 6,
    wet: 0.45,
    preDelay: 0.1,
  });

  return {
    input: reverb,
    output: reverb,
    dispose() {
      reverb.dispose();
    },
  };
}

/**
 * Creates the sample-texture effect group: highpass filter (bass cut) + compressor
 * (volume uniformity). The highpass removes low-end mud so textures sit above the
 * drone/bass without competing. The compressor tames dynamic spikes so no single
 * texture sample jumps out of the mix.
 *
 * @returns {{ input: Tone.ToneAudioNode, output: Tone.ToneAudioNode, dispose: Function }}
 */
export function createSampleTextureEffects() {
  // Highpass at 300 Hz — removes low-end rumble from texture samples
  const highpass = new Tone.Filter({
    frequency: 300,
    type: 'highpass',
    rolloff: -24,        // steep roll-off for a clean bass cut
  });

  // Compressor for volume uniformity across the 129 different texture files
  const compressor = new Tone.Compressor({
    threshold: -24,      // catch anything above -24 dB
    ratio: 4,            // moderate squeeze
    attack: 0.01,        // fast attack to catch transients
    release: 0.3,        // smooth release to avoid pumping
  });

  highpass.connect(compressor);

  return {
    input: highpass,
    output: compressor,
    dispose() {
      highpass.dispose();
      compressor.dispose();
    },
  };
}

/**
 * Creates all per-track effect groups.
 *
 * @returns {{ pad, drone, texture, archive, freesound, choir, sampleTexture }}
 */
export function createAllTrackEffects() {
  return {
    pad: createPadEffects(),
    drone: createDroneEffects(),
    archive: createArchiveEffects(),
    freesound: createFreesoundEffects(),
    choir: createChoirEffects(),
    sampleTexture: createSampleTextureEffects(),
  };
}
