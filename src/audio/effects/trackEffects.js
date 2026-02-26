import * as Tone from 'tone';
import { TRACK_PROFILES } from '../trackProfiles.js';

/**
 * Generic effect chain builder.
 *
 * Takes an ordered array of effect specs from a track profile and builds
 * a connected Tone.js signal chain. Empty specs produce a zero-overhead
 * pass-through (single Gain node).
 *
 * @param {Array} chainSpec - Array of { type, params, lfo?, id? }
 * @returns {{ input, output, refs, lfos, dispose }}
 *   input  — First node (connect your source here)
 *   output — Last node (connect this to masterGain)
 *   refs   — Map of id-tagged nodes for external access
 *   lfos   — Array of running LFO instances
 *   dispose — Cleans up all created nodes and LFOs
 */
export function buildEffectGroup(chainSpec) {
  if (!chainSpec || chainSpec.length === 0) {
    const passthrough = new Tone.Gain(1);
    return {
      input: passthrough,
      output: passthrough,
      refs: {},
      lfos: [],
      dispose() { passthrough.dispose(); },
    };
  }

  const nodes = [];
  const refs = {};
  const lfos = [];

  for (const spec of chainSpec) {
    const NodeClass = Tone[spec.type];
    if (!NodeClass) {
      console.warn(`[trackEffects] unknown Tone type: ${spec.type}`);
      continue;
    }

    const node = new NodeClass(spec.params);
    nodes.push(node);

    if (spec.id) {
      refs[spec.id] = node;
    }

    // Attach LFO if specified
    if (spec.lfo) {
      const { target, ...lfoParams } = spec.lfo;
      const lfo = new Tone.LFO(lfoParams);
      // Resolve target param (e.g. 'frequency' → node.frequency)
      const targetParam = target.split('.').reduce((obj, key) => obj[key], node);
      lfo.connect(targetParam);
      lfo.start();
      lfos.push(lfo);
    }
  }

  // Chain: node[0] → node[1] → … → node[N-1]
  for (let i = 0; i < nodes.length - 1; i++) {
    nodes[i].connect(nodes[i + 1]);
  }

  return {
    input: nodes[0],
    output: nodes[nodes.length - 1],
    refs,
    lfos,
    dispose() {
      lfos.forEach(l => { l.stop(); l.dispose(); });
      nodes.forEach(n => n.dispose());
    },
  };
}

/**
 * Creates all per-track effect groups from TRACK_PROFILES.
 *
 * @returns {Object<string, { input, output, refs, lfos, dispose }>}
 */
export function createAllTrackEffects() {
  const effects = {};
  for (const [name, profile] of Object.entries(TRACK_PROFILES)) {
    effects[name] = buildEffectGroup(profile.chain);
  }
  return effects;
}
