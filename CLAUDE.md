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
| **ruleEngine** | `src/engine/ruleEngine.js` | Central brain — schedules chords via `setTimeout`, orchestrates instrument swaps, triggers synths |
| **loopManager** | `src/engine/loopManager.js` | Owns chord progression loop state: base loop, variation, position tracking, lead reversed loop |
| **trackRegistry** | `src/audio/trackRegistry.js` | Single source of truth for track wiring: bus mapping, reverb routing, send levels |
| **songStructure** | `src/engine/songStructure.js` | 6-section state machine: `transition → intro → main → innerTransition → main2 → outro → repeat` |
| **rules.config** | `src/engine/rules.config.js` | Tempo (45–72 BPM), chord duration, section durations, chord skip probabilities, feature flags |
| **mixer** | `src/audio/mixer.js` | Master audio graph: per-track gains, effect chains, instrument swapping |
| **trackProfiles** | `src/audio/trackProfiles.js` | Declarative per-track config: gain, effect chain specs, section automation |
| **progression** | `src/harmony/progression.js` | Procedural chord progression generator — 14 patterns across 7 moods, chord coloring (sus2/add9), rhythm weights |
| **voicing** | `src/harmony/voicing.js` | Octave spreading, humanized timing (±30ms) |
| **scheduler** | `src/rhythm/scheduler.js` | Triggers pad/drone/lead synths with voiced notes |
| **sectionAutomation** | `src/audio/effects/sectionAutomation.js` | Per-section brightness filters & gain ducking driven by `trackProfiles` automation config |

### Audio Tracks (7 layers)
1. **pad** — Two detuned PolySynths, slow crossfade (`src/audio/synths/pad.js`)
2. **drone** — Sample-based bass, heavy lowpass at 150 Hz (`src/audio/synths/samplePlayer.js`)
3. **lead** — Sample-based loopable instrument (`src/audio/synths/samplePlayer.js`) — 6 voice options (male choir, strings, bells, etc.)
4. **leadReversed** — Any loopable instrument (`LEAD_REVERSED_POOL`) playing the lead's chord progression in reverse order with heavy variation; held at gain 0 (silent) with a lowpass at 200 Hz, then dramatic gain+filter swells every 15–30 s (`src/audio/effects/leadReversedSwell.js`)
5. **sampleTexture** — Seamless-looping ambient WAV from `samples/texturesNew/` (`src/audio/synths/texturePlayer.js`)
6. **archive** — Archive.org ambient audio, time-stretched 800%, filtered (`src/archive/`)
7. **freesound** — Freesound SFX layer (`src/freesound/`)

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
- Located in `samples/Lead/Loopable/`, `samples/Lead/Plucked/`, `samples/Bass/Loopable/`, `samples/Bass/Plucked/`
- Each instrument = 72 WAV files (C1–B6, files numbered 01–72)
- Registry in `src/audio/synths/sampleRegistry.js`
- **Loopable**: crossfaded loop playback (sustained pads/strings)
- **Plucked**: one-shot playback from start, no loop (percussive attacks)
- Both lead and bass are randomly swapped per song cycle
- Plucked lead → sequential chord playing rule has ~70% probability (vs 50% normally)
- Plucked bass → 20% chance the bass note enters on beat 2, 3, or 4 instead of beat 1

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
samples/                       # ~1GB of WAV samples (tracked via Git LFS)
```

## Sample Volume Normalization (March 2026)

### Problem
Raw sample instruments had wildly inconsistent loudness — both across notes within a single instrument and across different instruments in the same group (Bass or Lead). Worst offenders: `bloomingbasslong` had a 49 dB range across its 72 notes; `analogbellslong` and `malechoirlong` had ~19 dB ranges. Across instruments, bass ranged from -26.9 to -40.3 avg dBFS; leads ranged from -15.6 to -40.5 avg dBFS.

### Solution — Two-pass normalization
1. **Intra-instrument** (`normalize_volume.py` Pass 1): Compress each note's RMS toward the instrument's median. Deviation reduced by 60% (`COMPRESSION_RATIO`), gain capped at ±12 dB to avoid inflating noise on out-of-range notes.
2. **Inter-instrument** (`normalize_volume.py` Pass 2): Flat gain applied per instrument so all instruments in the same group share the same average RMS.
3. **Peak limiter** at -0.5 dBFS after both passes to prevent clipping.

### Post-normalization state
| Group | Instrument | Avg RMS | Range | Std Dev |
|-------|-----------|---------|-------|---------|
| Bass | bloomingbasslong | -32.0 | 33.0 dB | 9.5 |
| Bass | basskeylong | -32.0 | 2.8 dB | 0.7 |
| Bass | jazzSessBass | -32.0 | 12.0 dB | 2.6 |
| Lead | analogbellslong | -23.5 | 7.5 dB | 1.3 |
| Lead | brushstringslong | -23.5 | 0.9 dB | 0.3 |
| Lead | calmbeachlong | -23.5 | 3.9 dB | 1.2 |
| Lead | crystalbellslong | -23.5 | 3.0 dB | 0.8 |
| Lead | malechoirlong | -23.5 | 7.8 dB | 1.7 |
| Lead | silkystringslong | -23.5 | 0.7 dB | 0.2 |
| Lead | distant bells | -26.3 | 7.1 dB | 1.8 |

`distant bells` sits 2.8 dB below the lead target because its transient peaks hit the -0.5 dBFS ceiling before RMS can fully catch up (typical of plucked sounds). `bloomingbasslong` retains a wide range because notes 67–72 are far outside the bass instrument's natural register.

### Tools
- `analyze_volume.py` — reads all samples, prints per-instrument stats, saves `volume_analysis.json`
- `normalize_volume.py` — normalizes Bass/Lead/Bass-Lead/Pad instruments, backs up originals to `samples_backup/`
- `normalize_fx_volume.py` — normalizes FX collections (Riser/Boomer), backs up originals to `samples_backup/FX/`
- All require a Python venv: `python3 -m venv .venv && source .venv/bin/activate && pip install numpy soundfile`

### Backups
Original pre-normalization samples are preserved in `samples_backup/` with the same directory structure. To restore: `rm -rf samples/Bass samples/Lead && cp -r samples_backup/* samples/`

## Common Tasks
- **Add a new synth/instrument**: Create factory in `src/audio/synths/` → add to mixer → schedule in `ruleEngine.js`
- **Add a new audio track** (full checklist — every step is required):
  1. `sc/startup.scd` — Add a new source group (e.g. `s.sendMsg(\g_new, 117, 0, 100)`) and add the bus number to the bus-clear array
  2. `src/sc/nodeIds.js` — Add entries to both `GROUPS` and `BUSES`
  3. `src/audio/trackProfiles.js` — Add the track's `TRACK_PROFILES` entry (gain, effect chain, automation)
  4. **`src/audio/trackRegistry.js`** — Add the track to `TRACK_WIRING`. This is the single source of truth for bus mapping, reverb routing, and send levels. **Without this, the effect chain won't be built, sectionAutomation won't discover the track's duckGain/dynamicFilter nodes, and any automation (including deferred fade-in) will silently fail — the track stays at its initial gain (often 0) forever.**
  5. `src/engine/sections.config.js` — Add the track to each section's `tracks` object for chord-trigger gating
  6. `src/engine/rules.config.js` — Add to `TRACK_SKIP_RELEASE` if the track responds to chord triggers
  7. `src/audio/mixer.js` — Create a swappable slot (if applicable), add chord trigger, init the synth, expose swap in return object
  8. `src/engine/ruleEngine.js` — Wire up swap callback, pass any needed state in `triggerCtx`, add to `syncEnvelopesToDuration()`, clean up in `stop()`
  9. `src/main.js` — Pass the swap function in the `start()` callbacks
- **Change song structure timing**: Edit `SECTION_DURATIONS` in `rules.config.js`
- **Change progression behavior**: Edit `progression.js` patterns/coloring/rhythm
- **Add a new sample instrument**: Add WAVs to `samples/`, register in `sampleRegistry.js`, then run `npm run samples:upload` to sync to R2

## Sample Storage (Cloudflare R2)

Samples are **not stored in git**. They live on **Cloudflare R2** (S3-compatible object storage) and are fetched locally on setup. The `samples/` directory is `.gitignore`d.

### Bucket
- **Provider**: Cloudflare R2
- **Bucket name**: `constant-ambiant-samples`
- **Current size**: ~2 GB (951 WAV files)
- **Format**: 48 kHz, 16-bit, stereo WAV

### Scripts
| Command | Script | Purpose |
|---------|--------|---------|
| `npm run samples:setup` | `scripts/r2-setup.sh` | One-time: installs rclone, configures R2 credentials |
| `npm run samples:upload` | `scripts/samples-upload.sh` | Syncs local `samples/` → R2 (only uploads changes) |
| `npm run samples:fetch` | `scripts/samples-fetch.sh` | Downloads R2 → local `samples/` |

All scripts use **rclone** with the `r2` remote. Credentials are stored in `~/.config/rclone/rclone.conf` (not in the repo).

### Setup on a new machine
```bash
npm run samples:setup    # configure rclone with R2 credentials
npm run samples:fetch    # download all samples (~2 GB)
```

### Adding new sample instruments (Bass/Lead/Pad)
1. Place WAV files in the appropriate `samples/` subdirectory (e.g. `samples/Lead/Loopable/newInstrument/`)
2. Run volume normalization: `source .venv/bin/activate && python3 normalize_volume.py`
3. Register in `src/audio/synths/sampleRegistry.js`
4. Run `npm run samples:upload` to sync new files to R2
5. Only changed/new files are uploaded (rclone sync)

### Adding new FX collections (Riser/Boomer)
1. Place WAV files in `samples/FX/Riser/<collection name>/` or `samples/FX/Boomer/<collection name>/`
   - File naming: `<prefix>{01–NN}.wav` (zero-padded 2-digit numbers)
2. Run FX volume normalization: `source .venv/bin/activate && python3 normalize_fx_volume.py`
   - This normalizes volumes both within each collection and across all collections of the same type
3. Add the new collection to `RISER_COLLECTIONS` or `BOOMER_COLLECTIONS` in `src/fx/riserBoomerPlayer.js` with the folder path, file prefix, and file count
4. Run `npm run samples:upload` to sync to R2

### Fetching a specific subfolder
```bash
./scripts/samples-fetch.sh Lead/Loopable    # fetch only Lead/Loopable
./scripts/samples-upload.sh Bass/Plucked    # upload only Bass/Plucked
```

### Directory structure on R2 (mirrors local)
```
constant-ambiant-samples/
├── Bass/Loopable/         # Loopable bass instruments
├── Bass/Plucked/          # One-shot bass instruments
├── Bass-Lead/Loopable/    # Dual-purpose instruments
├── Bass-Lead/Plucked/
├── Lead/Loopable/         # Loopable lead instruments
├── Lead/Plucked/          # One-shot lead instruments
├── pad/loopable/          # Pad instruments
├── FX/                    # FX samples (Riser, Boomer)
└── texturesNew/           # Ambient texture loops
```

## Track Wiring Architecture (March 2026)

### Track Wiring — Single Source of Truth

`src/audio/trackRegistry.js` contains `TRACK_WIRING`, the single source of truth for track bus mapping, reverb routing, and send levels. All derived maps (`TRACK_BUS_MAP`, `TRACK_REVERB_MAP`, `REVERB_SEND_LEVELS`, `TRACK_DRY_GAIN`) are automatically generated from it.

Adding a track = add one entry to `TRACK_WIRING`. `createAllTrackEffects()` validates at startup and logs errors for mismatches with `TRACK_PROFILES`.

| Map | File | Purpose |
|-----|------|---------|
| `TRACK_WIRING` | `trackRegistry.js` | Single source of truth: bus, reverb bus, reverb send, dry gain |
| `TRACK_PROFILES` | `trackProfiles.js` | Track name → gain, effect chain, automation |

Both `trackEffects.js` and `mixer.js` import `TRACK_BUS_MAP` from `trackRegistry.js`, so bus mappings are always consistent.

### Naming Conventions (Confusing Legacy)

| Display Name | Track Key | Synths Key | Bus Name | Notes |
|-------------|-----------|------------|----------|-------|
| Drone/Bass | `drone` | `synths.drone` | `BUSES.DRONE` | The "drone" track actually plays the **bass** instrument. `bassSlot` has `synthKey: 'drone'`. |
| Lead | `lead` | `synths.lead` | `BUSES.LEAD` | |
| Sample Texture | `sampleTexture` | — | `BUSES.TEXTURE` | VU meter uses short name `texture` |
| Archive | `archive` | — | `BUSES.ARCHIVE` | |
| Freesound | `freesound` | — | `BUSES.FREESOUND` | |
| Pedal Pad | `pedalPad` | `synths.pedalPad` | `BUSES.PEDAL_PAD` | No VU meter |
| Bass Support | `bassSupport` | `synths.bassSupport` | `BUSES.BASS_SUPPORT` | No VU meter |
| Lead Reversed | `leadReversed` | `synths.leadReversed` | `BUSES.LEAD_REVERSED` | Any loopable instrument from `LEAD_REVERSED_POOL`, reversed progression with gain+filter swell |

### VU Meter Control Buses

Meters write to control buses 100–111 (6 meters × 2 values each). The meter synths are created in `mixer.js` at tail of GROUPS.EFFECTS, reading from audio buses and writing RMS + peak to control buses. `pollLevels()` reads all 12 values via `/c_getn` and keys results by name.

### samplePlayer `triggerAttackRelease` Pattern

The drone and bassSupport use `triggerAttackRelease(note, duration)` which starts a voice and schedules `stopVoice` after `duration` seconds. Release timers are tracked per-note and cancelled on re-trigger to prevent stale timeouts from killing re-triggered voices of the same note.

### Deferred Fade-In

Tracks with `deferredFadeIn` in their automation config (drone, bassSupport) start each cycle with duckGain = 0 (silent). At a random point during the configured window sections, the automation triggers a fade-in by setting the duck gain to its normal calculated value. The SC `Lag3` smoothing (lagTime: 4s) handles the actual fade curve.

### Lead Reversed Track

The `leadReversed` track creates dramatic, wave-like swells by playing the lead's chord progression in reverse order through any loopable instrument. The track is held completely silent (gain 0) and periodically bursts to life with a combined gain + filter swell.

**How it works:**
- **Reversed progression**: `ruleEngine.js` maintains a `leadReversedLoop` — the current `baseLoop` reversed and heavily varied (40–70% of chords get 1–2 random variations: inversions, revoicing, color changes, octave shifts, drop-fifth)
- **Instrument pool**: Uses `LEAD_REVERSED_POOL` (all loopable non-sine instruments from LEAD, PAD, and BASS_LEAD pools), randomly swapped each song cycle. Notes are shifted to octaves 2–3 via `toPadOctave()` in `scheduler.js` — the overlap range all instrument pools support
- **Dual swell mechanism**: The track's effect chain has two swell-controlled nodes:
  1. `swellFilter` — lowpass at 200 Hz (closed) → 12000–18000 Hz (open), lagTime 1.5 s
  2. `swellGain` — gain 0 (closed) → 0.8 (open), lagTime 1.5 s
  The gain at 0 guarantees absolute silence when closed (no filter leakage). Both ramp simultaneously via SC `Lag3` smoothing (~4.5 s to 95%), creating a slow dramatic rise from silence to full bright harmonics
- **Swell timing**: `leadReversedSwell.js` fires every 15–30 s, holds at peak for 0.3–1 s, then snaps both nodes back to closed state. The Lag3 smoothing shapes both the rise and the fall
- **No section automation**: The track plays continuously in all sections. The swell timer operates independently of section state
- **Sustains through chord skips**: `TRACK_SKIP_RELEASE[leadReversed] = false` — notes are not released when chords are skipped

**Key files:**
- `src/audio/effects/leadReversedSwell.js` — Swell timer controlling both filter freq and gain (start/stop, random interval scheduling)
- `src/engine/ruleEngine.js` — `createLeadReversedLoop()`, reversed loop state, `leadReversedChord` in triggerCtx
- `src/rhythm/scheduler.js` — `triggerLeadReversed()`, `toPadOctave()` octave mapping

**Important**: The SC SynthDef `fxLPF` uses parameter name `freq` (not `frequency`). Always use `nodeSet(id, { freq: value })` when controlling filter frequency.
