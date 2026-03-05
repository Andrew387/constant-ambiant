/**
 * Registry of available sample-based instruments.
 *
 * Each entry describes a sample set that can be loaded by samplePlayer.js.
 * All sets contain 72 samples (6 octaves × 12 semitones, C1–B6).
 * Samples are ~7.4 seconds long, giving ample room for smooth looping.
 *
 * folder      - Path relative to ./samples/
 * filePrefix  - Filename prefix before the 2-digit index number
 * plucked     - true → one-shot playback from start, false → loopable
 * loopStart   - (optional) Override loop start seconds — defaults to 3.0
 * loopEnd     - (optional) Override loop end seconds — defaults to 6.0
 */

export const LEAD_INSTRUMENTS = [
  { id: 'malechoirlong',    name: 'Male Choir',    folder: 'Lead/Loopable/malechoirlong',    filePrefix: 'malechoirlong',    plucked: false },
  { id: 'brushstringslong', name: 'Brush Strings', folder: 'Lead/Loopable/brushstringslong', filePrefix: 'brushstringslong', plucked: false },
  { id: 'analogbellslong',  name: 'Analog Bells',  folder: 'Lead/Loopable/analogbellslong',  filePrefix: 'analogbellslong',  plucked: false },
  { id: 'crystalbellslong', name: 'Crystal Bells', folder: 'Lead/Loopable/crystalbellslong', filePrefix: 'crystalbellslong', plucked: false },
  { id: 'calmbeachlong',    name: 'Calm Beach',    folder: 'Lead/Loopable/calmbeachlong',    filePrefix: 'calmbeachlong',    plucked: false },
  { id: 'silkystringslong', name: 'Silky Strings', folder: 'Lead/Loopable/silkystringslong', filePrefix: 'silkystringslong', plucked: false },
  { id: 'distantBell',      name: 'Distant Bells', folder: 'Lead/Plucked/distant bells',     filePrefix: 'distantBell',      plucked: true },
];

export const PAD_INSTRUMENTS = [
  { id: 'analogWaves', name: 'Analog Waves', folder: 'pad/loopable/analogWaves', filePrefix: 'analogWaves', plucked: false },
];

export const DEFAULT_PAD_SAMPLE = 'analogWaves';

export const BASS_INSTRUMENTS = [
  { id: 'bloomingbasslong', name: 'Blooming Bass', folder: 'Bass/Loopable/bloomingbasslong', filePrefix: 'bloomingbasslong', plucked: false },
  { id: 'basskeylong',      name: 'Bass Keys',     folder: 'Bass/Plucked/basskeylong',       filePrefix: 'basskeylong',      plucked: true },
  { id: 'jazzSessBass',     name: 'Jazz Bass',     folder: 'Bass/Plucked/jazzSessBass',      filePrefix: 'JazzSessBass',     plucked: true },
];

export const DEFAULT_LEAD = 'malechoirlong';
export const DEFAULT_BASS = 'bloomingbasslong';
