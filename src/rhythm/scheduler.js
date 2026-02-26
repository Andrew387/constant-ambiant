/**
 * Triggers note events using audio-context time.
 *
 * TIMING CONTRACT:
 *   Every `time` parameter in this module is AUDIO-CONTEXT time provided by
 *   Tone.Transport callbacks. These times come from Tone.js's lookahead system
 *   and may appear "in the past" relative to Tone.now() when the JS callback
 *   executes — this is NORMAL. The Web Audio API schedules them on the audio
 *   thread at sample-accurate precision. Do NOT clamp or adjust these times.
 *
 *   The ruleEngine is responsible for passing the correct audio-context time
 *   it receives from Transport callbacks. This module never touches Transport time.
 */

/**
 * Plays a chord on the pad synth, releasing any previous chord.
 * Uses playChord (attack/release) for seamless crossfade.
 *
 * @param {object} synths - Object with pad, drone synths
 * @param {string[]} notes - Array of note strings to play
 * @param {number[]} offsets - Per-note timing offsets in seconds (humanization)
 * @param {number} time - Audio-context time from Transport callback
 */
export function triggerPadChord(synths, notes, offsets, time) {
  if (!synths.pad) {
    console.warn('[scheduler] pad synth not available — skipping');
    return;
  }
  // Apply the largest humanization offset to the whole chord
  // (individual note staggering within a pad chord creates phasing artifacts
  //  when using attack/release — better to offset the whole chord slightly)
  const maxOffset = Math.max(0, ...offsets.map(o => Math.abs(o)));
  const t = time + maxOffset;
  synths.pad.playChord(notes, t);
}

/**
 * Plays a chord on the lead sampler, identical to pad behavior.
 *
 * @param {object} synths - Object with lead synth
 * @param {string[]} notes - Array of note strings to play
 * @param {number[]} offsets - Per-note timing offsets in seconds (humanization)
 * @param {number} time - Audio-context time from Transport callback
 */
export function triggerLeadChord(synths, notes, offsets, time) {
  if (!synths.lead) {
    return;
  }
  const maxOffset = Math.max(0, ...offsets.map(o => Math.abs(o)));
  const t = time + maxOffset;
  // Sample instruments play one octave below the pad voicing
  const lowered = notes.map(dropOctave);
  synths.lead.playChord(lowered, t);
}

/**
 * Triggers a drone note.
 *
 * @param {object} synths
 * @param {string} note - Root note for the drone
 * @param {number} duration - Duration in seconds
 * @param {number} time - Audio-context time from Transport callback
 */
export function triggerDrone(synths, note, duration, time) {
  if (!synths.drone) {
    console.warn('[scheduler] drone synth not available — skipping');
    return;
  }
  synths.drone.triggerAttackRelease(note, duration, time);
}

/**
 * Drops a note down by one octave.
 * @param {string} note - e.g. "C#5"
 * @returns {string} e.g. "C#4"
 */
function dropOctave(note) {
  const match = note.match(/^([A-G]#?)(\d+)$/);
  if (!match) return note;
  return `${match[1]}${Math.max(1, Number(match[2]) - 1)}`;
}
