/**
 * Distributes chord notes across octaves and humanizes timing.
 */

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/**
 * Parses a Tone.js note string into its components.
 * @param {string} note - e.g. "C#3"
 * @returns {{ name: string, octave: number }}
 */
function parseNote(note) {
  const match = note.match(/^([A-G]#?)(\d+)$/);
  if (!match) throw new Error(`Invalid note: ${note}`);
  return { name: match[1], octave: Number(match[2]) };
}

/**
 * Spreads chord notes across a configurable octave range and optionally
 * adds slight random timing offsets to simulate natural performance.
 *
 * @param {string[]} notes - Array of Tone.js note strings, e.g. ["C3", "E3", "G3"]
 * @param {number} [spread=2] - Number of octaves to distribute notes across
 * @param {boolean} [humanize=true] - Add random timing offsets (±30ms)
 * @returns {{ notes: string[], offsets: number[] }}
 *   notes: re-voiced note strings
 *   offsets: per-note timing offsets in seconds (0 if humanize is false)
 */
export function voiceChord(notes, spread = 2, humanize = true) {
  // Keep pad notes in the low-mid register (octaves 2–3) for warmth
  const MIN_OCTAVE = 3;
  const MAX_OCTAVE = 4;

  const voiced = notes.map((note, i) => {
    const { name, octave } = parseNote(note);
    // Distribute notes across the spread range
    const octaveShift = Math.floor((i / notes.length) * spread);
    const clampedOctave = Math.max(MIN_OCTAVE, Math.min(MAX_OCTAVE, octave + octaveShift));
    return `${name}${clampedOctave}`;
  });

  const offsets = voiced.map(() => {
    if (!humanize) return 0;
    // ±30ms random offset
    return (Math.random() - 0.5) * 0.06;
  });

  return { notes: voiced, offsets };
}
