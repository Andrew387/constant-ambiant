/**
 * Registry of available sample-based instruments.
 *
 * Each entry describes a sample set that can be loaded by samplePlayer.js.
 * Samples use note-name filenames: {prefix}_{Note}.wav (e.g. malechoirlong_C2.wav)
 * Sharp notes use 's': Cs = C#, Ds = D#, Fs = F#, Gs = G#, As = A#
 *
 * folder       - Path relative to ./samples/
 * filePrefix   - Filename prefix before the _Note suffix
 * plucked      - true → one-shot playback from start, false → loopable
 * startOctave  - First octave in the sample set
 * endOctave    - Last octave in the sample set
 * loopStart    - (optional) Override loop start seconds — defaults to 0.8
 * loopEnd      - (optional) Override loop end seconds — defaults to 6.0
 */

// Lead instruments: octaves 2–4 (voiced octaves 3–5 dropped by scheduler)
export const LEAD_INSTRUMENTS = [
  { id: 'sine',             name: 'Sine',          type: 'sine',                                                                                       plucked: false },
  { id: 'malechoirlong',    name: 'Male Choir',    folder: 'Lead/Loopable/malechoirlong',    filePrefix: 'malechoirlong',    startOctave: 2, endOctave: 4, plucked: false },
  { id: 'brushstringslong', name: 'Brush Strings', folder: 'Lead/Loopable/brushstringslong', filePrefix: 'brushstringslong', startOctave: 2, endOctave: 4, plucked: false, gain: 0.7 },
  { id: 'analogbellslong',  name: 'Analog Bells',  folder: 'Lead/Loopable/analogbellslong',  filePrefix: 'analogbellslong',  startOctave: 2, endOctave: 4, plucked: false },
  { id: 'crystalbellslong', name: 'Crystal Bells', folder: 'Lead/Loopable/crystalbellslong', filePrefix: 'crystalbellslong', startOctave: 2, endOctave: 4, plucked: false, gain: 0.7 },
  { id: 'calmbeachlong',    name: 'Calm Beach',    folder: 'Lead/Loopable/calmbeachlong',    filePrefix: 'calmbeachlong',    startOctave: 2, endOctave: 4, plucked: false, gain: 0.7 },
  { id: 'silkystringslong', name: 'Silky Strings', folder: 'Lead/Loopable/silkystringslong', filePrefix: 'silkystringslong', startOctave: 2, endOctave: 4, plucked: false, gain: 0.7 },
  { id: 'DataStreamPad',    name: 'Data Stream',   folder: 'Lead/Loopable/DataStreamPad',    filePrefix: 'DataStreamPad',    startOctave: 2, endOctave: 4, plucked: false },
  { id: 'arcticBreeze',     name: 'Arctic Breeze', folder: 'Lead/Loopable/arctic breeze L-L', filePrefix: 'Arctic Breeze L-L', startOctave: 2, endOctave: 4, plucked: false },
  { id: 'deterioration',    name: 'Deterioration',    folder: 'Lead/Loopable/Deterioration L-L',    filePrefix: 'Deterioration L-L',    startOctave: 2, endOctave: 4, plucked: false },
  { id: 'distantDrift',     name: 'Distant Drift',    folder: 'Lead/Loopable/distant drift L-L',    filePrefix: 'Distant drift L-L',    startOctave: 2, endOctave: 4, plucked: false },
  { id: 'dystopian',        name: 'Dystopian',        folder: 'Lead/Loopable/dystopian L-L',        filePrefix: 'Dystopian L-L',        startOctave: 2, endOctave: 4, plucked: false },
  { id: 'glassSky',         name: 'Glass Sky',        folder: 'Lead/Loopable/glass sky L-L ',       filePrefix: 'Glass sky L-L',        startOctave: 2, endOctave: 4, plucked: false },
  { id: 'pipeAmbiance',     name: 'Pipe Ambiance',    folder: 'Lead/Loopable/pipe ambiance L-L',    filePrefix: 'Pipe ambiance L-L',    startOctave: 2, endOctave: 4, plucked: false },
  { id: 'rockHarpsichord',  name: 'Rock Harpsichord', folder: 'Bass-Lead/Plucked/rock harpsichord B:L-P', filePrefix: 'rockharpsichord B:L-P', startOctave: 2, endOctave: 4, plucked: true },
];

// Pad instruments: octaves 1–3 (bassSupport at oct 1, pedalPad at oct 3)
export const PAD_INSTRUMENTS = [
  { id: 'analogWaves',     name: 'Analog Waves',      folder: 'pad/loopable/analogWaves',      filePrefix: 'analogWaves',     startOctave: 1, endOctave: 3, plucked: false },
  { id: 'aquticVoices',    name: 'Aqutic Voices',     folder: 'pad/loopable/aqutic voices',    filePrefix: 'aquticVoices',    startOctave: 1, endOctave: 3, plucked: false },
  { id: 'autumnHaze',      name: 'Autumn Haze',       folder: 'pad/loopable/autumnHaze',       filePrefix: 'AutumnHaze',      startOctave: 1, endOctave: 3, plucked: false },
  { id: 'beyondDeepSkies', name: 'Beyond Deep Skies', folder: 'pad/loopable/beyondDeepSkies',  filePrefix: 'BeyondDeepSkies', startOctave: 1, endOctave: 3, plucked: false },
];

export const DEFAULT_PAD_SAMPLE = 'analogWaves';

// Bass instruments: octave 2 only (drone always at octave 2)
export const BASS_INSTRUMENTS = [
  { id: 'bloomingbasslong', name: 'Blooming Bass',   folder: 'Bass/Loopable/bloomingbasslong', filePrefix: 'bloomingbasslong',    startOctave: 2, endOctave: 2, plucked: false },
  { id: 'bytebass',         name: 'Byte Bass',       folder: 'Bass/Loopable/bytebass',         filePrefix: 'bytebass',            startOctave: 2, endOctave: 2, plucked: false, gain: 0.7 },
  { id: 'darkglidebass',    name: 'Dark Glide Bass', folder: 'Bass/Loopable/darkglidebass',       filePrefix: 'darkglidebass',          startOctave: 2, endOctave: 2, plucked: false },
  { id: 'bigWide',          name: 'Big Wide',        folder: 'Bass/Loopable/big wide B-L',       filePrefix: 'Big wide B-L',           startOctave: 2, endOctave: 2, plucked: false },
  { id: 'cloudBass',        name: 'Cloud Bass',      folder: 'Bass/Loopable/cloud bass B-L',     filePrefix: 'Cloud Bass B-L',         startOctave: 2, endOctave: 2, plucked: false, gain: 0.5 },
  { id: 'darGlideBass',     name: 'Dar Glide Bass',  folder: 'Bass/Loopable/dar glide bass B-L', filePrefix: 'Dark glide bass B-L',    startOctave: 2, endOctave: 2, plucked: false },
  { id: 'darkImpact',       name: 'Dark Impact',     folder: 'Bass/Loopable/dark impact B-L',    filePrefix: 'dark impact B-L',        startOctave: 2, endOctave: 2, plucked: false },
  { id: 'basskeylong',      name: 'Bass Keys',       folder: 'Bass/Plucked/basskeylong',         filePrefix: 'basskeylong',            startOctave: 2, endOctave: 2, plucked: true },
  { id: 'heavyHandedbass',  name: 'Heavy Handed',    folder: 'Bass/Plucked/heavyHandedbass',   filePrefix: 'heavyhandedbass',     startOctave: 2, endOctave: 2, plucked: true, gain: 0.5 },
  { id: 'jazzSessBass',     name: 'Jazz Bass',       folder: 'Bass/Plucked/jazzSessBass',      filePrefix: 'JazzSessBass',        startOctave: 2, endOctave: 2, plucked: true },
  { id: 'weightedPluck',    name: 'Weighted Pluck',  folder: 'Bass/Plucked/weighted pluck',    filePrefix: 'wieghted pluck B-P',  startOctave: 2, endOctave: 2, plucked: true },
];

// Bass-Lead instruments: octaves 2–4 (usable in both bass and lead slots)
export const BASS_LEAD_INSTRUMENTS = [
  { id: 'calmAndStorm',       name: 'Calm and Storm',       folder: 'Bass-Lead/Loopable/calm and storm B:L-L',            filePrefix: 'Calm and Storm B:L-L',   startOctave: 2, endOctave: 4, plucked: false },
  { id: 'easternHammers',     name: 'Eastern Hammers',      folder: 'Bass-Lead/Plucked/eastern hammers bass:lead plucked', filePrefix: 'easternhammer B:L-P',    startOctave: 2, endOctave: 4, plucked: true },
  { id: 'metallicEchoTines',  name: 'Metallic Echo Tines',  folder: 'Bass-Lead/Plucked/metallic echo tines B:L-P',        filePrefix: 'metalicechotines B:L-P', startOctave: 2, endOctave: 4, plucked: true },
  { id: 'mutantAcousticBass', name: 'Mutant Acoustic Bass', folder: 'Bass-Lead/Plucked/mutantacousticbass',               filePrefix: 'mutantacousticbass',     startOctave: 2, endOctave: 4, plucked: true },
];

export const DEFAULT_LEAD = 'malechoirlong';
export const DEFAULT_BASS = 'bloomingbasslong';
