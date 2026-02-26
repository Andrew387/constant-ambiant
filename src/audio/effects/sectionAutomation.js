import { TRACK_PROFILES } from '../trackProfiles.js';

/**
 * Section automation module.
 *
 * Generalizes brightness-based filter + duck gain automation to any
 * number of tracks. Reads automation config from TRACK_PROFILES and
 * operates on node references discovered during init.
 *
 * Each automated track has:
 *   - A dynamic lowpass filter (cutoff mapped from brightness)
 *   - A duck gain (volume reduction mapped from brightness)
 *   - Per-section brightness targets (0 = muffled, 1 = bright)
 *   - Exponential frequency mapping with per-transition randomness
 *   - S-curve interpolation across section boundaries
 */

// ── Per-transition brightness randomness ──
// Randomize brightness endpoints once per section transition (not per tick).
// This means e.g. "transition → intro" might target brightness 0.45 instead
// of 0.50, but that value stays fixed for the entire transition and the
// interpolation is perfectly smooth.
const BRIGHTNESS_JITTER = 0.10;  // ±10% range on each endpoint

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

// ── Hold thresholds ──
// Fraction of a section's duration to hold at the current brightness
// before starting to blend toward the next section.
// 0 = start blending immediately, 0.8 = hold for 80% then blend in the last 20%.
const HOLD_UNTIL = {
  transition:      0,
  intro:           0.5,
  main:            0.8,
  innerTransition: 0,
  main2:           0.8,
  outro:           0.4,
};

// ── Per-track automation state ──
// Map<string, { filter, duckGain, config }> populated by init
let automatedTracks = {};

// ── Deferred fade-in state ──
// For tracks with deferredFadeIn config, the drone stays silent from the
// start of each cycle until a random trigger point within the configured
// window sections, then fades in over fadeDuration.

const SECTION_ORDER = {
  transition: 0, intro: 1, main: 2, innerTransition: 3, main2: 4, outro: 5,
};

// Cache: track → { triggerSection, triggerProgress, phase }
// phase: 'silent' | 'done'
const _fadeInState = {};
let _fadeInLastSection = null;

function _resetFadeIn(trackName, fadeConfig) {
  const { window: sections, fadeDuration } = fadeConfig;
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

/**
 * Resets deferred fade-in state for all applicable tracks when entering
 * a new cycle (transition section). Called once per section boundary.
 */
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

// ── Helpers ──

/**
 * Smooth S-curve easing so most of the change happens in the middle
 * of the section, not abruptly at the boundary.
 */
function ease(t) {
  return (1 - Math.cos(t * Math.PI)) / 2;
}

/**
 * Linearly interpolates between two values.
 */
function lerp(a, b, t) {
  return a + (b - a) * t;
}

/**
 * Maps 0–1 brightness to frequency using exponential interpolation.
 */
function brightnessToFreq(brightness, range) {
  const logMin = Math.log(range.min);
  const logMax = Math.log(range.max);
  return Math.exp(logMin + brightness * (logMax - logMin));
}

/**
 * Maps 0–1 brightness to duck multiplier (duckFloor–1.0).
 * brightness 1.0 → 1.0 (no ducking), brightness 0.0 → duckFloor.
 */
function brightnessToDuck(brightness, duckFloor) {
  return duckFloor + brightness * (1.0 - duckFloor);
}

// ── Public API ──

/**
 * Registers automated tracks by scanning profiles for automation config
 * and matching tagged node references from the built effect groups.
 *
 * @param {Object<string, { refs }>} allTrackEffects
 *   Result of createAllTrackEffects(), keyed by track name.
 *   Each entry's `refs` map must contain 'dynamicFilter' and 'duckGain'
 *   for tracks whose profile has an automation block.
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
      console.warn(
        `[automation] profile "${name}" missing duckGain ref`
      );
      continue;
    }

    automatedTracks[name] = { filter, duckGain, config: profile.automation };
  }

  const names = Object.keys(automatedTracks);
  console.log(`[automation] initialized ${names.length} tracks: ${names.join(', ')}`);
}

/**
 * Updates all automated tracks based on current section, next section,
 * and progress. Called once per chord event from ruleEngine.
 *
 * Interpolates between the current section's brightness and the next
 * section's brightness using S-curve easing, then maps to filter cutoff
 * and duck gain. Brightness endpoints are randomized ±10% once per
 * section transition for variety, then held fixed for smooth interpolation.
 *
 * @param {string} currentSection - e.g. 'main'
 * @param {string} nextSection    - e.g. 'innerTransition'
 * @param {number} progress       - 0–1 through current section
 * @param {number} [rampTime=6]   - Seconds to ramp to new values
 */
export function updateSectionAutomation(currentSection, nextSection, progress, rampTime = 6) {
  // Reset deferred fade-ins at cycle boundaries
  _maybeResetFadeIns(currentSection);

  // Remap progress: hold at 0 until the hold threshold, then compress
  // the remaining range into 0–1 so the S-curve only runs at the tail end.
  const holdUntil = HOLD_UNTIL[currentSection] ?? 0;
  const remapped = progress <= holdUntil
    ? 0
    : (progress - holdUntil) / (1 - holdUntil);
  const t = ease(remapped);

  const debugParts = [];

  for (const [name, { filter, duckGain, config }] of Object.entries(automatedTracks)) {
    const { brightness, freqRange, duckFloor, deferredFadeIn, holdOverride } = config;

    const baseCurrent = brightness[currentSection] ?? 0.5;
    const baseNext    = brightness[nextSection]    ?? 0.5;
    const { currentBright, nextBright } = _getCachedBrightness(
      name, baseCurrent, baseNext, currentSection, nextSection
    );

    // Per-track hold override: recalculate t if this track overrides the
    // global hold threshold for the current section.
    let trackT = t;
    if (holdOverride && holdOverride[currentSection] !== undefined) {
      const trackHold = holdOverride[currentSection];
      const trackRemapped = progress <= trackHold
        ? 0
        : (progress - trackHold) / (1 - trackHold);
      trackT = ease(trackRemapped);
    }

    const bright = lerp(currentBright, nextBright, trackT);

    if (filter) {
      const freq = brightnessToFreq(bright, freqRange);
      filter.frequency.rampTo(freq, rampTime);
    }

    const duck = brightnessToDuck(bright, duckFloor);

    // ── Deferred fade-in override ──
    const fadeState = _fadeInState[name];
    if (deferredFadeIn && fadeState && fadeState.phase === 'silent') {
      const currentIdx = SECTION_ORDER[currentSection] ?? 0;
      const triggerIdx = SECTION_ORDER[fadeState.triggerSection] ?? 0;

      if (currentIdx > triggerIdx ||
          (currentIdx === triggerIdx && progress >= fadeState.triggerProgress)) {
        // Trigger point reached — fade in
        fadeState.phase = 'done';
        duckGain.gain.rampTo(duck, deferredFadeIn.fadeDuration);
        debugParts.push(`${name}(FADE-IN → duck:${duck.toFixed(2)} over ${deferredFadeIn.fadeDuration}s)`);
        continue;
      }

      // Still before trigger — stay silent
      duckGain.gain.rampTo(0, rampTime);
      debugParts.push(`${name}(SILENT pre-fade)`);
      continue;
    }

    duckGain.gain.rampTo(duck, rampTime);

    const freqStr = filter ? ` freq:${Math.round(brightnessToFreq(bright, freqRange))}Hz` : '';
    debugParts.push(`${name}(bright:${bright.toFixed(2)}${freqStr} duck:${duck.toFixed(2)})`);
  }

  console.log(
    `[section] ${currentSection} → ${nextSection} (${(progress * 100).toFixed(0)}%) | ${debugParts.join(' | ')}`
  );
}

/**
 * Cleans up references.
 */
export function disposeSectionAutomation() {
  automatedTracks = {};
  for (const key of Object.keys(_brightCache)) {
    delete _brightCache[key];
  }
  for (const key of Object.keys(_fadeInState)) {
    delete _fadeInState[key];
  }
  _fadeInLastSection = null;
}
