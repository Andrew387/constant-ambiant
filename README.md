# Constant Ambient

A **generative ambient music server** — Node.js handles the compositional brain, SuperCollider handles all audio DSP. Designed to run headless 24/7 and stream via Icecast/HLS.

## Quick Start

```bash
# 1. Install dependencies
brew install --cask supercollider   # if not already installed
npm install

# 2. Boot SuperCollider (Terminal 1)
npm run sc:boot

# 3. Wait for "Waiting for Node.js controller..." then start Node.js (Terminal 2)
npm start
```

Audio plays through your default output device. Press `Ctrl+C` in the Node.js terminal to shut down gracefully.

## Prerequisites

| Dependency | Version | Purpose |
|---|---|---|
| **Node.js** | 18+ | Composition logic, OSC control |
| **SuperCollider** | 3.13+ | Audio DSP (scsynth server) |
| **osc-min** | 1.x | OSC message encoding/decoding (installed via npm) |

### Installing SuperCollider (macOS)

```bash
brew install --cask supercollider
```

This installs `SuperCollider.app` to `/Applications/`. The `sclang` binary is at:
```
/Applications/SuperCollider.app/Contents/MacOS/sclang
```

## Architecture

```
┌─────────────────┐       OSC/UDP        ┌──────────────────────┐
│   Node.js        │ ──────────────────→  │   scsynth             │
│                  │   /s_new, /n_set,    │                      │
│  Composition     │   /b_allocRead,      │   Audio DSP          │
│  Rule Engine     │   /n_free            │   SynthDefs          │
│  Song Structure  │                      │   Effects            │
│  Harmony         │ ←────────────────── │   Buffer Playback    │
│  Automation      │   /done, /synced,    │                      │
│                  │   /b_info, /fail     │       ↓              │
└─────────────────┘                      │  Audio Output        │
                                          │  (speakers/Icecast)  │
                                          └──────────────────────┘
```

- **Node.js** (port 57130): Generates chord progressions, schedules notes, controls section automation, fetches Archive.org/Freesound audio
- **scsynth** (port 57110): Runs all SynthDefs, processes audio, outputs to hardware or virtual device
- **sclang**: Boots scsynth, compiles SynthDefs, creates group/bus hierarchy

## Running

### Step 1: Boot SuperCollider

```bash
npm run sc:boot
# or directly:
/Applications/SuperCollider.app/Contents/MacOS/sclang sc/startup.scd
```

Wait until you see:

```
============================================
[startup] Server booted and ready.
[startup] UDP port: 57110
[startup] Sample rate: 48000.0
[startup] Groups: 100(src) 200(fx) 300(rev) 400(master)
...
[startup] Waiting for Node.js controller on port 57110...
============================================
```

### Step 2: Start Node.js

In a **separate terminal**:

```bash
npm start
# or for auto-restart on file changes:
npm run dev
```

You'll see:

```
╔════════════════════════════════════════════════╗
║   Constant Ambient — Headless Audio Server     ║
║   Node.js + SuperCollider                      ║
╚════════════════════════════════════════════════╝

[boot] Connecting to scsynth...
[boot] scsynth is responding.
[boot] Initializing mixer...
[boot] Starting generative engine...
...
═══════════════════════════════════════════════════
  Server running. Audio is flowing through scsynth.
  Press Ctrl+C to stop gracefully.
═══════════════════════════════════════════════════
```

### Stopping

- `Ctrl+C` in the Node.js terminal — gracefully stops the engine, frees SC nodes
- `Ctrl+C` in the sclang terminal — stops the audio server

Always stop Node.js first, then SuperCollider.

## Audio Output Device

By default, `sc/startup.scd` routes audio to `"MacBook Air Speakers"`. To change the output device, edit this line in `sc/startup.scd`:

```supercollider
s.options.outDevice = "MacBook Air Speakers";
```

Common alternatives:

| Device | Use Case |
|---|---|
| `"MacBook Air Speakers"` | Local listening |
| `"BlackHole 16ch"` | Route to DAW or streaming software |
| `"Multi-Output Device"` | Speakers + BlackHole simultaneously |

List available devices by running in SuperCollider IDE: `ServerOptions.devices`

## SuperCollider Group & Bus Layout

### Groups (execution order)

| Group ID | Name | Contents |
|---|---|---|
| 100 | Sources | All sound-generating synths |
| 110–115 | Sub-groups | Pad, Lead, Drone, Texture, Archive, Freesound |
| 200 | Effects | In-place track processing (filters, gain, delay, compression) |
| 300 | Reverbs | Shared short reverb (6s) and long reverb (14s) |
| 400 | Master | Final output gain + bus clearing |

### Audio Buses (stereo pairs)

| Bus | Track |
|---|---|
| 0–1 | Hardware output |
| 2–3 | Master mix |
| 4–5 | Pad |
| 6–7 | Drone/Bass |
| 8–9 | Lead |
| 10–11 | Texture |
| 12–13 | Archive |
| 14–15 | Freesound |
| 16–17 | Short reverb send |
| 18–19 | Long reverb send |

## Audio Layers

| Layer | SynthDef | Description |
|---|---|---|
| **Pad** | `\padVoice` | Two detuned sine oscillators with independent ADSR envelopes. One node per held note. |
| **Lead** | `\sampleLoop` / `\sampleOneShot` | Sample-based instrument (72 notes, C1–B6). Loopable or plucked. |
| **Drone/Bass** | `\sampleLoop` / `\sampleOneShot` | Same engine as lead, different instrument set. |
| **Texture** | `\sampleLoop` | Single WAV from `samples/texturesNew/`, crossfade-looped at 1.5× rate. |
| **Archive** | `\archiveGrain` | GrainBuf time-stretch at 0.125× (800% stretch), HPF 250 Hz, LPF 3500 Hz. |
| **Freesound** | `\sfxPlayer` | One-shot buffer playback with lowpass. Self-frees when done. |

## Project Structure

```
.
├── sc/
│   ├── startup.scd              # Boots scsynth, loads SynthDefs, creates groups
│   └── synthdefs.scd            # All SuperCollider SynthDef definitions
│
├── src/
│   ├── main.js                  # Entry point — boots OSC, mixer, engine
│   │
│   ├── sc/                      # SuperCollider communication layer
│   │   ├── osc.js               # Single-socket UDP OSC client (dgram + osc-min)
│   │   ├── nodeIds.js           # Node ID allocator + group/bus constants
│   │   └── bufferManager.js     # Buffer allocation, sample loading, temp file mgmt
│   │
│   ├── audio/
│   │   ├── mixer.js             # Creates SC synth nodes, track gains, instrument swaps
│   │   ├── trackProfiles.js     # Declarative per-track config (gain, effects, automation)
│   │   ├── synths/
│   │   │   ├── pad.js           # OSC wrapper for \padVoice
│   │   │   ├── samplePlayer.js  # OSC wrapper for \sampleLoop / \sampleOneShot
│   │   │   ├── texturePlayer.js # OSC wrapper for texture loop playback
│   │   │   └── sampleRegistry.js # Instrument definitions (folders, file prefixes)
│   │   └── effects/
│   │       ├── trackEffects.js      # Builds per-track SC effect chains
│   │       └── sectionAutomation.js # Brightness-based filter/gain automation
│   │
│   ├── engine/
│   │   ├── ruleEngine.js        # Central brain — progressions, scheduling, swaps
│   │   ├── songStructure.js     # 6-section state machine
│   │   ├── rules.config.js      # Tempo, durations, probabilities, feature flags
│   │   └── chordPlayingRule.js  # Chord voicing rules (simultaneous, sequential, etc.)
│   │
│   ├── harmony/
│   │   ├── progression.js       # Procedural chord progression generator
│   │   ├── voicing.js           # Octave spreading, humanized timing
│   │   ├── chords.js            # Chord building utilities
│   │   └── scales.js            # Scale definitions
│   │
│   ├── rhythm/
│   │   ├── clock.js             # BPM store (pure JS, no Tone.Transport)
│   │   └── scheduler.js         # Triggers SC synths with voiced notes
│   │
│   ├── archive/
│   │   ├── fetcher.js           # Fetches random audio from Archive.org
│   │   └── player.js            # Downloads, loads buffer, plays via \archiveGrain
│   │
│   └── freesound/
│       ├── fetcher.js           # Fetches random SFX from Freesound API
│       ├── player.js            # Downloads, loads buffer, plays via \sfxPlayer
│       └── config.js            # API key and search queries
│
├── samples/                     # WAV samples (~1GB, Git LFS)
│   ├── Bass/Loopable/           # bloomingbasslong (72 notes)
│   ├── Bass/Plucked/            # basskeylong, jazzSessBass (72 notes each)
│   ├── Lead/Loopable/           # 6 instruments (72 notes each)
│   ├── Lead/Plucked/            # distant bells (72 notes)
│   └── texturesNew/             # 79 ambient texture WAVs
│
└── package.json
```

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `SC_HOST` | `127.0.0.1` | scsynth host address |
| `SC_PORT` | `57110` | scsynth UDP port |
| `OSC_LOCAL_PORT` | `57130` | Node.js OSC socket port |

## npm Scripts

| Script | Command | Description |
|---|---|---|
| `npm start` | `node src/main.js` | Start the Node.js server |
| `npm run dev` | `node --watch src/main.js` | Start with auto-restart on changes |
| `npm run sc:boot` | `sclang sc/startup.scd` | Boot SuperCollider server |

## Generative Music Features

- **Song structure**: 6-section cycle (transition → intro → main → innerTransition → main2 → outro → repeat)
- **Chord progressions**: 14 patterns across 7 moods, chord coloring (sus2/add9), rhythm variation
- **Key modulation**: ~30% chance of root note change per cycle
- **Tempo drift**: ±4 BPM per cycle
- **Chord skip**: Organic silences in transition/intro/outro sections
- **Instrument swap**: Lead and bass randomly change instruments each cycle
- **Section automation**: Brightness-based filter cutoff and gain ducking per track
- **Deferred fade-in**: Drone enters at a random point within the cycle
- **Archive gain swells**: Random gain overrides during eligible sections
- **Equal-power crossfades**: Seamless sample looping via sin²+cos² crossfade

## Troubleshooting

### "scsynth not responding" on Node.js start

SuperCollider isn't running. Boot it first with `npm run sc:boot` and wait for the "ready" message.

### "bind EADDRINUSE" error

Port 57130 is already in use (probably a previous Node.js instance). Kill it:
```bash
lsof -ti:57130 | xargs kill
```

### No audio output

1. Check the output device in `sc/startup.scd` matches an available device
2. Verify scsynth reports 2 output channels (not 1)
3. Check your system volume isn't muted

### Sample rate mismatch

If you see `"Requested sample rate was not available"`, the output device doesn't support the requested rate. Remove or comment out `s.options.sampleRate` in `sc/startup.scd` to use the device's native rate.

### SynthDef compilation errors

If sclang reports syntax errors in `synthdefs.scd`, check that all `var` declarations are at the **top** of each SynthDef function body — SuperCollider requires this.
