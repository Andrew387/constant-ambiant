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
 * @param {object} synths - Object with pad, drone, texture, bell synths
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
 * Plays a chord on the choir sampler, identical to pad behavior.
 *
 * @param {object} synths - Object with choir synth
 * @param {string[]} notes - Array of note strings to play
 * @param {number[]} offsets - Per-note timing offsets in seconds (humanization)
 * @param {number} time - Audio-context time from Transport callback
 */
export function triggerChoirChord(synths, notes, offsets, time) {
  if (!synths.choir) {
    return;
  }
  const maxOffset = Math.max(0, ...offsets.map(o => Math.abs(o)));
  const t = time + maxOffset;
  // Sample instruments play one octave below the pad voicing
  const lowered = notes.map(dropOctave);
  synths.choir.playChord(lowered, t);
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
 * Triggers a texture burst.
 *
 * @param {object} synths
 * @param {number} duration - Duration in seconds
 * @param {number} time - Audio-context time from Transport callback
 */
export function triggerTexture(synths, duration, time) {
  if (!synths.texture) {
    console.warn('[scheduler] texture synth not available — skipping');
    return;
  }
  synths.texture.triggerAttackRelease(duration, time);
}

/**
 * Converts a Tone.js note string to a MIDI-like number for sorting.
 * @param {string} note - e.g. "C#4"
 * @returns {number}
 */
const NOTE_SEMITONES = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
function noteToMidi(note) {
  const match = note.match(/^([A-G])(#?)(\d+)$/);
  if (!match) return 0;
  const base = NOTE_SEMITONES[match[1]];
  const sharp = match[2] === '#' ? 1 : 0;
  const octave = Number(match[3]);
  return octave * 12 + base + sharp;
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

/**
 * Schedules exactly 4 bell notes across the chord duration, one per quarter.
 * Takes the highest notes of the chord, drops them an octave, and cycles
 * through them in descending pitch order.
 *
 * @param {object} synths - Object with bell synth
 * @param {string[]} chordNotes - All voiced chord notes
 * @param {number} chordDuration - Total chord duration in seconds
 * @param {number} time - Audio-context start time from Transport callback
 */
export function triggerBell(synths, chordNotes, chordDuration, time) {
  if (!synths.bell) {
    console.warn('[scheduler] bell synth not available — skipping');
    return;
  }
  if (chordNotes.length < 2) {
    return;
  }

  // Sort notes by pitch (high to low) and take the highest 4
  const sorted = [...chordNotes].sort((a, b) => noteToMidi(b) - noteToMidi(a));
  const topNotes = sorted.slice(0, Math.min(4, sorted.length));

  // Drop an octave for a warmer, lower bell tone
  const lowered = topNotes.map(dropOctave);

  // Scale bell hits to chord duration — short chords get fewer hits
  // to avoid polyphony overflow from overlapping release tails.
  // Skip bell entirely for very short chords (≤ 3s).
  if (chordDuration <= 3) return;

  const hitCount = chordDuration < 5 ? 2 : 4;
  const hitSpacing = chordDuration / hitCount;
  const noteDuration = Math.min(chordDuration * 0.6, 6);

  const bellNotes = [];
  for (let i = 0; i < hitCount; i++) {
    bellNotes.push(lowered[i % lowered.length]);
  }

  for (let i = 0; i < hitCount; i++) {
    const noteTime = time + i * hitSpacing;
    synths.bell.triggerNote(bellNotes[i], noteDuration, noteTime);
  }
}
