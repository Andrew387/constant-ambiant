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
  synths.drone.triggerAttackRelease(note, duration);
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
