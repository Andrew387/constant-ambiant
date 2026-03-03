# Constant Ambient — Project Context

## What This Is
A **generative ambient music web app** built with **Tone.js** and **vanilla JS (ES modules)**. It creates infinite, emotionally-driven ambient soundscapes entirely in the browser — no server, no framework. Bundled with **Vite**.

## Tech Stack
- **Tone.js 14.x** — Web Audio synthesis, effects, scheduling
- **Vite 7.x** — dev server & build (`npm run dev` / `npm run build`)
- **Vanilla JS** — ES modules, no TypeScript, no React/Vue/etc.

## Architecture Overview

### Entry Flow
`index.html` → `src/main.js` → user clicks Start → `Tone.start()` → `initMixer()` builds audio graph → `ruleEngine.start()` begins generative playback.

### Core Modules

| Module | Path | Role |
|--------|------|------|
| **main.js** | `src/main.js` | Wires UI ↔ engine ↔ mixer, manages debug state |
| **ruleEngine** | `src/engine/ruleEngine.js` | Central brain — generates progressions, schedules chords via `setTimeout`, manages loop state |
| **songStructure** | `src/engine/songStructure.js` | 6-section state machine: `transition → intro → main → innerTransition → main2 → outro → repeat` |
| **rules.config** | `src/engine/rules.config.js` | Tempo (45–72 BPM), chord duration, section durations, chord skip probabilities, feature flags |
| **mixer** | `src/audio/mixer.js` | Master audio graph: per-track gains, effect chains, instrument swapping |
| **trackProfiles** | `src/audio/trackProfiles.js` | Declarative per-track config: gain, effect chain specs, section automation |
| **progression** | `src/harmony/progression.js` | Procedural chord progression generator — 14 patterns across 7 moods, chord coloring (sus2/add9), rhythm weights |
| **voicing** | `src/harmony/voicing.js` | Octave spreading, humanized timing (±30ms) |
| **scheduler** | `src/rhythm/scheduler.js` | Triggers pad/drone/lead synths with voiced notes |
| **sectionAutomation** | `src/audio/effects/sectionAutomation.js` | Per-section brightness filters & gain ducking driven by `trackProfiles` automation config |

### Audio Tracks (6 layers)
1. **pad** — Two detuned PolySynths, slow crossfade (`src/audio/synths/pad.js`)
2. **drone** — MonoSynth sub-bass, heavy lowpass at 150 Hz (`src/audio/synths/drone.js`)
3. **lead** — Sample-based loopable instrument (`src/audio/synths/samplePlayer.js`) — 6 voice options (male choir, strings, bells, etc.)
4. **sampleTexture** — Seamless-looping ambient WAV from `samples/texturesNew/` (`src/audio/synths/texturePlayer.js`)
5. **archive** — Archive.org ambient audio, time-stretched 800%, filtered (`src/archive/`)
6. **freesound** — Freesound SFX layer (`src/freesound/`)

### How Timing Works
- Chord scheduling uses **`setTimeout`** (NOT `Tone.Transport.schedule`) to avoid accumulated drift over 7+ second intervals
- `chordDuration` = measures of 4/4; actual seconds = `measures * 4 * (60 / bpm)`
- Loop passes count chord progression play-throughs; section durations are measured in loop passes

### How Progressions Work
- Generated at cycle start (transition section) via `generateLoopProgression()`
- Stored in `baseLoop` (source of truth); `loop` may be a varied copy
- On repeat passes: `createVariedLoop()` applies micro-changes (inversions, revoicing, chord color swaps)
- ~30% chance of root note modulation per cycle; tempo drifts ±4 BPM

### Chord Skip (Breathing Silences)
- In certain sections, individual chords have a random chance of being silently skipped, creating organic gaps
- Configured via `CHORD_SKIP_PROBABILITY` in `rules.config.js` (per section type, 0–1)
- Current probabilities: **transition 30%**, **intro 20%**, **outro 10%** — main sections play all chords
- Skip is evaluated independently per chord per play — loop timing and section automation continue normally
- Logged as `[engine] skipping chord …` in the console

### Per-Track Effect System
- `TRACK_PROFILES` in `trackProfiles.js` is the single source of truth
- Each track declares: `gain`, `chain[]` (effect specs), `automation{}` (section brightness, duck floors, gain swells)
- Effect nodes tagged with `id: 'dynamicFilter'` or `id: 'duckGain'` are located by `sectionAutomation.js`
- Adding automation to a track = add entries to its profile, no other files change

### Sample Instruments
- Located in `samples/Lead/Loopable/` and `samples/Bass/`
- Each instrument = 72 WAV files (C1–B6, files numbered 01–72)
- Registry in `src/audio/synths/sampleRegistry.js`

## Key Patterns & Conventions
- **Factory functions** for synths/effects: `createPadSynth()`, `createSampleSynth()`, etc.
- **Declarative config** for track routing — `TRACK_PROFILES` and `rulesConfig`
- **State machine** for song structure — sections advance by loop pass count
- **Equal-power crossfades** for seamless audio looping (texture player, sample player)
- **Always minor keys** — mood is locked to dark/sad/epic; engine rotates among `DARK_ROOTS`
- Console logs use `[tag]` prefix format: `[song]`, `[engine]`, `[texture]`, etc.

## Directory Structure
```
src/
├── main.js                    # Entry point
├── audio/
│   ├── mixer.js               # Master routing & gain
│   ├── trackProfiles.js       # Per-track declarative config
│   ├── synths/                # Pad, drone, samplePlayer, texturePlayer
│   └── effects/               # Per-track effects, section automation
├── harmony/                   # Progressions, scales, chords, voicing
├── rhythm/                    # Clock (Transport wrapper), scheduler
├── engine/                    # Rule engine, song structure, config
├── archive/                   # Archive.org fetcher/player
├── freesound/                 # Freesound fetcher/player
└── ui/                        # Controls, debug panel
samples/                       # ~1GB of WAV samples (gitignored by size)
```

## Common Tasks
- **Add a new synth/instrument**: Create factory in `src/audio/synths/` → add to mixer → schedule in `ruleEngine.js`
- **Add a new track with automation**: Add entry to `TRACK_PROFILES` in `trackProfiles.js` — automation, effects, gain all declared there
- **Change song structure timing**: Edit `SECTION_DURATIONS` in `rules.config.js`
- **Change progression behavior**: Edit `progression.js` patterns/coloring/rhythm
- **Add a new sample instrument**: Add WAVs to `samples/`, register in `sampleRegistry.js`
