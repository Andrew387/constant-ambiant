# Port to SuperCollider — Migration Prompt

Read CLAUDE.md and the full src/ directory to understand the current architecture. This is a generative ambient music app currently running entirely in the browser with Tone.js. The goal is to port it to a **Node.js + SuperCollider** architecture so it can run as a 24/7 headless audio server that streams to listeners.

## Architecture Goal

```
┌───────────────────────────────┐         OSC          ┌─────────────────────────┐
│  Node.js  (the "brain")      │ ───────────────────►  │  SuperCollider (scsynth) │
│                               │                      │  (all audio DSP)        │
│  - ruleEngine.js              │  ◄─────────────────  │                         │
│  - songStructure.js           │    OSC replies/       │  - SynthDefs            │
│  - progression.js             │    status              │  - Effects buses        │
│  - voicing.js                 │                      │  - Sample playback      │
│  - chordPlayingRule.js        │                      │  - Mixer routing        │
│  - rules.config.js            │                      └──────────┬──────────────┘
│  - archive/fetcher.js         │                                 │ audio out
│  - freesound/fetcher.js       │                                 ▼
│  - sectionAutomation logic    │                          Icecast / HLS
│  - trackProfiles configs      │                          (stream to listeners)
└───────────────────────────────┘
```

**Node.js keeps:** All composition logic, progression generation, song structure state machine, chord playing rules, section automation decisions, timing/scheduling, Archive.org fetching, Freesound fetching, and configuration. These modules are pure JS with no browser dependencies (except the Tone.js import in scheduler.js which just passes times through).

**SuperCollider takes over:** All audio rendering — synth voices, sample playback, effects chains, gain routing, crossfading, reverb, filters, delays, LFOs, and final output.

## What to Build

### 1. SuperCollider SynthDefs + Buses

Replicate these audio layers as SC SynthDefs:

**Pad** (`src/audio/synths/pad.js`):  
Two detuned sine PolySynths (-8 and +7 cents), slow attack/release envelopes that scale with chord duration. 180 Hz highpass. Supports `playChord` (release old + attack new simultaneously for crossfade) and `addNotes` (bloom new notes without releasing existing ones). Max 16 voices.

**Lead** (sample-based, `src/audio/synths/samplePlayer.js`):  
Plays WAV samples from `samples/Lead/` directories. Each instrument = 72 WAV files (C1–B6). Two modes:
- **Loopable**: Overlapping crossfaded segments with equal-power (sin/cos) gain curves. Loop region ~0.8–6.0s of each sample, 40% crossfade ratio, ±0.25s jitter per segment to break periodicity. Outer gain envelope for attack/release.
- **Plucked**: One-shot from sample start, no loop. Quick 10ms attack.  
Lead plays one octave below the pad voicing.

**Drone/Bass** (sample-based, same `samplePlayer.js`):  
Same sample playback engine as lead, using `samples/Bass/` directories. Plays single root notes at octave 2. Plucked bass has per-chord-position beat offsets (20% chance of delayed entry on beats 2/3/4, pattern locked per song cycle).

**Texture** (`src/audio/synths/texturePlayer.js`):  
Single WAV file from `samples/texturesNew/` (79 files), looped with same crossfade approach. Playback rate 1.5x (pitch shift up). Loop region 1.0–13.0s. Swapped to a new random file each song cycle with 4s crossfade.

**Archive layer** (`src/archive/`):  
Fetches random audio from Archive.org (Node.js handles the fetching). In SC: plays the fetched audio through GrainBuf at 0.125 rate (800% time-stretch, grain size 0.5s, overlap 0.15), 250 Hz highpass → 3500 Hz lowpass → reverb (decay 14, wet 0.85). Auto-gain normalization to -24 dBFS RMS. Crossfades between tracks over 12s. New track every 1.5–2.8 minutes.

**Freesound layer** (`src/freesound/`):  
Fetches random short SFX from Freesound API (Node.js handles fetching). In SC: plays each sound through lowpass 2500 Hz → reverb (decay 20, wet 0.9). Sounds trigger every 2–10s randomly. Each sound's nodes disposed after 25s (reverb tail).

### 2. Mixer / Bus Routing in SuperCollider

Replicate the mixer architecture from `src/audio/mixer.js` and `src/audio/trackProfiles.js`:

**6 track buses** with individual gain:
- `pad` — gain 0.45, no effects chain
- `drone` — gain 0.5, duck gain node (for section automation)
- `lead` — gain 0.4, dynamic lowpass filter + LFO lowpass (0.02 Hz, 800–6000 Hz) + PingPongDelay (4n dotted, feedback 0.35, wet 0.25) + Reverb (decay 6, wet 0.45) + duck gain
- `sampleTexture` — gain 0.35, 800 Hz highpass → dynamic lowpass → compressor (threshold -24, ratio 4) → PingPongDelay (2n dotted, feedback 0.45, wet 0.3) → Reverb (decay 12, wet 0.55) → duck gain
- `archive` — gain 0.7, duck gain node
- `freesound` — gain 0.4, no effects chain

**Master gain**: 0.8

Consider using a **shared reverb send bus** instead of per-track reverbs for efficiency (the lead and sampleTexture currently have their own reverbs — consolidate into 1–2 shared reverbs with per-track send gains).

### 3. Section Automation (Node.js → OSC → SC)

The section automation logic in `src/audio/effects/sectionAutomation.js` makes per-chord decisions about filter cutoffs and duck gains. Keep this logic in Node.js but send the computed values to SuperCollider via OSC:

- **Dynamic filter cutoff**: Exponential interpolation between freq ranges based on brightness (0–1). Per-track freq ranges defined in trackProfiles.
- **Duck gain**: Maps brightness to volume (duckFloor–1.0). 
- **Brightness**: Per-section targets with S-curve easing, ±10% jitter per transition, hold thresholds before blending starts.
- **Deferred fade-in** (drone): Stays silent at cycle start, fades in at a random point within intro/main sections over 10s.
- **Gain swells** (archive): Random moments where gain overrides to 0.8–1.0 for 1–3 loops, 25% probability per eligible section.

On each chord event, Node.js computes all automation values and sends them to SC as OSC messages with ramp times.

### 4. OSC Communication Layer

**Node.js → SC messages** (design the OSC address space):
- `/chord/pad` — note names, time
- `/chord/lead` — note names, time (with sequential bloom offsets if applicable)
- `/chord/drone` — single note, duration, time offset
- `/track/gain` — track name, target gain, ramp time
- `/track/filter` — track name, target frequency, ramp time
- `/track/duck` — track name, target gain, ramp time
- `/instrument/swap` — track name (lead or bass), instrument folder path
- `/texture/swap` — new texture file path
- `/archive/play` — audio file URL or path, auto-gain offset
- `/archive/crossfade` — trigger crossfade to pending track
- `/freesound/play` — audio file URL or path
- `/engine/tempo` — new BPM (for any tempo-synced effects)
- `/engine/stop` — release all voices, silence

**SC → Node.js** (optional, for monitoring):
- `/status/ready` — SynthDef compilation done, ready to play
- `/status/buffer-loaded` — sample loading complete

Use `node-osc` or `osc-js` npm package on the Node.js side.

### 5. Sample Loading Strategy

All 72-note sample sets (Lead and Bass instruments) should be loaded into SC Buffers at startup or on-demand when swapped. The texture samples (79 files) can be loaded on-demand per cycle.

For Archive.org and Freesound: Node.js fetches the audio files (HTTP), saves them to a temp directory, then tells SC to load the buffer from disk. SC loads and plays. Node.js cleans up temp files after playback.

### 6. Streaming Output

Configure SuperCollider to output to **Icecast** for 24/7 internet radio streaming:
- Use JACK audio routing: scsynth → JACK → darkice/liquidsoap → Icecast
- OR use SC's built-in recording to pipe to FFmpeg → Icecast
- Output format: OGG Vorbis or MP3, 128–192 kbps
- The website just needs an `<audio src="http://yourserver:8000/stream">` element

### 7. Node.js Server Setup

Create a Node.js server entry point that:
1. Boots scsynth as a child process (or connects to an already-running instance)
2. Waits for SC to compile SynthDefs and report ready
3. Sends initial buffer load commands for the default instruments
4. Starts the rule engine loop (reuse existing ruleEngine.js logic)
5. On each chord event, sends OSC messages to SC instead of calling Tone.js synths
6. Handles instrument swaps by telling SC to load new buffers, then swap
7. Runs Archive.org and Freesound fetchers, downloads audio to temp files, tells SC to play them
8. Optionally serves a simple web page with the `<audio>` stream player

### 8. What to Keep As-Is (no changes needed)

These modules are pure JS and work in Node.js unchanged:
- `src/engine/ruleEngine.js` — just replace the synth trigger calls with OSC sends
- `src/engine/songStructure.js` — state machine, no audio deps
- `src/engine/rules.config.js` — pure config
- `src/engine/chordPlayingRule.js` — pure logic
- `src/harmony/progression.js` — pure math
- `src/harmony/voicing.js` — pure math
- `src/harmony/chords.js`, `scales.js` — pure math
- `src/archive/fetcher.js` — uses fetch() (available in Node 18+)
- `src/freesound/fetcher.js` — uses fetch()
- `src/freesound/config.js` — pure config

### 9. What to Rewrite

- `src/audio/mixer.js` → becomes the OSC sender / SC bus setup
- `src/audio/synths/pad.js` → SC SynthDef
- `src/audio/synths/samplePlayer.js` → SC SynthDef + Buffer management
- `src/audio/synths/texturePlayer.js` → SC SynthDef + Buffer management
- `src/audio/effects/trackEffects.js` → SC effect SynthDefs on buses
- `src/audio/effects/sectionAutomation.js` → keep the JS logic, output via OSC instead of Tone.js node manipulation
- `src/audio/trackProfiles.js` → keep as config, translate effect specs to SC equivalents
- `src/rhythm/scheduler.js` → becomes thin OSC message formatter
- `src/rhythm/clock.js` → simplify (no Tone.Transport needed, just JS timing)
- `src/archive/player.js` → rewrite to use SC for playback instead of Tone.js
- `src/archive/processor.js` → move processing (time-stretch, filters, reverb) to SC SynthDef
- `src/freesound/player.js` → rewrite to use SC for playback instead of Tone.js
- `src/main.js` → becomes Node.js server entry point (no DOM, no UI)
- `src/ui/` → replace with simple web page that plays the Icecast stream

### 10. Key Behaviors to Preserve

- **Chord scheduling via setTimeout** (not a DAW transport) — 7+ second intervals, setTimeout jitter is inaudible
- **Equal-power crossfades** (sin²+cos²=1) on all sample looping
- **Humanized timing**: ±30ms random offsets per note in a chord
- **Sequential chord blooming**: lowest note plays immediately, higher notes enter at 1/4 divisions of chord duration
- **Chord skip**: 30% in transition, 20% in intro, 10% in outro — silence instead of playing, release held notes
- **Loop variation**: on repeat passes, 1–3 random chords get micro-varied (inversion, revoicing, color change, octave shift, drop fifth)
- **Instrument swap per cycle**: random lead + bass at each song cycle, with plucked/loopable behavior differences
- **Tempo drift**: ±4 BPM per cycle within 45–72 range
- **Key modulation**: ~50% chance to pivot to a related key each cycle via reinterpretation of last chord
- **Section hold thresholds**: automation brightness holds steady for a percentage of each section before blending toward the next
- **Deferred drone fade-in**: drone stays silent from cycle start, fades in at random point in intro/main
- **Archive gain swells**: random gain overrides during eligible sections
