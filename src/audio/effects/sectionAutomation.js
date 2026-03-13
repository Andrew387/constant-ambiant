/**
 * Section automation module — OSC output.
 *
 * Same JS logic as the original: brightness-based filter + duck gain
 * automation across tracks. But instead of setting Tone.js node params,
 * we send /n_set OSC messages to SuperCollider effect synth nodes.
 *
 * Each automated track has:
 *   - A dynamic lowpass filter (cutoff mapped from brightness)
 *   - A duck gain (volume reduction mapped from brightness)
 *   - Per-section brightness targets (0 = muffled, 1 = bright)
 *   - S-curve interpolation with per-transition randomness
 */

import { TRACK_PROFILES } from '../trackProfiles.js';
import { SECTION_DURATIONS, SECTION_HOLD_UNTIL, SECTION_ORDER } from '../../engine/sections.config.js';
import { nodeSet } from '../../sc/osc.js';

// ── Per-transition brightness randomness ──
const BRIGHTNESS_JITTER = 0.10;

// Cache: track → { key, currentBright, nextBright }
const _brightCache = {};

function _getCachedBrightness(trackName, baseCurrent, baseNext, currentSection, nextSection) {
  const key = `${currentSection}→${nextSection}`;
  const cached = _brightCache[trackName];

  if (cached && cached.key === key) {
    return cached;
  }

  const entry = {
    key,
    currentBright: Math.max(0, Math.min(1, baseCurrent + (Math.random() - 0.5) * 2 * BRIGHTNESS_JITTER)),
    nextBright:    Math.max(0, Math.min(1, baseNext    + (Math.random() - 0.5) * 2 * BRIGHTNESS_JITTER)),
  };
  _brightCache[trackName] = entry;
  return entry;
}

// Hold thresholds imported from sections.config.js as SECTION_HOLD_UNTIL

// ── Per-track automation state ──
// Map<string, { filter: { nodeId }, duckGain: { nodeId }, config }> populated by init
let automatedTracks = {};

// ── Live state snapshot for UI polling ──
let _lastLiveState = null;

// ── Deferred fade-in state ──
// SECTION_ORDER imported from sections.config.js

const _fadeInState = {};
let _fadeInLastSection = null;

function _resetFadeIn(trackName, fadeConfig) {
  const { window: sections } = fadeConfig;
  const triggerSection = sections[Math.floor(Math.random() * sections.length)];
  const triggerProgress = Math.random();

  _fadeInState[trackName] = {
    triggerSection,
    triggerProgress,
    phase: 'silent',
  };

  console.log(
    `[automation] ${trackName} deferred fade-in: ` +
    `trigger at ${triggerSection} ${(triggerProgress * 100).toFixed(0)}%`
  );
}

function _maybeResetFadeIns(currentSection) {
  if (currentSection === 'transition' && _fadeInLastSection !== 'transition') {
    for (const [name, { config }] of Object.entries(automatedTracks)) {
      if (config.deferredFadeIn) {
        _resetFadeIn(name, config.deferredFadeIn);
      }
    }
  }
  _fadeInLastSection = currentSection;
}

// ── Gain swell state ──
const _swellState = {};

function _planSwellsForSection(trackName, swellConfig, sectionType) {
  const duration = SECTION_DURATIONS[sectionType];
  if (!duration || !swellConfig.sections.includes(sectionType)) {
    _swellState[trackName] = { section: sectionType, swells: [] };
    return;
  }

  const swells = [];
  let loop = 0;
  while (loop < duration) {
    if (Math.random() < swellConfig.probability) {
      const gain = swellConfig.gainRange[0] +
        Math.random() * (swellConfig.gainRange[1] - swellConfig.gainRange[0]);
      const loopDur = Math.floor(Math.random() * (swellConfig.loopRange[1] - swellConfig.loopRange[0] + 1)) +
        swellConfig.loopRange[0];
      const endLoop = Math.min(loop + loopDur, duration);
      swells.push({ startLoop: loop, endLoop, gain });
      loop = endLoop;
    } else {
      loop++;
    }
  }

  _swellState[trackName] = { section: sectionType, swells };
  if (swells.length > 0) {
    console.log(
      `[automation] ${trackName} gain swells for ${sectionType}: ` +
      swells.map(s => `loops ${s.startLoop}–${s.endLoop - 1} @ ${s.gain.toFixed(2)}`).join(', ')
    );
  }
}

function _getSwellGain(trackName, sectionType, progress) {
  const state = _swellState[trackName];
  if (!state || state.section !== sectionType) return null;

  const duration = SECTION_DURATIONS[sectionType] || 1;
  const currentLoop = Math.min(duration - 1, Math.floor(progress * duration));

  for (const swell of state.swells) {
    if (currentLoop >= swell.startLoop && currentLoop < swell.endLoop) {
      return swell.gain;
    }
  }
  return null;
}

// ── Helpers ──

function ease(t) {
  return (1 - Math.cos(t * Math.PI)) / 2;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function brightnessToFreq(brightness, range) {
  const logMin = Math.log(range.min);
  const logMax = Math.log(range.max);
  return Math.exp(logMin + brightness * (logMax - logMin));
}

function brightnessToDuck(brightness, duckFloor) {
  return duckFloor + brightness * (1.0 - duckFloor);
}

// ── Public API ──

/**
 * Registers automated tracks by scanning profiles and matching
 * SC node refs from the built effect groups.
 *
 * @param {Object<string, { refs }>} allTrackEffects
 */
export function initSectionAutomation(allTrackEffects) {
  automatedTracks = {};

  for (const [name, profile] of Object.entries(TRACK_PROFILES)) {
    if (!profile.automation) continue;

    const fx = allTrackEffects[name];
    if (!fx) {
      console.warn(`[automation] profile "${name}" has automation but no effect group`);
      continue;
    }

    const filter = fx.refs.dynamicFilter || null;
    const duckGain = fx.refs.duckGain;

    if (!duckGain) {
      console.warn(`[automation] profile "${name}" missing duckGain ref`);
      continue;
    }

    automatedTracks[name] = { filter, duckGain, config: profile.automation };
    console.log(`[automation]   ${name}: duckGain nodeId=${duckGain.nodeId}${filter ? ` filter nodeId=${filter.nodeId}` : ''} deferredFadeIn=${!!profile.automation.deferredFadeIn}`);
  }

  const names = Object.keys(automatedTracks);
  console.log(`[automation] initialized ${names.length} tracks: ${names.join(', ')}`);
}

/**
 * Updates all automated tracks based on current section, next section,
 * and progress. Called once per chord event from ruleEngine.
 *
 * Sends /n_set OSC messages to SC effect synth nodes.
 *
 * @param {string} currentSection
 * @param {string} nextSection
 * @param {number} progress - 0–1 through current section
 * @param {number} [rampTime=6] - Ramp time (informational, SC does instant set)
 */
export function updateSectionAutomation(currentSection, nextSection, progress, rampTime = 6) {
  _maybeResetFadeIns(currentSection);

  const holdUntil = SECTION_HOLD_UNTIL[currentSection] ?? 0;
  const remapped = progress <= holdUntil
    ? 0
    : (progress - holdUntil) / (1 - holdUntil);
  const t = ease(remapped);

  const debugParts = [];
  const liveState = {};

  for (const [name, { filter, duckGain, config }] of Object.entries(automatedTracks)) {
    const { brightness, freqRange, duckFloor, deferredFadeIn, holdOverride, gainSwells } = config;

    const baseCurrent = brightness[currentSection] ?? 0.5;
    const baseNext    = brightness[nextSection]    ?? 0.5;
    const { currentBright, nextBright } = _getCachedBrightness(
      name, baseCurrent, baseNext, currentSection, nextSection
    );

    let trackT = t;
    if (holdOverride && holdOverride[currentSection] !== undefined) {
      const trackHold = holdOverride[currentSection];
      const trackRemapped = progress <= trackHold
        ? 0
        : (progress - trackHold) / (1 - trackHold);
      trackT = ease(trackRemapped);
    }

    const bright = lerp(currentBright, nextBright, trackT);

    // ── Update SC filter frequency via OSC ──
    let freq = null;
    if (filter && freqRange) {
      freq = Math.round(brightnessToFreq(bright, freqRange));
      nodeSet(filter.nodeId, { freq });
    }

    let duck = brightnessToDuck(bright, duckFloor);
    let trackStatus = 'active';

    // ── Deferred fade-in override ──
    const fadeState = _fadeInState[name];
    if (deferredFadeIn && fadeState && fadeState.phase === 'silent') {
      const currentIdx = SECTION_ORDER[currentSection] ?? 0;
      const triggerIdx = SECTION_ORDER[fadeState.triggerSection] ?? 0;

      if (currentIdx > triggerIdx ||
          (currentIdx === triggerIdx && progress >= fadeState.triggerProgress)) {
        fadeState.phase = 'done';
        console.log(`[automation] ${name} FADE-IN triggered! nodeId:${duckGain.nodeId} gain:${duck.toFixed(3)} (section:${currentSection} progress:${progress.toFixed(3)} trigger:${fadeState.triggerSection}@${fadeState.triggerProgress.toFixed(3)})`);
        nodeSet(duckGain.nodeId, { gain: duck });
        trackStatus = 'fade-in';
        debugParts.push(`${name}(FADE-IN → duck:${duck.toFixed(2)})`);
        liveState[name] = { bright, freq, duck, status: trackStatus };
        continue;
      }

      nodeSet(duckGain.nodeId, { gain: 0 });
      trackStatus = 'silent';
      debugParts.push(`${name}(SILENT pre-fade)`);
      liveState[name] = { bright: 0, freq, duck: 0, status: trackStatus };
      continue;
    }

    // ── Gain swell override ──
    let swellActive = false;
    if (gainSwells) {
      if (!_swellState[name] || _swellState[name].section !== currentSection) {
        _planSwellsForSection(name, gainSwells, currentSection);
      }
      const swellGain = _getSwellGain(name, currentSection, progress);
      if (swellGain !== null) {
        duck = swellGain;
        swellActive = true;
        trackStatus = 'swell';
      }
    }

    // ── Send duck gain to SC via OSC ──
    nodeSet(duckGain.nodeId, { gain: duck });

    liveState[name] = { bright, freq, duck, status: trackStatus };

    const freqStr = freq !== null ? ` freq:${freq}Hz` : '';
    const swellStr = swellActive ? ' SWELL' : '';
    debugParts.push(`${name}(bright:${bright.toFixed(2)}${freqStr} duck:${duck.toFixed(2)}${swellStr})`);
  }

  _lastLiveState = { currentSection, nextSection, progress, tracks: liveState };

  console.log(
    `[section] ${currentSection} → ${nextSection} (${(progress * 100).toFixed(0)}%) | ${debugParts.join(' | ')}`
  );
}

/**
 * Returns the last computed automation snapshot for the UI.
 * @returns {{ currentSection, nextSection, progress, tracks: Object<string, { bright, freq, duck, status }> } | null}
 */
export function getAutomationState() {
  return _lastLiveState;
}

/**
 * Cleans up references.
 */
export function disposeSectionAutomation() {
  automatedTracks = {};
  _lastLiveState = null;
  for (const key of Object.keys(_brightCache)) delete _brightCache[key];
  for (const key of Object.keys(_fadeInState)) delete _fadeInState[key];
  for (const key of Object.keys(_swellState)) delete _swellState[key];
  _fadeInLastSection = null;
}
