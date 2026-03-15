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
      // Include static params for UI display
      if (spec.params) {
        const p = { ...spec.params };
        delete p.type; // filter subtype already captured above
        entry.params = p;
      }
      // Flag if this effect has per-cycle randomization
      if (spec.id && TRACK_EFFECT_RANGES[spec.id]) {
        entry.randomized = true;
        entry.ranges = TRACK_EFFECT_RANGES[spec.id];
      }
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

// ── Live effect param snapshot (for UI) ──────────────────────
// Populated by randomizeTrackEffects(), read by getLiveEffectParams()
const _liveParams = {};

// ── Per-cycle track effect randomization ──────────────────────
//
// Each entry maps an effect id (from trackProfiles) to randomization ranges.
// At cycle start, randomizeTrackEffects() picks new values and sends
// nodeSet() — SC's Lag3 (8s) handles the smooth transition.

const TRACK_EFFECT_RANGES = {
  tapeSat: {
    drive: { min: 1.2, max: 3.0 },   // 1.2 = warm, 3 = moderate grit (was 5)
    mix:   { min: 0.08, max: 0.25 },  // keep subtle to avoid harmonic stacking
  },
  spectralSmear: {
    bins: { min: 1, max: 8 },         // 1 = subtle warmth, 8 = moderate blur (was 16)
    mix:  { min: 0.08, max: 0.3 },    // reduced max from 0.45
  },
  ringMod: {
    rate:  { min: 0.1, max: 1.2 },    // sub-audio: slow breathing (was 2.0)
    depth: { min: 0.03, max: 0.2 },   // gentle pulse, halved max from 0.4
  },
  spectralShift: {
    stretch: { min: 0.97, max: 1.03 }, // tighter detune (was 0.95–1.05)
    shift:   { min: -1.5, max: 1.5 },  // ±1.5 bins — subtle ghosting only (was ±3)
    mix:     { min: 0.05, max: 0.15 }, // halved max from 0.3 — this is the main resonance fix
  },
  vinylWobble: {
    density: { min: 0.04, max: 0.25 },  // how often wobbles occur
    depth:   { min: 0.002, max: 0.008 }, // pitch wobble intensity
  },
  lfoFilter: {
    lfoRate: { min: 0.02, max: 0.08 },   // speed of filter sweep
    lfoMin:  { min: 400, max: 1200 },     // low point of sweep
    lfoMax:  { min: 3000, max: 8000 },    // high point of sweep
  },
  spectralFreeze: {
    density: { min: 0.02, max: 0.08 },   // freeze trigger rate
    mix:     { min: 0.1, max: 0.35 },     // wet mix
  },
};

function randRange(range) {
  return range.min + Math.random() * (range.max - range.min);
}

function normalize(value, min, max) {
  return Math.max(0, Math.min(1, (value - min) / (max - min)));
}

/**
 * Randomizes per-track effect parameters for a new song cycle.
 * Finds tagged effect nodes (tapeSat, spectralSmear, ringMod, spectralShift)
 * across all tracks and sends new random values via nodeSet.
 *
 * @param {Object<string, { refs }>} effects - The trackEffects map from createAllTrackEffects()
 */
export function randomizeTrackEffects(effects) {
  if (!effects) return;

  const log = [];

  for (const [trackName, group] of Object.entries(effects)) {
    const { refs } = group;
    if (!refs) continue;

    for (const [id, ranges] of Object.entries(TRACK_EFFECT_RANGES)) {
      const ref = refs[id];
      if (!ref) continue;

      const params = {};
      for (const [param, range] of Object.entries(ranges)) {
        params[param] = randRange(range);
      }
      nodeSet(ref.nodeId, params);

      // Store for UI
      if (!_liveParams[trackName]) _liveParams[trackName] = {};
      _liveParams[trackName][id] = { ...params };

      const desc = Object.entries(params)
        .map(([k, v]) => `${k}:${typeof v === 'number' ? v.toFixed(2) : v}`)
        .join(' ');
      log.push(`${trackName}.${id}(${desc})`);
    }
  }

  // ── Derive compressor from resonance-contributing effects ──
  // After all random effects are set, compute a resonance score (0–1)
  // from the effects that feed energy into the compressor, and set
  // threshold/ratio accordingly. More resonance → harder compression.
  for (const [trackName, group] of Object.entries(effects)) {
    const { refs } = group;
    if (!refs?.compressor) continue;

    const live = _liveParams[trackName] || {};
    let score = 0;
    let contributors = 0;

    // TapeSat drive: more drive → more harmonics
    if (live.tapeSat) {
      const r = TRACK_EFFECT_RANGES.tapeSat;
      score += normalize(live.tapeSat.drive, r.drive.min, r.drive.max);
      contributors++;
    }
    // SpectralShift mix: more mix → more resonant ghosting
    if (live.spectralShift) {
      const r = TRACK_EFFECT_RANGES.spectralShift;
      score += normalize(live.spectralShift.mix, r.mix.min, r.mix.max);
      contributors++;
    }
    // SpectralFreeze mix: frozen partials stack energy
    if (live.spectralFreeze) {
      const r = TRACK_EFFECT_RANGES.spectralFreeze;
      score += normalize(live.spectralFreeze.mix, r.mix.min, r.mix.max);
      contributors++;
    }
    // LFO filter: wider sweep range → more potential peaks
    if (live.lfoFilter) {
      const r = TRACK_EFFECT_RANGES.lfoFilter;
      const sweep = live.lfoFilter.lfoMax - live.lfoFilter.lfoMin;
      const maxSweep = r.lfoMax.max - r.lfoMin.min;
      const minSweep = r.lfoMax.min - r.lfoMin.max;
      score += normalize(sweep, minSweep, maxSweep);
      contributors++;
    }

    if (contributors > 0) score /= contributors;

    // Map score 0–1 → compressor params:
    //   score 0 (gentle effects)  → thresh -14, ratio 2.5 (light)
    //   score 1 (aggressive)      → thresh -24, ratio 5   (heavy)
    const thresh = -14 + score * -10;
    const ratio = 2.5 + score * 2.5;

    const params = { thresh, ratio };
    nodeSet(refs.compressor.nodeId, params);

    if (!_liveParams[trackName]) _liveParams[trackName] = {};
    _liveParams[trackName].compressor = { ...params, resonanceScore: score };

    log.push(`${trackName}.compressor(score:${score.toFixed(2)} thresh:${thresh.toFixed(1)} ratio:${ratio.toFixed(1)})`);
  }

  if (log.length > 0) {
    console.log(`[trackFX] randomized — ${log.join(' | ')}`);
  }
}

/**
 * Returns current live effect parameter values for all tracks.
 * Updated each cycle by randomizeTrackEffects().
 *
 * @returns {Object<string, Object<string, Object<string, number>>>}
 *   e.g. { lead: { tapeSat: { drive: 2.1, mix: 0.15 } } }
 */
export function getLiveEffectParams() {
  return _liveParams;
}

/**
 * Builds a single effect group (for compatibility with old imports).
 */
export { buildEffectGroup };
