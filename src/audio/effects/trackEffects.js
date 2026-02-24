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
 * Creates the texture effect group: tremolo (amplitude modulation).
 * Slow, deep tremolo adds pulsing movement to the noise texture.
 *
 * @returns {{ input: Tone.ToneAudioNode, output: Tone.ToneAudioNode, dispose: Function }}
 */
export function createTextureEffects() {
  const tremolo = new Tone.Tremolo({
    frequency: 3,       // fast chop
    depth: 0.9,         // deep — pronounced stuttering effect
    spread: 0,          // mono spread (noise is mono anyway)
    type: 'square',     // square wave for hard on/off chop
  }).start();

  return {
    input: tremolo,
    output: tremolo,
    dispose() {
      tremolo.stop();
      tremolo.dispose();
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
 * Creates all per-track effect groups.
 *
 * @returns {{ pad, drone, texture, archive }}
 */
export function createAllTrackEffects() {
  return {
    pad: createPadEffects(),
    drone: createDroneEffects(),
    texture: createTextureEffects(),
    archive: createArchiveEffects(),
    freesound: createFreesoundEffects(),
  };
}
