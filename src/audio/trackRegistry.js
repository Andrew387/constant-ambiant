/**
 * Track Registry — single source of truth for track wiring.
 *
 * Every track's bus, reverb routing, and send levels are defined here.
 * The individual maps (TRACK_BUS_MAP, TRACK_REVERB_MAP, etc.) are
 * derived automatically — no need to keep multiple files in sync.
 *
 * To add a new track:
 *   1. Add an entry to TRACK_WIRING below
 *   2. Add the bus constant to src/sc/nodeIds.js (BUSES)
 *   3. Add the track's profile to src/audio/trackProfiles.js
 *   4. Wire up the synth in mixer.js
 *
 * That's it — effect chains, reverb sends, and sectionAutomation
 * all derive from this registry + trackProfiles.
 */

import { BUSES } from '../sc/nodeIds.js';

/**
 * Per-track wiring configuration.
 *
 * @type {Object<string, { bus: number, reverbBus: number, reverbSend: number, dryGain?: number }>}
 */
const TRACK_WIRING = {
  drone:         { bus: BUSES.DRONE,         reverbBus: BUSES.REVERB_LONG,  reverbSend: 0.15 },
  lead:          { bus: BUSES.LEAD,          reverbBus: BUSES.REVERB_SHORT, reverbSend: 0.45 },
  sampleTexture: { bus: BUSES.TEXTURE,       reverbBus: BUSES.REVERB_LONG,  reverbSend: 0.30, dryGain: 0.1 },
  archive:       { bus: BUSES.ARCHIVE,       reverbBus: BUSES.REVERB_LONG,  reverbSend: 0.20 },
  freesound:     { bus: BUSES.FREESOUND,     reverbBus: BUSES.REVERB_LONG,  reverbSend: 0.0 },
  pedalPad:      { bus: BUSES.PEDAL_PAD,     reverbBus: BUSES.REVERB_LONG,  reverbSend: 0.30 },
  bassSupport:   { bus: BUSES.BASS_SUPPORT,  reverbBus: BUSES.REVERB_LONG,  reverbSend: 0.20 },
  leadReversed:  { bus: BUSES.LEAD_REVERSED, reverbBus: BUSES.REVERB_LONG,  reverbSend: 0.50 },
};

// ── Derived maps (used by trackEffects.js, mixer.js, effectRegistry.js) ──

/** Track name → SC audio bus number. */
export const TRACK_BUS_MAP = Object.fromEntries(
  Object.entries(TRACK_WIRING).map(([name, w]) => [name, w.bus])
);

/** Track name → reverb bus (short or long). */
export const TRACK_REVERB_MAP = Object.fromEntries(
  Object.entries(TRACK_WIRING).map(([name, w]) => [name, w.reverbBus])
);

/** Track name → reverb send level (0–1). */
export const REVERB_SEND_LEVELS = Object.fromEntries(
  Object.entries(TRACK_WIRING).map(([name, w]) => [name, w.reverbSend])
);

/** Track name → dry output gain (defaults to 1 if not specified). */
export const TRACK_DRY_GAIN = Object.fromEntries(
  Object.entries(TRACK_WIRING)
    .filter(([, w]) => w.dryGain !== undefined)
    .map(([name, w]) => [name, w.dryGain])
);

export { TRACK_WIRING };
