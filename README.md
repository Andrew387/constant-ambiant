# Constant Ambient

A generative ambient music web application built with Tone.js. Runs entirely in the browser — no server required.

## Getting Started

```bash
npm install
npm run dev
```

Open the URL shown in the terminal (usually `http://localhost:5173`). Click **Start** to begin generating ambient music.

## Build for Production

```bash
npm run build
npm run preview
```

## Folder Structure

```
src/
├── audio/
│   ├── synths/
│   │   ├── pad.js          # Detuned polyphonic pad (triangle + sine, slow attack/release)
│   │   ├── drone.js        # MonoSynth sub-bass drone with heavy LP filter
│   │   ├── texture.js      # NoiseSynth with bandpass filter + LFO for shimmer
│   │   └── index.js        # Exports all synths; initializes after user gesture
│   ├── effects/
│   │   ├── reverb.js       # Tone.Reverb, 14s decay, pre-delay
│   │   ├── delay.js        # PingPongDelay, tempo-synced dotted quarter
│   │   ├── filter.js       # LFO-modulated lowpass filter (40s sweep cycle)
│   │   └── index.js        # Builds master effects chain: filter → delay → reverb
│   └── mixer.js            # Per-track gain nodes + master gain → effects chain
│
├── harmony/
│   ├── scales.js           # 11 scale definitions as semitone interval arrays
│   ├── chords.js           # buildChord(root, scale, type, octave) → note strings
│   ├── progression.js      # Weighted Markov-chain next-chord selector
│   └── voicing.js          # Octave-spread voicing with humanized timing offsets
│
├── rhythm/
│   ├── clock.js            # Tone.Transport wrapper for BPM and meter
│   └── scheduler.js        # Schedules pad, drone, and texture events on Transport
│
├── engine/
│   ├── ruleEngine.js       # Orchestrates harmony + rhythm; start/stop/updateRules
│   └── rules.config.js     # Config object: tempo, scale, density, mood, etc.
│
├── archive/
│   ├── fetcher.js          # Fetches random audio from Archive.org API
│   ├── processor.js        # GrainPlayer at 1/8 speed (800% stretch) + filter + reverb
│   └── player.js           # Manages fade-in/out and crossfading of archive tracks
│
├── ui/
│   └── controls.js         # Start/stop button, volume slider, mood dropdown
│
└── main.js                 # Entry point: wires mixer, engine, archive, and UI
```

## How to Add New Scales

Edit `src/harmony/scales.js` and add a new entry:

```js
myScale: {
  name: 'My Scale',
  intervals: [0, 2, 3, 6, 7, 9, 10], // semitones from root
},
```

Then reference it in `rules.config.js` by setting `scale: 'myScale'`, or add it to a mood preset.

## How to Add New Chord Types

Edit `src/harmony/chords.js` and add an entry to the `CHORD_DEGREES` object:

```js
const CHORD_DEGREES = {
  // ...existing types
  myChord: [0, 2, 5], // scale degree indices (0-based)
};
```

The numbers are indices into the current scale's interval array. For extensions that wrap beyond one octave, the degree is automatically transposed up.

## How to Add New Synth Voices

1. Create a new file in `src/audio/synths/`, e.g. `bell.js`.
2. Export a factory function following the pattern:

```js
import * as Tone from 'tone';

export function createBellSynth(destination) {
  const synth = new Tone.PolySynth(Tone.Synth, {
    // your parameters
  });
  synth.connect(destination);
  return synth;
}
```

3. Import and add it in `src/audio/synths/index.js`.
4. Add a corresponding gain node in `src/audio/mixer.js`.
5. Schedule it in `src/rhythm/scheduler.js` and trigger it from `src/engine/ruleEngine.js`.

## Controls

- **Start/Stop** — Toggles generative playback (also resumes the browser audio context)
- **Volume** — Master output level
- **Mood** — Switches between preset configurations:
  - **Calm** — Pentatonic major, sparse, slow tempo
  - **Tense** — Phrygian, denser, faster tempo
  - **Ethereal** — Lydian, moderate density, very slow
  - **Dark** — Natural minor, moderate density, mid tempo

## Tech Stack

- [Tone.js](https://tonejs.github.io/) v14+ — Web Audio synthesis and scheduling
- [Vite](https://vitejs.dev/) — Build tool and dev server
- Vanilla JS with ES modules — No framework dependencies
