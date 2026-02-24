import * as Tone from 'tone';
import { buildEffectsChain } from './effects/index.js';
import { createAllTrackEffects } from './effects/trackEffects.js';
import { createPadSynth } from './synths/pad.js';
import { createDroneSynth } from './synths/drone.js';
import { createTextureSynth } from './synths/texture.js';
import { createBellSynth } from './synths/bell.js';

let trackGains = {};
let trackEffects = null;
let masterGain = null;
let synths = null;
let effectsChain = null;
let effectsEnabled = false;

/**
 * Initializes the mixer: creates gain nodes for each synth track,
 * a master gain, routes everything through the effects chain.
 *
 * Must be called after a user gesture (Tone.start()).
 *
 * @returns {{ synths, setTrackVolume, setMasterVolume, dispose }}
 */
export function initMixer() {
  // Master gain → straight to destination (effects off by default)
  masterGain = new Tone.Gain(0.8);
  masterGain.toDestination();

  // Individual track gains
  trackGains = {
    pad: new Tone.Gain(0.45),
    drone: new Tone.Gain(0.5),
    texture: new Tone.Gain(0.4),
    bell: new Tone.Gain(0.35),
    archive: new Tone.Gain(0.7),
    freesound: new Tone.Gain(0.4),
  };

  // Per-track effect groups: trackGain → effects → masterGain
  trackEffects = createAllTrackEffects();

  // Route: trackGain → trackEffects → masterGain
  // Bell has no dedicated effect group — routes directly to master
  trackGains.pad.connect(trackEffects.pad.input);
  trackEffects.pad.output.connect(masterGain);

  trackGains.drone.connect(trackEffects.drone.input);
  trackEffects.drone.output.connect(masterGain);

  trackGains.texture.connect(trackEffects.texture.input);
  trackEffects.texture.output.connect(masterGain);

  trackGains.bell.connect(masterGain);

  trackGains.archive.connect(trackEffects.archive.input);
  trackEffects.archive.output.connect(masterGain);

  trackGains.freesound.connect(trackEffects.freesound.input);
  trackEffects.freesound.output.connect(masterGain);

  // Initialize each synth routed to its own track gain
  const pad = createPadSynth(trackGains.pad);
  const drone = createDroneSynth(trackGains.drone);
  const texture = createTextureSynth(trackGains.texture);
  const bell = createBellSynth(trackGains.bell);

  synths = { pad, drone, texture, bell };

  return {
    synths,
    trackGains,
    setTrackVolume,
    setMasterVolume,
    setEffectsEnabled,
    getArchiveGain: () => trackGains.archive,
    getFreesoundGain: () => trackGains.freesound,
    dispose: disposeMixer,
  };
}

/**
 * Sets the volume for a specific track.
 * @param {string} track - Track name: "pad", "drone", "texture", "archive"
 * @param {number} value - Gain value 0–1
 */
export function setTrackVolume(track, value) {
  if (trackGains[track]) {
    trackGains[track].gain.rampTo(value, 0.5);
  }
}

/**
 * Sets the master volume.
 * @param {number} value - Gain value 0–1
 */
export function setMasterVolume(value) {
  if (masterGain) {
    masterGain.gain.rampTo(value, 0.3);
  }
}

/**
 * Enables or disables the master effects chain (filter → delay → reverb).
 * Reroutes masterGain on the fly without clicks.
 * @param {boolean} enabled
 */
async function setEffectsEnabled(enabled) {
  if (enabled === effectsEnabled) return;

  if (enabled) {
    // Build effects chain if first time
    if (!effectsChain) {
      effectsChain = await buildEffectsChain();
    }
    // Reroute: masterGain → effects → destination
    masterGain.disconnect();
    masterGain.connect(effectsChain.input);
  } else {
    // Reroute: masterGain → destination directly
    masterGain.disconnect();
    masterGain.toDestination();
  }

  effectsEnabled = enabled;
}

function disposeMixer() {
  if (synths) {
    Object.values(synths).forEach(s => s.dispose());
    synths = null;
  }
  if (trackEffects) {
    Object.values(trackEffects).forEach(fx => fx.dispose());
    trackEffects = null;
  }
  if (trackGains) {
    Object.values(trackGains).forEach(g => g.dispose());
    trackGains = {};
  }
  if (masterGain) {
    masterGain.dispose();
    masterGain = null;
  }
  if (effectsChain) {
    effectsChain.dispose();
    effectsChain = null;
  }
  effectsEnabled = false;
}
