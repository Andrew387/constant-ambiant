/**
 * Track effect chain manager — OSC-based SuperCollider effects.
 *
 * Instead of building Tone.js node chains, this module creates
 * persistent SC effect synths on each track's bus. The effect synths
 * use ReplaceOut to process audio in-place on the bus.
 *
 * Each track effect group also includes:
 *   - A reverb send (Out.ar to shared reverb bus)
 *   - A track output (routes processed audio to master bus)
 *
 * The refs map exposes node IDs for automation targets (dynamicFilter,
 * duckGain) so sectionAutomation.js can set their parameters via OSC.
 */

import { synthNew, nodeSet, nodeFree } from '../../sc/osc.js';
import { allocNodeId, GROUPS, BUSES } from '../../sc/nodeIds.js';
import { TRACK_PROFILES } from '../trackProfiles.js';
import { resolveEffect } from './effectRegistry.js';

// Map from TRACK_PROFILES track name → SC bus number
const TRACK_BUS_MAP = {
  drone:         BUSES.DRONE,
  lead:          BUSES.LEAD,
  sampleTexture: BUSES.TEXTURE,
  archive:       BUSES.ARCHIVE,
  freesound:     BUSES.FREESOUND,
  pedalPad:      BUSES.PEDAL_PAD,
  bassSupport:   BUSES.BASS_SUPPORT,
};

// Map from TRACK_PROFILES track name → which reverb bus to send to
const TRACK_REVERB_MAP = {
  drone:         BUSES.REVERB_LONG,
  lead:          BUSES.REVERB_SHORT,
  sampleTexture: BUSES.REVERB_LONG,
  archive:       BUSES.REVERB_LONG,
  freesound:     BUSES.REVERB_LONG,
  pedalPad:      BUSES.REVERB_LONG,
  bassSupport:   BUSES.REVERB_LONG,
};

// Dry output gain per track (1 = full dry, lower = more reverb-dominant)
const TRACK_DRY_GAIN = {
  sampleTexture: 0.1,   // mostly wet — reverb-dominant texture wash
};

// Reverb send levels per track (from original effect chains)
const REVERB_SEND_LEVELS = {
  drone:         0.2,    // subtle reverb to fill low end
  lead:          0.45,   // from lead chain: Reverb wet: 0.45
  sampleTexture: 0.4,    // heavy reverb wash, mostly wet
  archive:       0.3,    // moderate reverb (lowered — AGC already normalizes levels)
  freesound:     0.0,    // freesound has its own reverb per-sound
  pedalPad:      0.45,   // warm reverb wash for pedal tone
  bassSupport:   0.3,    // moderate reverb for bass support pad
};

/**
 * Builds a single track's effect chain as SC synths on its bus.
 *
 * @param {string} trackName - e.g. 'lead'
 * @param {Array} chainSpec - Effect specs from TRACK_PROFILES
 * @returns {{ refs, nodeIds, dispose }}
 */
function buildEffectGroup(trackName, chainSpec) {
  const bus = TRACK_BUS_MAP[trackName];
  if (bus === undefined) {
    console.warn(`[trackEffects] no bus mapping for track "${trackName}"`);
    return { refs: {}, nodeIds: [], dispose() {} };
  }

  const refs = {};
  const nodeIds = [];

  // Build effect synths based on chainSpec using the effect registry
  for (const spec of chainSpec) {
    const resolved = resolveEffect(spec);
    if (!resolved) continue; // skipped (e.g., Reverb) or unsupported

    const { defName, params: resolvedParams } = resolved;
    const params = { bus, ...resolvedParams };

    const nodeId = allocNodeId();
    synthNew(defName, nodeId, 1, GROUPS.EFFECTS, params); // tail of effects group
    nodeIds.push(nodeId);

    // Tag for external access (automation)
    if (spec.id) {
      refs[spec.id] = { nodeId, defName, type: spec.type };
    }
  }

  // Add reverb send if this track has a non-zero send level
  const sendLevel = REVERB_SEND_LEVELS[trackName] ?? 0;
  if (sendLevel > 0) {
    const sendBus = TRACK_REVERB_MAP[trackName] ?? BUSES.REVERB_LONG;
    const sendNodeId = allocNodeId();
    synthNew('fxReverbSend', sendNodeId, 1, GROUPS.EFFECTS, {
      bus,
      sendBus,
      level: sendLevel,
    });
    nodeIds.push(sendNodeId);
  }

  // Add track output → master bus
  const dryGain = TRACK_DRY_GAIN[trackName] ?? 1;
  const outNodeId = allocNodeId();
  synthNew('fxTrackOut', outNodeId, 1, GROUPS.EFFECTS, {
    bus,
    masterBus: BUSES.MASTER,
    gain: dryGain,
  });
  nodeIds.push(outNodeId);
  refs._trackOut = { nodeId: outNodeId, defName: 'fxTrackOut' };

  return {
    refs,
    nodeIds,
    dispose() {
      for (const nid of nodeIds) {
        nodeFree(nid);
      }
      nodeIds.length = 0;
    },
  };
}

/**
 * Creates all per-track effect groups from TRACK_PROFILES.
 * Spawns SC synths on the effects group for each track.
 *
 * @returns {Object<string, { refs, nodeIds, dispose }>}
 */
export function createAllTrackEffects() {
  const effects = {};
  for (const [name, profile] of Object.entries(TRACK_PROFILES)) {
    // Validate that every profiled track has a bus mapping
    if (TRACK_BUS_MAP[name] === undefined) {
      console.error(
        `[trackEffects] TRACK_PROFILES has "${name}" but TRACK_BUS_MAP does not. ` +
        `Add it to TRACK_BUS_MAP, TRACK_REVERB_MAP, and REVERB_SEND_LEVELS.`
      );
    }
    // Validate that automated tracks have the required effect nodes
    if (profile.automation) {
      const hasDuckGain = profile.chain.some(s => s.id === 'duckGain');
      if (!hasDuckGain) {
        console.error(
          `[trackEffects] "${name}" has automation but no duckGain node in its chain. ` +
          `sectionAutomation will not work for this track.`
        );
      }
      if (profile.automation.freqRange) {
        const hasFilter = profile.chain.some(s => s.id === 'dynamicFilter');
        if (!hasFilter) {
          console.error(
            `[trackEffects] "${name}" has freqRange automation but no dynamicFilter node. ` +
            `Frequency automation will be silently ignored.`
          );
        }
      }
    }
    effects[name] = buildEffectGroup(name, profile.chain);
  }
  return effects;
}

/**
 * Returns a UI-friendly description of all track effect chains.
 * Includes which effects are present, their types, automation tags, and reverb send info.
 *
 * @returns {Object<string, { effects: Array<{ type, id?, scDef }>, reverbSend: number, reverbBus: string }>}
 */
export function getEffectChainInfo() {
  const info = {};
  for (const [name, profile] of Object.entries(TRACK_PROFILES)) {
    const effects = [];
    for (const spec of profile.chain) {
      if (spec.type === 'Reverb') continue; // handled as send
      const entry = { type: spec.type };
      if (spec.id) entry.id = spec.id;
      if (spec.lfo) entry.lfo = true;
      if (spec.params?.type === 'highpass') entry.subtype = 'highpass';
      else if (spec.type === 'Filter') entry.subtype = 'lowpass';
      effects.push(entry);
    }
    const sendLevel = REVERB_SEND_LEVELS[name] ?? 0;
    const reverbBus = TRACK_REVERB_MAP[name] === BUSES.REVERB_SHORT ? 'short' : 'long';
    const entry = { effects, reverbSend: sendLevel, reverbBus };
    if (profile.automation) {
      entry.automation = {
        brightness: profile.automation.brightness,
        duckFloor: profile.automation.duckFloor,
        freqRange: profile.automation.freqRange || null,
      };
    }
    info[name] = entry;
  }
  return info;
}

/**
 * Builds a single effect group (for compatibility with old imports).
 */
export { buildEffectGroup };
