/**
 * Triggers note events by sending OSC messages to SuperCollider.
 *
 * Replaces the Tone.js-based scheduler. Instead of calling synth methods
 * directly, we call the pad/lead/drone wrapper objects which send OSC
 * messages to scsynth.
 *
 * TIMING: In the SC architecture, setTimeout drives chord scheduling
 * from Node.js. Individual note humanization offsets (±30ms) are
 * applied via setTimeout delays within this module. At 7+ second
 * chord intervals, this jitter is completely inaudible.
 */

/**
 * Plays a chord on the lead sampler.
 *
 * @param {object} synths - Object with lead synth
 * @param {{ simultaneous: string[], sequential: { note: string, timeOffset: number }[] }} schedule
 * @param {number[]} offsets - Per-note timing offsets in seconds (humanization)
 */
export function triggerLeadChord(synths, schedule, offsets) {
  if (!synths.lead) return;

  // Sample instruments play one octave below the pad voicing
  const loweredSim = schedule.simultaneous.map(dropOctave);
  synths.lead.playChord(loweredSim);

  for (const { note, timeOffset } of schedule.sequential) {
    const lowered = dropOctave(note);
    if (timeOffset <= 0) {
      synths.lead.addNotes([lowered]);
    } else {
      setTimeout(() => {
        synths.lead?.addNotes([lowered]);
      }, timeOffset * 1000);
    }
  }
}

/**
 * Triggers a drone note.
 *
 * @param {object} synths
 * @param {string} note - Root note for the drone
 * @param {number} duration - Duration in seconds
 */
export function triggerDrone(synths, note, duration) {
  if (!synths.drone) {
    console.warn('[scheduler] drone synth not available — skipping');
    return;
  }
  console.log(`[scheduler] triggerDrone → ${note} (${duration.toFixed(1)}s)${synths.drone2 ? ' [dual]' : ''}`);
  synths.drone.triggerAttackRelease(note, duration);
  // Dual plucked bass: trigger second instrument simultaneously
  if (synths.drone2) {
    synths.drone2.triggerAttackRelease(note, duration);
  }
}

/**
 * Plays a chord on the lead reversed sampler.
 * All notes play simultaneously (pad-like behavior).
 * Notes are shifted down to fit the pad instrument range (octaves 1–3).
 *
 * @param {object} synths - Object with leadReversed synth
 * @param {string[]} voicedNotes - Chord notes to play
 */
export function triggerLeadReversed(synths, voicedNotes) {
  if (!synths.leadReversed) return;
  const notes = voicedNotes.map(toPadOctave);
  synths.leadReversed.playChord(notes);
}

/**
 * Shifts a note into the leadReversed instrument range (octaves 2–3).
 * Drops 1 octave from the lead voicing and clamps to [2, 3].
 * Range 2–3 is the overlap supported by all loopable instrument pools.
 * @param {string} note - e.g. "C#5"
 * @returns {string} e.g. "C#3"
 */
function toPadOctave(note) {
  const match = note.match(/^([A-G]#?)(\d+)$/);
  if (!match) return note;
  const oct = Math.max(2, Math.min(3, Number(match[2]) - 1));
  return `${match[1]}${oct}`;
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
