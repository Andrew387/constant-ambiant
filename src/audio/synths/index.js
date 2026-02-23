import { createPadSynth } from './pad.js';
import { createDroneSynth } from './drone.js';
import { createTextureSynth } from './texture.js';
import { createBellSynth } from './bell.js';

let pad = null;
let drone = null;
let texture = null;
let bell = null;

/**
 * Initializes all synths after a user gesture has started the audio context.
 * Each synth connects to the provided destination (effects chain input).
 *
 * @param {Tone.ToneAudioNode} destination - The effects chain input node
 * @returns {{ pad, drone, texture, bell }}
 */
export function initSynths(destination) {
  pad = createPadSynth(destination);
  drone = createDroneSynth(destination);
  texture = createTextureSynth(destination);
  bell = createBellSynth(destination);
  return { pad, drone, texture, bell };
}

export function getSynths() {
  return { pad, drone, texture, bell };
}

export function disposeSynths() {
  if (pad) { pad.dispose(); pad = null; }
  if (drone) { drone.dispose(); drone = null; }
  if (texture) { texture.dispose(); texture = null; }
  if (bell) { bell.dispose(); bell = null; }
}
