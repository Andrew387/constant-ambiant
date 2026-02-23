/** Named scale definitions as semitone interval arrays from root. */

const scales = {
  chromatic: {
    name: 'Chromatic',
    intervals: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  },
  major: {
    name: 'Major (Ionian)',
    intervals: [0, 2, 4, 5, 7, 9, 11],
  },
  naturalMinor: {
    name: 'Natural Minor (Aeolian)',
    intervals: [0, 2, 3, 5, 7, 8, 10],
  },
  dorian: {
    name: 'Dorian',
    intervals: [0, 2, 3, 5, 7, 9, 10],
  },
  phrygian: {
    name: 'Phrygian',
    intervals: [0, 1, 3, 5, 7, 8, 10],
  },
  lydian: {
    name: 'Lydian',
    intervals: [0, 2, 4, 6, 7, 9, 11],
  },
  mixolydian: {
    name: 'Mixolydian',
    intervals: [0, 2, 4, 5, 7, 9, 10],
  },
  wholeTone: {
    name: 'Whole Tone',
    intervals: [0, 2, 4, 6, 8, 10],
  },
  pentatonicMajor: {
    name: 'Pentatonic Major',
    intervals: [0, 2, 4, 7, 9],
  },
  pentatonicMinor: {
    name: 'Pentatonic Minor',
    intervals: [0, 3, 5, 7, 10],
  },
  harmonicMinor: {
    name: 'Harmonic Minor',
    intervals: [0, 2, 3, 5, 7, 8, 11],
  },
  doubleHarmonic: {
    name: 'Double Harmonic',
    intervals: [0, 1, 4, 5, 7, 8, 11],
  },
};

export default scales;
