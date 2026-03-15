/**
 * Declarative per-track profiles.
 *
 * Single source of truth for every track's gain, effect chain, and
 * section-based automation. Adding a new automated track means adding
 * an entry here — no other files need to change.
 *
 * ── Profile shape ──
 *
 *   gain   - Default track gain (0–1)
 *
 *   chain  - Ordered array of effect node specs.
 *            Each spec: { type, params, lfo?, id? }
 *
 *            type   — Tone.js class name: 'Filter', 'PingPongDelay',
 *                     'Reverb', 'Compressor', 'Gain'
 *            params — Constructor options passed to new Tone[type](params)
 *            lfo    — Optional: { frequency, min, max, type, target }
 *                     Creates a Tone.LFO connected to node[target]
 *            id     — Optional string tag so external code (automation)
 *                     can find this node by name
 *
 *            Empty chain [] = pass-through (single Gain(1), zero DSP).
 *
 *   automation - Optional section-based brightness control.
 *
 *            brightness — { [sectionName]: number(0–1) }
 *                         0 = fully muffled, 1 = fully bright
 *            freqRange  — { min, max } Hz for the dynamic lowpass cutoff
 *            duckFloor  — number(0–1), minimum duck gain at brightness 0
 *
 *            When present, the chain MUST include nodes tagged with
 *            id: 'dynamicFilter' (a lowpass Filter) and id: 'duckGain'
 *            (a Gain). sectionAutomation.js locates these by id.
 */

export const TRACK_PROFILES = {
  drone: {
    gain: 0.5,
    chain: [
      {
        id: 'ringMod',
        type: 'RingMod',
        params: { rate: 0.3, depth: 0.15 },
      },
      {
        id: 'duckGain',
        type: 'Gain',
        params: { gain: 0, lagTime: 4 },
      },
    ],
    automation: {
      brightness: {
        transition:      0,
        intro:           1.0,
        main:            1.0,
        innerTransition: 1.0,
        main2:           1.0,
        outro:           1.0,
      },
      duckFloor: 0,
      holdOverride: { outro: 0 },
      deferredFadeIn: {
        window: ['intro', 'main'],
        fadeDuration: 10,
      },
    },
  },

  archive: {
    gain: 0.05,
    chain: [
      {
        type: 'AGC',
        params: { targetAmp: 0.015, attack: 0.5, release: 3, maxGain: 6 },
      },
      {
        id: 'spectralSmear',
        type: 'SpectralSmear',
        params: { bins: 3, mix: 0.2 },
      },
      {
        id: 'duckGain',
        type: 'Gain',
        params: { gain: 1, lagTime: 4 },
      },
    ],
    automation: {
      brightness: {
        transition:      1.0,
        intro:           0.5,
        main:            0.0,
        innerTransition: 0.0,
        main2:           0.0,
        outro:           0.5,
      },
      duckFloor: 0.2,
    },
  },

  freesound: {
    gain: 0.1,
    chain: [
      {
        type: 'AGC',
        params: { targetAmp: 0.02, attack: 0.3, release: 2, maxGain: 10 },
      },
    ],
  },

  lead: {
    gain: 0.4,
    chain: [
      {
        id: 'tapeSat',
        type: 'TapeSat',
        params: { drive: 2.5, mix: 0.25 },
      },
      {
        id: 'vinylWobble',
        type: 'VinylWobble',
        params: { density: 0.12, depth: 0.004 },
      },
      {
        id: 'dynamicFilter',
        type: 'Filter',
        params: { type: 'lowpass', frequency: 18000, Q: 0.7, rolloff: -12, lagTime: 3 },
      },
      {
        id: 'lfoFilter',
        type: 'Filter',
        params: { type: 'lowpass', frequency: 3000, Q: 1.0, rolloff: -12 },
        lfo: { frequency: 0.04, min: 800, max: 6000, type: 'sine', target: 'frequency' },
      },
      {
        id: 'spectralFreeze',
        type: 'SpectralFreeze',
        params: { density: 0.04, minHold: 2, maxHold: 5, mix: 0.2 },
      },
      {
        id: 'spectralShift',
        type: 'SpectralShift',
        params: { stretch: 1.0, shift: 0, mix: 0.1 },
      },
      {
        id: 'compressor',
        type: 'Compressor',
        params: { threshold: -18, ratio: 3, attack: 0.005, release: 0.15 },
      },
      {
        type: 'PingPongDelay',
        params: { delayTime: '4n.', feedback: 0.35, wet: 0.25, maxDelay: 4 },
      },
      {
        type: 'Reverb',
        params: { decay: 6, wet: 0.45, preDelay: 0.1 },
      },
      {
        id: 'duckGain',
        type: 'Gain',
        params: { gain: 1, lagTime: 4 },
      },
    ],
    automation: {
      brightness: {
        transition:      0,
        intro:           0.55,
        main:            1.0,
        innerTransition: 0.1,
        main2:           1.0,
        outro:           0.4,
      },
      freqRange: { min: 350, max: 18000 },
      duckFloor: 0.12,
    },
  },

  bassSupport: {
    gain: 0.15,
    chain: [
      {
        id: 'duckGain',
        type: 'Gain',
        params: { gain: 0, lagTime: 4 },
      },
    ],
    automation: {
      brightness: {
        transition:      0,
        intro:           1.0,
        main:            1.0,
        innerTransition: 1.0,
        main2:           1.0,
        outro:           1.0,
      },
      duckFloor: 0,
      holdOverride: { outro: 0 },
      deferredFadeIn: {
        window: ['intro', 'main'],
        fadeDuration: 10,
      },
    },
  },

  pedalPad: {
    gain: 0.2,
    chain: [
      {
        id: 'tapeSat',
        type: 'TapeSat',
        params: { drive: 2.0, mix: 0.2 },
      },
      {
        id: 'ringMod',
        type: 'RingMod',
        params: { rate: 0.2, depth: 0.12 },
      },
      {
        id: 'vinylWobble',
        type: 'VinylWobble',
        params: { density: 0.2, depth: 0.008, decay: 3.0 },
      },
      {
        id: 'spectralFreeze',
        type: 'SpectralFreeze',
        params: { density: 0.05, minHold: 3, maxHold: 8, mix: 0.25 },
      },
    ],
  },

  sampleTexture: {
    gain: 0.05,
    chain: [
      {
        type: 'Filter',
        params: { frequency: 800, type: 'highpass', rolloff: -48 },
      },
      {
        id: 'dynamicFilter',
        type: 'Filter',
        params: { type: 'lowpass', frequency: 16000, Q: 0.7, rolloff: -12, lagTime: 3 },
      },
      {
        type: 'AGC',
        params: { targetAmp: 0.015, attack: 0.5, release: 3, maxGain: 6 },
      },
      {
        id: 'spectralSmear',
        type: 'SpectralSmear',
        params: { bins: 4, mix: 0.25 },
      },
      {
        id: 'spectralShift',
        type: 'SpectralShift',
        params: { stretch: 1.0, shift: 0, mix: 0.1 },
      },
      {
        type: 'SpectralFreeze',
        params: { density: 0.03, minHold: 4, maxHold: 10, mix: 0.35 },
      },
      {
        type: 'PingPongDelay',
        params: { delayTime: '2n.', feedback: 0.45, wet: 0.3, maxDelay: 6 },
      },
      {
        type: 'Reverb',
        params: { decay: 12, wet: 0.55, preDelay: 0.2 },
      },
      {
        id: 'duckGain',
        type: 'Gain',
        params: { gain: 1, lagTime: 4 },
      },
    ],
    automation: {
      brightness: {
        transition:      1.0,
        intro:           0.5,
        main:            0.05,
        innerTransition: 0.9,
        main2:           0.05,
        outro:           0.7,
      },
      freqRange: { min: 800, max: 16000 },
      duckFloor: 0.12,
    },
  },
};
