import * as Tone from 'tone';
import { initMixer, setMasterVolume, setTrackVolume } from './audio/mixer.js';
import { start, stop, updateRules, getConfig } from './engine/ruleEngine.js';
import { startArchiveLayer, stopArchiveLayer } from './archive/player.js';
import { createControls } from './ui/controls.js';
import { createDebugPanel, connectDebugAudio } from './ui/debug.js';

let mixer = null;
let audioConnected = false;

// Global debug state — slider values that persist across play/stop/mood changes
const debugState = {
  chordDuration: null,
  attackLevel: null,
  releaseLevel: null,
  padVolume: null,
  droneVolume: null,
  textureVolume: null,
  bellVolume: null,
  archiveVolume: null,
  effectsEnabled: false,
};

async function handleStart() {
  await Tone.start();

  if (!mixer) {
    mixer = await initMixer();
  }

  if (!audioConnected) {
    connectDebugAudio(mixer.trackGains);
    audioConnected = true;
  }

  start(mixer.synths);
  applyDebugOverrides();

  const config = getConfig();
  if (config.archiveEnabled) {
    startArchiveLayer(mixer.getArchiveGain());
  }
}

function handleStop() {
  stop();
  stopArchiveLayer();
}

function handleVolumeChange(value) {
  setMasterVolume(value);
}

/**
 * Re-applies any debug slider overrides that the user has set.
 * Called after engine start and mood changes to prevent config from
 * overwriting user-tweaked values.
 */
function applyDebugOverrides() {
  const ruleOverrides = {};
  if (debugState.chordDuration !== null) ruleOverrides.chordDuration = debugState.chordDuration;
  if (debugState.attackLevel !== null) ruleOverrides.attackLevel = debugState.attackLevel;
  if (debugState.releaseLevel !== null) ruleOverrides.releaseLevel = debugState.releaseLevel;

  if (Object.keys(ruleOverrides).length > 0) {
    updateRules(ruleOverrides);
  }

  // Re-apply effects toggle
  if (mixer && debugState.effectsEnabled) {
    mixer.setEffectsEnabled(true);
  }

  // Re-apply track volumes
  if (debugState.padVolume !== null) setTrackVolume('pad', debugState.padVolume);
  if (debugState.droneVolume !== null) setTrackVolume('drone', debugState.droneVolume);
  if (debugState.textureVolume !== null) setTrackVolume('texture', debugState.textureVolume);
  if (debugState.bellVolume !== null) setTrackVolume('bell', debugState.bellVolume);
  if (debugState.archiveVolume !== null) setTrackVolume('archive', debugState.archiveVolume);
}

function handleParamChange(param, value) {
  // Persist in global debug state so values survive play/stop/mood changes
  if (param in debugState) {
    debugState[param] = value;
  }
  switch (param) {
    case 'chordDuration':
      updateRules({ chordDuration: value });
      break;
    case 'attackLevel':
      updateRules({ attackLevel: value });
      break;
    case 'releaseLevel':
      updateRules({ releaseLevel: value });
      break;
case 'padVolume':
      setTrackVolume('pad', value);
      break;
    case 'droneVolume':
      setTrackVolume('drone', value);
      break;
    case 'textureVolume':
      setTrackVolume('texture', value);
      break;
    case 'bellVolume':
      setTrackVolume('bell', value);
      break;
    case 'archiveVolume':
      setTrackVolume('archive', value);
      break;
    case 'effectsEnabled':
      if (mixer) mixer.setEffectsEnabled(value);
      break;
    default:
      console.warn(`[main] unknown param: ${param}`);
  }
}

createControls({
  onStart: handleStart,
  onStop: handleStop,
  onVolumeChange: handleVolumeChange,
});

createDebugPanel({
  onParamChange: handleParamChange,
  getConfig,
});

