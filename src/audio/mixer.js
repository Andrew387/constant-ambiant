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
import { createAllTrackEffects, randomizeTrackEffects } from './effects/trackEffects.js';
import { initSectionAutomation, disposeSectionAutomation } from './effects/sectionAutomation.js';
import { initMasterEffects, randomizeMasterEffects, disposeMasterEffects, getMasterEffectsState } from './effects/masterEffects.js';
import { TRACK_PROFILES } from './trackProfiles.js';
import { triggerLeadChord, triggerLeadReversed, triggerDrone } from '../rhythm/scheduler.js';
import { startSwellTimer, stopSwellTimer } from './effects/leadReversedSwell.js';
import { createSineSynth } from './synths/sineSynth.js';
import { createSampleSynth } from './synths/samplePlayer.js';
import { createTexturePlayer } from './synths/texturePlayer.js';
import {
  LEAD_INSTRUMENTS, BASS_INSTRUMENTS, BASS_LEAD_INSTRUMENTS, PAD_INSTRUMENTS,
  DEFAULT_LEAD, DEFAULT_BASS, DEFAULT_PAD_SAMPLE,
} from './synths/sampleRegistry.js';

// Bass-Lead instruments are eligible for both slots
const LEAD_POOL = [...LEAD_INSTRUMENTS, ...BASS_LEAD_INSTRUMENTS];
const BASS_POOL = [...BASS_INSTRUMENTS, ...BASS_LEAD_INSTRUMENTS];

// leadReversed: all loopable instruments covering octaves 2–4
const LEAD_REVERSED_POOL = [
  ...LEAD_INSTRUMENTS.filter(i => !i.plucked && i.type !== 'sine'),
  ...PAD_INSTRUMENTS.filter(i => !i.plucked),
  ...BASS_LEAD_INSTRUMENTS.filter(i => !i.plucked),
];
import { freeInstrumentSamples } from '../sc/bufferManager.js';

let trackGainNodeIds = {};
let trackEffects = null;
let masterGainNodeId = null;
let sidechainDuckNodeId = null;
let rbOutputNodeId = null;
let synths = null;
let texturePlayer = null;
let pendingDisposeTimers = [];

let meterNodeIds = [];

// Map from track name → SC bus for gain synths
const TRACK_BUS = {
  drone:         BUSES.DRONE,
  lead:          BUSES.LEAD,
  sampleTexture: BUSES.TEXTURE,
  archive:       BUSES.ARCHIVE,
  freesound:     BUSES.FREESOUND,
  pedalPad:      BUSES.PEDAL_PAD,
  bassSupport:   BUSES.BASS_SUPPORT,
  leadReversed:  BUSES.LEAD_REVERSED,
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
    decay: 16,
    damp: 0.3,
  });

  const longReverbId = allocNodeId();
  synthNew('reverbLong', longReverbId, 0, GROUPS.REVERBS, {
    inBus: BUSES.REVERB_LONG,
    outBus: BUSES.MASTER,
    decay: 19,
    damp: 0.2,
  });

  // ── Master effects (reverb, delay, filter LFO — placed in master group BEFORE masterOut) ──
  initMasterEffects();

  // ── Sidechain duck (riser-boomer FX ducks the master bus) ──
  // Added at HEAD after master effects, so execution order is:
  //   ducker → rbOutput → masterFilter → masterDelay → masterReverb → masterOut
  // The riser-boomer output (bus 24 → bus 2) is added after the ducker,
  // so the FX signal bypasses ducking and flows through master effects.
  sidechainDuckNodeId = allocNodeId();
  rbOutputNodeId = allocNodeId();

  // rbOutput first (will be pushed down when ducker is added at head)
  synthNew('fxTrackOut', rbOutputNodeId, 0, GROUPS.MASTER, {
    bus: BUSES.RISER_BOOMER,
    masterBus: BUSES.MASTER,
    gain: 1,
  });

  // Ducker at head (runs before rbOutput)
  synthNew('fxSidechainDuck', sidechainDuckNodeId, 0, GROUPS.MASTER, {
    bus: BUSES.MASTER,
    keyBus: BUSES.RISER_BOOMER,
    thresh: -30,
    ratio: 8,
    attack: 0.005,
    release: 0.8,
    depth: 1.0,
  });

  // ── Master output (placed in master group, AFTER master effects) ──
  masterGainNodeId = allocNodeId();
  synthNew('masterOut', masterGainNodeId, 1, GROUPS.MASTER, {
    inBus: BUSES.MASTER,
    outBus: 0,
    gain: 0.8,
  });

  // ── Per-track bus meters (at tail of effects group for track buses) ──
  meterNodeIds = [];
  const trackMeters = [
    { audioBus: BUSES.DRONE,         ctlBus: METER_CTL_BUSES.DRONE },
    { audioBus: BUSES.LEAD,          ctlBus: METER_CTL_BUSES.LEAD },
    { audioBus: BUSES.TEXTURE,       ctlBus: METER_CTL_BUSES.TEXTURE },
    { audioBus: BUSES.ARCHIVE,       ctlBus: METER_CTL_BUSES.ARCHIVE },
    { audioBus: BUSES.FREESOUND,     ctlBus: METER_CTL_BUSES.FREESOUND },
    { audioBus: BUSES.LEAD_REVERSED, ctlBus: METER_CTL_BUSES.LEAD_REVERSED },
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
  const leadConfig = LEAD_POOL.find(i => i.id === leadSlot.getCurrentId());
  const bassConfig = BASS_POOL.find(i => i.id === bassSlot.getCurrentId());
  const padSampleConfig = PAD_INSTRUMENTS.find(i => i.id === pedalPadSlot.getCurrentId());

  const lead = leadConfig.type === 'sine'
    ? createSineSynth({ outBus: BUSES.LEAD, groupId: GROUPS.LEAD })
    : await createSampleSynth(leadConfig, { outBus: BUSES.LEAD, groupId: GROUPS.LEAD });

  const bassSupportConfig = PAD_INSTRUMENTS.find(i => i.id === bassSupportSlot.getCurrentId());
  const leadReversedConfig = LEAD_REVERSED_POOL.find(i => i.id === leadReversedSlot.getCurrentId());

  const [drone, pedalPad, bassSupport, leadReversed] = await Promise.all([
    createSampleSynth(bassConfig, { outBus: BUSES.DRONE, groupId: GROUPS.DRONE }),
    createSampleSynth(padSampleConfig, { outBus: BUSES.PEDAL_PAD, groupId: GROUPS.PEDAL_PAD }),
    createSampleSynth(bassSupportConfig, { outBus: BUSES.BASS_SUPPORT, groupId: GROUPS.BASS_SUPPORT }),
    createSampleSynth(leadReversedConfig, { outBus: BUSES.LEAD_REVERSED, groupId: GROUPS.LEAD_REVERSED }),
  ]);

  synths = { drone, lead, pedalPad, bassSupport, leadReversed, drone2: null };

  // ── Chord trigger registry ──
  // Each entry defines how a track responds to a chord event.
  // To add a new triggered instrument, push to this array — no ruleEngine edits needed.
  const chordTriggers = [
    {
      track: 'lead',
      trigger(synthsRef, { schedule, offsets }) {
        triggerLeadChord(synthsRef, schedule, offsets);
      },
    },
    {
      track: 'drone',
      trigger(synthsRef, { droneNote, chordSec, bassOffset }) {
        console.log(`[mixer] drone trigger → ${droneNote} (${chordSec.toFixed(1)}s, offset beat ${bassOffset})${synthsRef.drone2 ? ' [dual]' : ''}`);
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
    {
      track: 'leadReversed',
      trigger(synthsRef, { leadReversedChord }) {
        if (!leadReversedChord) return;
        triggerLeadReversed(synthsRef, leadReversedChord.voicedNotes);
      },
    },
    // TODO: Bass support disabled while evaluating dual-plucked bass balance
    // {
    //   track: 'bassSupport',
    //   trigger(synthsRef, { droneNote, chordSec, bassIsPlucked }) {
    //     if (!bassIsPlucked || !synthsRef.bassSupport) return;
    //     // Drop one octave below the drone (e.g. C2 → C1) for low pad support
    //     const match = droneNote.match(/^([A-G]#?)(\d+)$/);
    //     const lowNote = match ? `${match[1]}${Math.max(1, Number(match[2]) - 1)}` : droneNote;
    //     console.log(`[mixer] bassSupport trigger → ${lowNote} (${chordSec.toFixed(1)}s)`);
    //     synthsRef.bassSupport.triggerAttackRelease(lowNote, chordSec);
    //   },
    // },
  ];

  // ── Lead reversed swell timer ──
  const swellFilterRef = trackEffects.leadReversed?.refs?.swellFilter;
  const swellGainRef = trackEffects.leadReversed?.refs?.swellGain;
  if (swellFilterRef && swellGainRef) {
    startSwellTimer(swellFilterRef.nodeId, swellGainRef.nodeId);
  }

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
    randomizeMasterEffects,
    randomizeTrackEffects: () => randomizeTrackEffects(trackEffects),
    getMasterEffectsState,
    swapLead: leadSlot.swap,
    swapLeadRandom: leadSlot.swapRandom,
    swapBass: bassSlot.swap,
    swapBassRandom: bassSlot.swapRandom,
    swapPedalPadRandom: pedalPadSlot.swapRandom,
    swapBassSupportRandom: bassSupportSlot.swapRandom,
    swapLeadReversedRandom: leadReversedSlot.swapRandom,
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
      if (config.type === 'sine') {
        newSynth = createSineSynth({ outBus, groupId });
      } else {
        newSynth = await createSampleSynth(config, { outBus, groupId });
      }
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
      // Wait longer than the longest possible release envelope.
      // Release time = chordSec * 1.2 * relLevel, where chordSec can
      // reach ~10.7s and relLevel up to 2.0 → ~25.6s max.
      // Use 45s to be safe — the only cost is keeping buffers in memory longer.
      const tid = setTimeout(() => {
        pendingDisposeTimers = pendingDisposeTimers.filter(t => t !== tid);
        console.log(`[mixer] disposing old ${label} "${oldId}" (45s timer fired)`);
        oldSynth.dispose();
        const oldConfig = instruments.find(i => i.id === oldId);
        if (oldConfig && oldConfig.type !== 'sine') {
          freeInstrumentSamples(oldId);
        }
      }, 45000);
      pendingDisposeTimers.push(tid);
    }
    console.log(`[mixer] ${label} swapped to ${config.name}`);
  }

  async function swapRandom() {
    const others = instruments.filter(i => i.id !== currentId);
    const pick = others.length > 0
      ? others[Math.floor(Math.random() * others.length)]
      : instruments[0];
    await swap(pick.id);
    return { plucked: pick.plucked };
  }

  function getCurrentId() { return currentId; }

  return { swap, swapRandom, getCurrentId };
}

// Create swappable slots for lead, bass, and pedal pad
const leadSlot = createSwappableSlot({
  label: 'lead', synthKey: 'lead',
  instruments: LEAD_POOL, defaultId: DEFAULT_LEAD,
  outBus: BUSES.LEAD, groupId: GROUPS.LEAD,
});
// Bass slot — custom implementation for dual-plucked support.
// When a plucked bass is selected, two different plucked instruments
// are loaded and play simultaneously for richer plucked textures.
const bassSlot = (() => {
  let currentId = DEFAULT_BASS;
  let secondPluckedId = null; // ID of the second plucked instrument (if active)

  // All plucked instruments available in the bass pool
  const pluckedPool = BASS_POOL.filter(i => i.plucked);

  /** Pick a second plucked instrument different from the primary */
  function pickSecondPlucked(primaryId) {
    const others = pluckedPool.filter(i => i.id !== primaryId);
    return others.length > 0
      ? others[Math.floor(Math.random() * others.length)]
      : null;
  }

  /** Gain multiplier for dual-plucked mode (−6 dB ≈ half amplitude) */
  const DUAL_GAIN_FACTOR = 0.5;

  async function swap(instrumentId) {
    const config = BASS_POOL.find(i => i.id === instrumentId);
    if (!config || instrumentId === currentId) return;

    // ── Dispose previous drone2 if any ──
    const oldDrone2 = synths.drone2;
    const oldSecondId = secondPluckedId;
    synths.drone2 = null;
    secondPluckedId = null;
    if (oldDrone2) {
      oldDrone2.releaseAll();
      const tid2 = setTimeout(() => {
        pendingDisposeTimers = pendingDisposeTimers.filter(t => t !== tid2);
        console.log(`[mixer] disposing old bass2 "${oldSecondId}" (45s timer fired)`);
        oldDrone2.dispose();
        if (oldSecondId) freeInstrumentSamples(oldSecondId);
      }, 45000);
      pendingDisposeTimers.push(tid2);
    }

    // ── Create primary bass synth ──
    let newSynth;
    try {
      const primaryConfig = config.plucked
        ? { ...config, gain: (config.gain ?? 1) * DUAL_GAIN_FACTOR }
        : config;
      newSynth = await createSampleSynth(primaryConfig, { outBus: BUSES.DRONE, groupId: GROUPS.DRONE });
    } catch (err) {
      console.warn(`[mixer] bass swap to "${config.name}" failed:`, err.message);
      return;
    }

    // ── Create second plucked bass if primary is plucked ──
    if (config.plucked) {
      const secondConfig = pickSecondPlucked(instrumentId);
      if (secondConfig) {
        try {
          const adjustedConfig = { ...secondConfig, gain: (secondConfig.gain ?? 1) * DUAL_GAIN_FACTOR };
          const secondSynth = await createSampleSynth(adjustedConfig, { outBus: BUSES.DRONE, groupId: GROUPS.DRONE });
          synths.drone2 = secondSynth;
          secondPluckedId = secondConfig.id;
          console.log(`[mixer] bass2 (dual plucked) → ${secondConfig.name}`);
        } catch (err) {
          console.warn(`[mixer] bass2 creation failed:`, err.message);
          // Continue with single bass — non-fatal
        }
      }
    }

    // ── Swap out old primary ──
    const oldSynth = synths.drone;
    const oldId = currentId;
    synths.drone = newSynth;
    currentId = instrumentId;

    if (oldSynth) {
      oldSynth.releaseAll();
      const tid = setTimeout(() => {
        pendingDisposeTimers = pendingDisposeTimers.filter(t => t !== tid);
        console.log(`[mixer] disposing old bass "${oldId}" (45s timer fired)`);
        oldSynth.dispose();
        const oldConfig = BASS_POOL.find(i => i.id === oldId);
        if (oldConfig && oldConfig.type !== 'sine') {
          freeInstrumentSamples(oldId);
        }
      }, 45000);
      pendingDisposeTimers.push(tid);
    }
    console.log(`[mixer] bass swapped to ${config.name}${synths.drone2 ? ' (dual plucked)' : ''}`);
  }

  async function swapRandom() {
    const others = BASS_POOL.filter(i => i.id !== currentId);
    const pick = others.length > 0
      ? others[Math.floor(Math.random() * others.length)]
      : BASS_POOL[0];
    await swap(pick.id);
    return { plucked: pick.plucked };
  }

  function getCurrentId() { return currentId; }

  function getSecondPluckedId() { return secondPluckedId; }

  return { swap, swapRandom, getCurrentId, getSecondPluckedId };
})();
const pedalPadSlot = createSwappableSlot({
  label: 'pedalPad', synthKey: 'pedalPad',
  instruments: PAD_INSTRUMENTS, defaultId: DEFAULT_PAD_SAMPLE,
  outBus: BUSES.PEDAL_PAD, groupId: GROUPS.PEDAL_PAD,
});
const bassSupportSlot = createSwappableSlot({
  label: 'bassSupport', synthKey: 'bassSupport',
  instruments: PAD_INSTRUMENTS, defaultId: DEFAULT_PAD_SAMPLE,
  outBus: BUSES.BASS_SUPPORT, groupId: GROUPS.BASS_SUPPORT,
});
const leadReversedSlot = createSwappableSlot({
  label: 'leadReversed', synthKey: 'leadReversed',
  instruments: LEAD_REVERSED_POOL, defaultId: LEAD_REVERSED_POOL[Math.floor(Math.random() * LEAD_REVERSED_POOL.length)].id,
  outBus: BUSES.LEAD_REVERSED, groupId: GROUPS.LEAD_REVERSED,
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
  const leadConfig = LEAD_POOL.find(i => i.id === currentLeadId);
  const bassConfig = BASS_POOL.find(i => i.id === currentBassId);
  const bass2Id = bassSlot.getSecondPluckedId ? bassSlot.getSecondPluckedId() : null;
  const bass2Config = bass2Id ? BASS_POOL.find(i => i.id === bass2Id) : null;
  return {
    currentLeadId,
    currentLeadName: leadConfig ? leadConfig.name : currentLeadId,
    currentLeadPlucked: leadConfig ? leadConfig.plucked : false,
    currentBassId,
    currentBassName: bassConfig ? bassConfig.name : currentBassId,
    currentBassPlucked: bassConfig ? bassConfig.plucked : false,
    currentBass2Id: bass2Id,
    currentBass2Name: bass2Config ? bass2Config.name : null,
  };
}

// Map meter names to their control bus offset within the METER_CTL block.
// Each meter writes 2 values (rms, peak), so DRONE at ctl bus 102 = offset 2.
const METER_LAYOUT = [
  { name: 'drone',        offset: (METER_CTL_BUSES.DRONE         - METER_CTL_START) },
  { name: 'lead',         offset: (METER_CTL_BUSES.LEAD          - METER_CTL_START) },
  { name: 'texture',      offset: (METER_CTL_BUSES.TEXTURE       - METER_CTL_START) },
  { name: 'archive',      offset: (METER_CTL_BUSES.ARCHIVE       - METER_CTL_START) },
  { name: 'freesound',    offset: (METER_CTL_BUSES.FREESOUND     - METER_CTL_START) },
  { name: 'master',       offset: (METER_CTL_BUSES.MASTER        - METER_CTL_START) },
  { name: 'leadReversed', offset: (METER_CTL_BUSES.LEAD_REVERSED - METER_CTL_START) },
];

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
    for (const { name, offset } of METER_LAYOUT) {
      const rms = values[offset] || 0;
      const peak = values[offset + 1] || 0;
      const db = rms > 0.00001 ? 20 * Math.log10(rms) : -100;
      levels[name] = { rms, peak, db: Math.round(db * 10) / 10 };
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

  disposeMasterEffects();
  disposeSectionAutomation();
  stopSwellTimer();

  if (texturePlayer) {
    texturePlayer.dispose();
    texturePlayer = null;
  }
  if (synths) {
    Object.values(synths).forEach(s => s && s.dispose());
    synths = null;
  }
  if (trackEffects) {
    Object.values(trackEffects).forEach(fx => fx.dispose());
    trackEffects = null;
  }
  // Sidechain duck + riser-boomer output
  if (sidechainDuckNodeId) { nodeFree(sidechainDuckNodeId); sidechainDuckNodeId = null; }
  if (rbOutputNodeId) { nodeFree(rbOutputNodeId); rbOutputNodeId = null; }

  // Track gain nodes and master are freed when SC server is rebooted
  trackGainNodeIds = {};
  masterGainNodeId = null;
}
