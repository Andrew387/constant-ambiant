import * as Tone from 'tone';
import { buildEffectsChain } from './effects/index.js';
import { createAllTrackEffects } from './effects/trackEffects.js';
import { initSectionAutomation, disposeSectionAutomation } from './effects/sectionAutomation.js';
import { TRACK_PROFILES } from './trackProfiles.js';
import { createPadSynth } from './synths/pad.js';
import { createSampleSynth } from './synths/samplePlayer.js';
import { createTexturePlayer } from './synths/texturePlayer.js';
import {
  LEAD_INSTRUMENTS, BASS_INSTRUMENTS, DEFAULT_LEAD, DEFAULT_BASS,
} from './synths/sampleRegistry.js';

let trackGains = {};
let trackEffects = null;
let masterGain = null;
let synths = null;
let texturePlayer = null;
let effectsChain = null;
let effectsEnabled = false;

let currentLeadId = DEFAULT_LEAD;
let currentBassId = DEFAULT_BASS;

/**
 * Initializes the mixer: creates gain nodes for each synth track,
 * a master gain, routes everything through the effects chain.
 *
 * Must be called after a user gesture (Tone.start()).
 *
 * @returns {{ synths, setTrackVolume, setMasterVolume, dispose }}
 */
export async function initMixer() {
  // Master gain → straight to destination (effects off by default)
  masterGain = new Tone.Gain(0.8);
  masterGain.toDestination();

  // Per-track gains and effect groups — driven by TRACK_PROFILES
  trackGains = {};
  for (const [name, profile] of Object.entries(TRACK_PROFILES)) {
    trackGains[name] = new Tone.Gain(profile.gain);
  }

  trackEffects = createAllTrackEffects();

  // Route: trackGain → trackEffects → masterGain
  for (const name of Object.keys(TRACK_PROFILES)) {
    trackGains[name].connect(trackEffects[name].input);
    trackEffects[name].output.connect(masterGain);
  }

  // Section automation self-discovers which tracks have automation config
  initSectionAutomation(trackEffects);

  // Initialize synths — lead and bass are sample-based
  const leadConfig = LEAD_INSTRUMENTS.find(i => i.id === currentLeadId);
  const bassConfig = BASS_INSTRUMENTS.find(i => i.id === currentBassId);

  const pad = createPadSynth(trackGains.pad);

  const [lead, drone] = await Promise.all([
    createSampleSynth(leadConfig, trackGains.lead),
    createSampleSynth(bassConfig, trackGains.drone),
  ]);

  synths = { pad, drone, lead };

  // Create the texture sample player (loops a random file per song cycle)
  texturePlayer = createTexturePlayer(trackGains.sampleTexture);

  return {
    synths,
    texturePlayer,
    trackGains,
    trackEffects,
    setTrackVolume,
    setMasterVolume,
    setEffectsEnabled,
    swapLead,
    swapBass,
    getArchiveGain: () => trackGains.archive,
    getFreesoundGain: () => trackGains.freesound,
    dispose: disposeMixer,
  };
}

/**
 * Swaps the lead instrument to a different sample set.
 * Loads the new instrument first, then swaps and disposes the old one.
 * @param {string} instrumentId - ID from LEAD_INSTRUMENTS
 */
async function swapLead(instrumentId) {
  const config = LEAD_INSTRUMENTS.find(i => i.id === instrumentId);
  if (!config || instrumentId === currentLeadId) return;

  const newSynth = await createSampleSynth(config, trackGains.lead);
  const oldSynth = synths.lead;
  synths.lead = newSynth;
  currentLeadId = instrumentId;

  if (oldSynth) {
    oldSynth.releaseAll(Tone.now());
    setTimeout(() => oldSynth.dispose(), 5000);
  }
  console.log(`[mixer] lead swapped to ${config.name}`);
}

/**
 * Swaps the bass instrument (drone role) to a different sample set.
 * Loads the new instrument first, then swaps and disposes the old one.
 * @param {string} instrumentId - ID from BASS_INSTRUMENTS
 */
async function swapBass(instrumentId) {
  const config = BASS_INSTRUMENTS.find(i => i.id === instrumentId);
  if (!config || instrumentId === currentBassId) return;

  const newSynth = await createSampleSynth(config, trackGains.drone);
  const oldSynth = synths.drone;
  synths.drone = newSynth;
  currentBassId = instrumentId;

  if (oldSynth) {
    oldSynth.releaseAll(Tone.now());
    setTimeout(() => oldSynth.dispose(), 5000);
  }
  console.log(`[mixer] bass swapped to ${config.name}`);
}

/**
 * Sets the volume for a specific track.
 * @param {string} track - Track name: "pad", "drone", "lead", "archive", etc.
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
  disposeSectionAutomation();
  if (texturePlayer) {
    texturePlayer.dispose();
    texturePlayer = null;
  }
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
