/**
 * Declarative mapping from trackProfile effect types to SC SynthDef names.
 *
 * Adding a new effect type = add an entry here. No other files need to change.
 * Each entry defines:
 *   - defName: SC SynthDef name
 *   - mapParams(spec): converts trackProfile spec → SC synth params
 *   - condition(spec): optional, picks this variant when true (e.g., highpass vs lowpass)
 *
 * When multiple entries share a type, the first whose condition returns true wins.
 */

const EFFECT_REGISTRY = [
  {
    type: 'Gain',
    defName: 'fxGain',
    mapParams(spec) {
      return { gain: spec.params?.gain ?? 1 };
    },
  },
  {
    type: 'Filter',
    condition: (spec) => spec.params?.type === 'highpass',
    defName: 'fxHPF',
    mapParams(spec) {
      return { freq: spec.params.frequency ?? 180 };
    },
  },
  {
    type: 'Filter',
    condition: (spec) => !!spec.lfo,
    defName: 'fxLPFLfo',
    mapParams(spec) {
      return {
        centerFreq: spec.params.frequency ?? 3000,
        lfoRate: spec.lfo.frequency ?? 0.04,
        lfoMin: spec.lfo.min ?? 800,
        lfoMax: spec.lfo.max ?? 6000,
        rq: 0.7,
      };
    },
  },
  {
    type: 'Filter',
    defName: 'fxLPF',
    mapParams(spec) {
      return { freq: spec.params.frequency ?? 18000 };
    },
  },
  {
    type: 'PingPongDelay',
    defName: 'fxPingPong',
    mapParams(spec) {
      let delayTime = spec.params.delayTime;
      if (typeof delayTime === 'string') {
        const beatSec = 60 / 56;
        if (delayTime === '4n.') delayTime = beatSec * 1.5;
        else if (delayTime === '2n.') delayTime = beatSec * 3;
        else if (delayTime === '4n') delayTime = beatSec;
        else delayTime = beatSec;
      }
      return {
        delayTime,
        feedback: spec.params.feedback ?? 0.35,
        wet: spec.params.wet ?? 0.25,
        maxDelay: spec.params.maxDelay ?? 6,
      };
    },
  },
  {
    type: 'Compressor',
    defName: 'fxCompressor',
    mapParams(spec) {
      return {
        thresh: spec.params.threshold ?? -24,
        ratio: spec.params.ratio ?? 4,
        atkTime: spec.params.attack ?? 0.01,
        relTime: spec.params.release ?? 0.3,
      };
    },
  },
  {
    type: 'Reverb',
    skip: true, // reverb is handled via sends, not in-place
  },
];

/**
 * Resolves a trackProfile effect spec to { defName, params } or null if skipped.
 *
 * @param {object} spec - Effect spec from TRACK_PROFILES chain
 * @returns {{ defName: string, params: object } | null}
 */
export function resolveEffect(spec) {
  for (const entry of EFFECT_REGISTRY) {
    if (entry.type !== spec.type) continue;
    if (entry.skip) return null;
    if (entry.condition && !entry.condition(spec)) continue;
    return { defName: entry.defName, params: entry.mapParams(spec) };
  }
  console.warn(`[effectRegistry] unsupported effect type: ${spec.type}`);
  return null;
}
