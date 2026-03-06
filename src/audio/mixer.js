/**
 * Mixer — OSC-based mixer for SuperCollider.
 *
 * Initializes:
 *   - Per-track gain nodes (SC \fxGain synths on track buses)
 *   - Effect chains for each track (via trackEffects.js)
 *   - Shared reverbs and master output (via startup.scd groups)
 *   - Synth instances (pad, lead, drone, texture) via their SC wrappers
 *   - Section automation
 *
 * The SC group/bus structure is set up by startup.scd before this runs.
 * This module just creates the synth nodes within those groups.
 */

import { synthNew, nodeSet, nodeFree, sync, controlBusGetN } from '../sc/osc.js';
import { allocNodeId, GROUPS, BUSES, METER_CTL_BUSES, METER_CTL_START, METER_CTL_COUNT } from '../sc/nodeIds.js';
import { createAllTrackEffects } from './effects/trackEffects.js';
import { initSectionAutomation, disposeSectionAutomation } from './effects/sectionAutomation.js';
import { TRACK_PROFILES } from './trackProfiles.js';
import { triggerPadChord, triggerLeadChord, triggerDrone } from '../rhythm/scheduler.js';
import { createPadSynth } from './synths/pad.js';
import { createSampleSynth } from './synths/samplePlayer.js';
import { createTexturePlayer } from './synths/texturePlayer.js';
import {
  LEAD_INSTRUMENTS, BASS_INSTRUMENTS, PAD_INSTRUMENTS,
  DEFAULT_LEAD, DEFAULT_BASS, DEFAULT_PAD_SAMPLE,
} from './synths/sampleRegistry.js';
import { freeInstrumentSamples } from '../sc/bufferManager.js';

let trackGainNodeIds = {};
let trackEffects = null;
let masterGainNodeId = null;
let synths = null;
let texturePlayer = null;
let pendingDisposeTimers = [];

let meterNodeIds = [];

// Map from track name → SC bus for gain synths
const TRACK_BUS = {
  pad:           BUSES.PAD,
  drone:         BUSES.DRONE,
  lead:          BUSES.LEAD,
  sampleTexture: BUSES.TEXTURE,
  archive:       BUSES.ARCHIVE,
  freesound:     BUSES.FREESOUND,
  pedalPad:      BUSES.PEDAL_PAD,
};

/**
 * Initializes the mixer: creates SC synth nodes for gains, effects,
 * reverbs, and instruments.
 *
 * @returns {Promise<object>} Mixer API
 */
export async function initMixer() {
  // ── Per-track gain synths ──
  trackGainNodeIds = {};
  for (const [name, profile] of Object.entries(TRACK_PROFILES)) {
    const bus = TRACK_BUS[name];
    if (bus === undefined) continue;

    const nodeId = allocNodeId();
    synthNew('fxGain', nodeId, 1, GROUPS.EFFECTS, {
      bus,
      gain: profile.gain,
    });
    trackGainNodeIds[name] = nodeId;
  }

  // ── Track effect chains (lowpass, delay, compressor, duck gain, reverb sends) ──
  trackEffects = createAllTrackEffects();

  // ── Section automation (discovers dynamicFilter/duckGain refs from trackEffects) ──
  initSectionAutomation(trackEffects);

  // ── Shared reverbs (placed in reverb group) ──
  const shortReverbId = allocNodeId();
  synthNew('reverbShort', shortReverbId, 0, GROUPS.REVERBS, {
    inBus: BUSES.REVERB_SHORT,
    outBus: BUSES.MASTER,
    decay: 6,
    damp: 0.4,
  });

  const longReverbId = allocNodeId();
  synthNew('reverbLong', longReverbId, 0, GROUPS.REVERBS, {
    inBus: BUSES.REVERB_LONG,
    outBus: BUSES.MASTER,
    decay: 14,
    damp: 0.3,
  });

  // ── Master output (placed in master group) ──
  masterGainNodeId = allocNodeId();
  synthNew('masterOut', masterGainNodeId, 0, GROUPS.MASTER, {
    inBus: BUSES.MASTER,
    outBus: 0,
    gain: 0.8,
  });

  // ── Per-track bus meters (at tail of effects group for track buses) ──
  meterNodeIds = [];
  const trackMeters = [
    { audioBus: BUSES.PAD,       ctlBus: METER_CTL_BUSES.PAD },
    { audioBus: BUSES.DRONE,     ctlBus: METER_CTL_BUSES.DRONE },
    { audioBus: BUSES.LEAD,      ctlBus: METER_CTL_BUSES.LEAD },
    { audioBus: BUSES.TEXTURE,   ctlBus: METER_CTL_BUSES.TEXTURE },
    { audioBus: BUSES.ARCHIVE,   ctlBus: METER_CTL_BUSES.ARCHIVE },
    { audioBus: BUSES.FREESOUND, ctlBus: METER_CTL_BUSES.FREESOUND },
  ];
  for (const { audioBus, ctlBus } of trackMeters) {
    const nodeId = allocNodeId();
    synthNew('busMeter', nodeId, 1, GROUPS.EFFECTS, { audioBus, ctlBus });
    meterNodeIds.push(nodeId);
  }
  // Master meter at tail of master group (after reverbs are mixed in)
  const masterMeterId = allocNodeId();
  synthNew('busMeter', masterMeterId, 1, GROUPS.MASTER, {
    audioBus: BUSES.MASTER, ctlBus: METER_CTL_BUSES.MASTER,
  });
  meterNodeIds.push(masterMeterId);

  // ── Sync: ensure all effect/reverb/master synths exist on the server ──
  await sync();

  // ── Initialize synths ──
  const leadConfig = LEAD_INSTRUMENTS.find(i => i.id === leadSlot.getCurrentId());
  const bassConfig = BASS_INSTRUMENTS.find(i => i.id === bassSlot.getCurrentId());
  const padSampleConfig = PAD_INSTRUMENTS.find(i => i.id === pedalPadSlot.getCurrentId());

  const pad = createPadSynth({ outBus: BUSES.PAD });

  const [lead, drone, pedalPad] = await Promise.all([
    createSampleSynth(leadConfig, { outBus: BUSES.LEAD, groupId: GROUPS.LEAD }),
    createSampleSynth(bassConfig, { outBus: BUSES.DRONE, groupId: GROUPS.DRONE }),
    createSampleSynth(padSampleConfig, { outBus: BUSES.PEDAL_PAD, groupId: GROUPS.PEDAL_PAD }),
  ]);

  synths = { pad, drone, lead, pedalPad };

  // ── Chord trigger registry ──
  // Each entry defines how a track responds to a chord event.
  // To add a new triggered instrument, push to this array — no ruleEngine edits needed.
  const chordTriggers = [
    {
      track: 'pad',
      trigger(synthsRef, { schedule, offsets }) {
        triggerPadChord(synthsRef, schedule, offsets);
      },
    },
    {
      track: 'lead',
      trigger(synthsRef, { schedule, offsets }) {
        triggerLeadChord(synthsRef, schedule, offsets);
      },
    },
    {
      track: 'drone',
      trigger(synthsRef, { droneNote, chordSec, bassOffset }) {
        if (bassOffset > 0) {
          const delayMs = (chordSec * bassOffset / 4) * 1000;
          setTimeout(() => {
            triggerDrone(synthsRef, droneNote, chordSec);
          }, delayMs);
        } else {
          triggerDrone(synthsRef, droneNote, chordSec);
        }
      },
    },
  ];

  // ── Texture player ──
  texturePlayer = createTexturePlayer({ outBus: BUSES.TEXTURE });

  console.log('[mixer] Initialized — all tracks, effects, reverbs, and master ready');

  return {
    synths,
    texturePlayer,
    trackEffects,
    chordTriggers,
    setTrackVolume,
    setMasterVolume,
    swapLead: leadSlot.swap,
    swapLeadRandom: leadSlot.swapRandom,
    swapBass: bassSlot.swap,
    swapBassRandom: bassSlot.swapRandom,
    swapPedalPadRandom: pedalPadSlot.swapRandom,
    pollLevels,
    dispose: disposeMixer,
  };
}

/**
 * Creates a swappable instrument slot.
 * Returns { swap, swapRandom, getCurrentId } for a named synth track.
 *
 * @param {object} opts
 * @param {string} opts.label - Display name for logging (e.g. 'lead', 'bass')
 * @param {string} opts.synthKey - Key in the synths object (e.g. 'lead', 'drone')
 * @param {Array} opts.instruments - Instrument registry (LEAD_INSTRUMENTS or BASS_INSTRUMENTS)
 * @param {string} opts.defaultId - Default instrument ID
 * @param {number} opts.outBus - SC output bus
 * @param {number} opts.groupId - SC group
 */
function createSwappableSlot({ label, synthKey, instruments, defaultId, outBus, groupId }) {
  let currentId = defaultId;

  async function swap(instrumentId) {
    const config = instruments.find(i => i.id === instrumentId);
    if (!config || instrumentId === currentId) return;

    let newSynth;
    try {
      newSynth = await createSampleSynth(config, { outBus, groupId });
    } catch (err) {
      console.warn(`[mixer] ${label} swap to "${config.name}" failed:`, err.message);
      return;
    }

    const oldSynth = synths[synthKey];
    const oldId = currentId;
    synths[synthKey] = newSynth;
    currentId = instrumentId;

    if (oldSynth) {
      oldSynth.releaseAll();
      const tid = setTimeout(() => {
        pendingDisposeTimers = pendingDisposeTimers.filter(t => t !== tid);
        oldSynth.dispose();
        freeInstrumentSamples(oldId);
      }, 5000);
      pendingDisposeTimers.push(tid);
    }
    console.log(`[mixer] ${label} swapped to ${config.name}`);
  }

  async function swapRandom() {
    const pick = instruments[Math.floor(Math.random() * instruments.length)];
    if (pick.id !== currentId) {
      await swap(pick.id);
    }
    return { plucked: pick.plucked };
  }

  function getCurrentId() { return currentId; }

  return { swap, swapRandom, getCurrentId };
}

// Create swappable slots for lead, bass, and pedal pad
const leadSlot = createSwappableSlot({
  label: 'lead', synthKey: 'lead',
  instruments: LEAD_INSTRUMENTS, defaultId: DEFAULT_LEAD,
  outBus: BUSES.LEAD, groupId: GROUPS.LEAD,
});
const bassSlot = createSwappableSlot({
  label: 'bass', synthKey: 'drone',
  instruments: BASS_INSTRUMENTS, defaultId: DEFAULT_BASS,
  outBus: BUSES.DRONE, groupId: GROUPS.DRONE,
});
const pedalPadSlot = createSwappableSlot({
  label: 'pedalPad', synthKey: 'pedalPad',
  instruments: PAD_INSTRUMENTS, defaultId: DEFAULT_PAD_SAMPLE,
  outBus: BUSES.PEDAL_PAD, groupId: GROUPS.PEDAL_PAD,
});

/**
 * Sets the volume for a specific track via OSC.
 * @param {string} track - Track name
 * @param {number} value - Gain value 0–1
 */
export function setTrackVolume(track, value) {
  const nodeId = trackGainNodeIds[track];
  if (nodeId !== undefined) {
    nodeSet(nodeId, { gain: value });
  }
}

/**
 * Sets the master volume via OSC.
 * @param {number} value - Gain value 0–1
 */
export function setMasterVolume(value) {
  if (masterGainNodeId !== null) {
    nodeSet(masterGainNodeId, { gain: value });
  }
}

/**
 * Returns current mixer state for the debug UI.
 */
export function getMixerState() {
  const currentLeadId = leadSlot.getCurrentId();
  const currentBassId = bassSlot.getCurrentId();
  const leadConfig = LEAD_INSTRUMENTS.find(i => i.id === currentLeadId);
  const bassConfig = BASS_INSTRUMENTS.find(i => i.id === currentBassId);
  return {
    currentLeadId,
    currentLeadName: leadConfig ? leadConfig.name : currentLeadId,
    currentLeadPlucked: leadConfig ? leadConfig.plucked : false,
    currentBassId,
    currentBassName: bassConfig ? bassConfig.name : currentBassId,
    currentBassPlucked: bassConfig ? bassConfig.plucked : false,
  };
}

const METER_NAMES = ['pad', 'drone', 'lead', 'texture', 'archive', 'freesound', 'master'];

/**
 * Polls all bus meter control buses and returns per-track levels.
 * @returns {Promise<Object<string, { rms: number, peak: number, db: number }>>}
 */
export async function pollLevels() {
  try {
    const args = await controlBusGetN(METER_CTL_START, METER_CTL_COUNT);
    // args = [busIndex, count, val0, val1, val2, ...]
    const values = args.slice(2); // skip busIndex and count
    const levels = {};
    for (let i = 0; i < METER_NAMES.length; i++) {
      const rms = values[i * 2] || 0;
      const peak = values[i * 2 + 1] || 0;
      const db = rms > 0.00001 ? 20 * Math.log10(rms) : -100;
      levels[METER_NAMES[i]] = { rms, peak, db: Math.round(db * 10) / 10 };
    }
    return levels;
  } catch {
    return null;
  }
}

function disposeMixer() {
  for (const tid of pendingDisposeTimers) {
    clearTimeout(tid);
  }
  pendingDisposeTimers = [];

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
  // Track gain nodes and master are freed when SC server is rebooted
  trackGainNodeIds = {};
  masterGainNodeId = null;
}
