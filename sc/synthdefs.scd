// ============================================================
// Constant Ambient — SuperCollider SynthDef Definitions
// ============================================================
//
// All SynthDefs used by the Node.js controller.
// Load this file in sclang before starting the Node.js server:
//   thisProcess.interpreter.executeFile("sc/synthdefs.scd");
//
// Audio bus layout (stereo pairs):
//   0-1   : Hardware output
//   2-3   : Master bus
//   4-5   : Pad track
//   6-7   : Drone/Bass track
//   8-9   : Lead track
//   10-11 : Texture track
//   12-13 : Archive track
//   14-15 : Freesound track
//   16-17 : Short reverb send (decay ~6s)
//   18-19 : Long reverb send (decay ~14s)
//
// Group structure (execution order):
//   Group 100 : Source synths
//   Group 200 : Track effects (in-place on track buses)
//   Group 300 : Shared reverbs
//   Group 400 : Master output
// ============================================================

(
// ── PAD VOICE ───────────────────────────────────────────────
// Two detuned sine oscillators with independent ADSR envelopes.
// One instance per held note. Set gate=0 to release.
// HPF at 180 Hz keeps low end clear for the bass/drone.

SynthDef(\padVoice, { |out=0, freq=440, gate=1,
    atk1=8, dec1=4, sus1=0.7, rel1=12,
    atk2=10, dec2=5, sus2=0.5, rel2=14,
    amp1=0.05, amp2=0.032,
    detune1=(-8), detune2=7, hpFreq=180|

    var freq1 = freq * (2 ** (detune1 / 1200));
    var freq2 = freq * (2 ** (detune2 / 1200));

    var env1 = EnvGen.kr(
        Env.adsr(atk1, dec1, sus1, rel1, curve: [1, -1, -4]),
        gate, doneAction: 2
    );
    var env2 = EnvGen.kr(
        Env.adsr(atk2, dec2, sus2, rel2, curve: [1, -1, -4]),
        gate, doneAction: 0  // voice freed by env1
    );

    var sig1 = SinOsc.ar(freq1) * amp1 * env1;
    var sig2 = SinOsc.ar(freq2) * amp2 * env2;
    var sig = HPF.ar(sig1 + sig2, hpFreq);

    Out.ar(out, sig ! 2);
}).add;

// ── SAMPLE LOOP (crossfade) ────────────────────────────────
// Seamless loop playback via two BufRd readers offset by half
// the loop region. Equal-power crossfade: sin²+cos²=1.
// Used for loopable lead and bass instruments.

SynthDef(\sampleLoop, { |out=0, buf=0, gate=1, amp=1,
    loopStart=0.8, loopEnd=6.0, atkTime=2, relTime=4, rate=1.0|

    var sr    = BufSampleRate.kr(buf);
    var lSF   = loopStart * sr;
    var lEF   = loopEnd * sr;
    var loopF = lEF - lSF;
    var halfF = loopF * 0.5;

    // Two phasors offset by half the loop region
    var phase1 = Phasor.ar(0, rate * BufRateScale.kr(buf), lSF, lEF);
    var phase2 = Wrap.ar(phase1 + halfF, lSF, lEF);

    var sig1 = BufRd.ar(1, buf, phase1, 0, 2);
    var sig2 = BufRd.ar(1, buf, phase2, 0, 2);

    // Normalised position (0–1) for crossfade calculation
    var npos1 = (phase1 - lSF) / loopF;
    var npos2 = (phase2 - lSF) / loopF;

    // Equal-power gains: sin(x·π) where x ∈ [0,1]
    // With half-loop offset: sin²(npos·π) + sin²((npos+0.5)·π) = 1
    var gain1 = (npos1 * pi).sin;
    var gain2 = (npos2 * pi).sin;

    var sig = (sig1 * gain1) + (sig2 * gain2);

    // Outer envelope for attack / release
    var env = EnvGen.kr(
        Env.asr(atkTime, 1, relTime, curve: [-2, -4]),
        gate, doneAction: 2
    );

    Out.ar(out, (sig * env * amp) ! 2);
}).add;

// ── SAMPLE ONE-SHOT (plucked) ──────────────────────────────
// Plays buffer from start, no loop. Quick attack to avoid clicks.
// Set gate=0 to release with a short fade.

SynthDef(\sampleOneShot, { |out=0, buf=0, gate=1, amp=1,
    rate=1.0, atkTime=0.01, relTime=0.3|

    var sig = PlayBuf.ar(1, buf, rate * BufRateScale.kr(buf),
        doneAction: 0);

    var env = EnvGen.kr(
        Env.asr(atkTime, 1, relTime, curve: [-1, -4]),
        gate, doneAction: 2
    );

    Out.ar(out, (sig * env * amp) ! 2);
}).add;

// ── SAMPLE LOOP STEREO ───────────────────────────────────────
// Stereo version of sampleLoop for texture files that may be stereo.
// Reads 2 channels, crossfade-loops, outputs stereo directly.

SynthDef(\sampleLoopStereo, { |out=0, buf=0, gate=1, amp=1,
    loopStart=0.8, loopEnd=6.0, atkTime=2, relTime=4, rate=1.0|

    var sr    = BufSampleRate.kr(buf);
    var lSF   = loopStart * sr;
    var lEF   = loopEnd * sr;
    var loopF = lEF - lSF;
    var halfF = loopF * 0.5;

    var phase1 = Phasor.ar(0, rate * BufRateScale.kr(buf), lSF, lEF);
    var phase2 = Wrap.ar(phase1 + halfF, lSF, lEF);

    var sig1 = BufRd.ar(2, buf, phase1, 0, 2);
    var sig2 = BufRd.ar(2, buf, phase2, 0, 2);

    var npos1 = (phase1 - lSF) / loopF;
    var npos2 = (phase2 - lSF) / loopF;

    var gain1 = (npos1 * pi).sin;
    var gain2 = (npos2 * pi).sin;

    var sig = (sig1 * gain1) + (sig2 * gain2);

    var env = EnvGen.kr(
        Env.asr(atkTime, 1, relTime, curve: [-2, -4]),
        gate, doneAction: 2
    );

    Out.ar(out, sig * env * amp);
}).add;

// ── ARCHIVE GRANULAR PLAYER ────────────────────────────────
// GrainBuf time-stretch at 0.125× rate (800% stretch).
// Built-in HPF 250 Hz → LPF 3500 Hz. Auto-gain via amp param.
// Long ASR envelope for crossfades between tracks.

SynthDef(\archiveGrain, { |out=0, buf=0, gate=1, amp=1,
    grainDur=0.5, grainRate=0.125, overlap=0.15,
    hpFreq=250, lpFreq=3500, atkTime=12, relTime=12|

    var bufDur   = BufDur.kr(buf);
    var trigRate  = 1 / (grainDur * (1 - overlap));
    var trig      = Impulse.kr(trigRate);
    var scanRate  = grainRate / bufDur;
    var pos       = Phasor.kr(0, scanRate / ControlRate.ir, 0, 1);
    var sig = GrainBuf.ar(2, trig, grainDur, buf, grainRate, pos, 2, 0);
    var env = EnvGen.kr(
        Env.asr(atkTime, 1, relTime, curve: [-2, -4]),
        gate, doneAction: 2
    );

    // All var declarations above — filtering below
    sig = HPF.ar(sig, hpFreq);
    sig = LPF.ar(sig, lpFreq);

    Out.ar(out, sig * env * amp);
}).add;

// ── ARCHIVE LOOP PLAYER ────────────────────────────────────
// Normal-speed playback of a random short segment (1–3s loop).
// startPos is 0–1 normalized position in buffer.
// Built-in HPF + LPF, same ASR envelope for crossfades.
SynthDef(\archiveLoop, { |out=0, buf=0, gate=1, amp=1,
    loopDur=2, startPos=0,
    hpFreq=250, lpFreq=3500, atkTime=12, relTime=12|

    var bufDur    = BufDur.kr(buf);
    var bufFrames = BufFrames.kr(buf);
    var rate      = BufRateScale.kr(buf);
    var startFrame = (startPos * bufFrames).round;
    var endFrame   = ((startPos + (loopDur / bufDur)) * bufFrames).min(bufFrames).round;

    var phase = Phasor.ar(0, rate, startFrame, endFrame, startFrame);
    var sig   = BufRd.ar(1, buf, phase, 0, 2) ! 2;

    var env = EnvGen.kr(
        Env.asr(atkTime, 1, relTime, curve: [-2, -4]),
        gate, doneAction: 2
    );

    sig = HPF.ar(sig, hpFreq);
    sig = LPF.ar(sig, lpFreq);

    Out.ar(out, sig * env * amp);
}).add;

// ── SFX PLAYER (freesound one-shot) ────────────────────────
// Simple buffer playback with built-in lowpass.
// Self-frees when buffer finishes (doneAction on PlayBuf).

SynthDef(\sfxPlayer, { |out=0, buf=0, amp=0.25, lpFreq=2500|

    var sig = LPF.ar(
        PlayBuf.ar(1, buf, BufRateScale.kr(buf), doneAction: 2),
        lpFreq
    );

    Out.ar(out, (sig * amp) ! 2);
}).add;

// ── SFX PLAYER STEREO ───────────────────────────────────────
// Stereo version for freesound files that may be stereo.
SynthDef(\sfxPlayerStereo, { |out=0, buf=0, amp=0.25, lpFreq=2500|

    var sig = LPF.ar(
        PlayBuf.ar(2, buf, BufRateScale.kr(buf), doneAction: 2),
        lpFreq
    );

    Out.ar(out, sig * amp);
}).add;


// ════════════════════════════════════════════════════════════
//  EFFECT SYNTHDEFS — in-place processing on track buses
// ════════════════════════════════════════════════════════════

// ── VINYL WOBBLE (punctual pitch drift) ─────────────────────
// Occasional smooth pitch bumps via delay-line modulation.
// Random Dust triggers → percussive envelope → modulates a short
// delay time. While delay grows the pitch drops; while it shrinks
// the pitch rises back — like a finger brushing a spinning record.
// density = avg bumps per second, depth = max delay excursion (s).
SynthDef(\fxVinylWobble, { |bus=0, density=0.12, depth=0.004, decay=1.5|
    var sig = In.ar(bus, 2);
    var trig = Dust.kr(density);
    // Direction: randomly pitch up or down each bump
    var dir = TRand.kr(-1, 1, trig).sign;
    // Smooth bump envelope: ~0.5s rise, configurable fall
    var env = EnvGen.kr(Env.perc(0.5, decay, 1, -4), trig);
    var mod = env * dir * depth;
    // Base delay keeps signal centred; modulation swings around it
    var delTime = (0.005 + mod).clip(0.0001, 0.02);
    var wet = DelayC.ar(sig, 0.02, delTime);
    ReplaceOut.ar(bus, wet);
}).add;

// ── GAIN (track gain, duck gain) ────────────────────────────
// Lag3 (3rd-order) produces smooth S-curve transitions instead of
// the abrupt exponential onset of .lag(). lagTime controls ramp
// duration — duck gains use longer times for gradual section fades.
SynthDef(\fxGain, { |bus=0, gain=1, lagTime=4|
    ReplaceOut.ar(bus, In.ar(bus, 2) * Lag3.kr(gain, lagTime));
}).add;

// ── HIGHPASS FILTER ─────────────────────────────────────────
SynthDef(\fxHPF, { |bus=0, freq=180|
    ReplaceOut.ar(bus, HPF.ar(In.ar(bus, 2), freq.lag(2)));
}).add;

// ── LOWPASS FILTER (automation target) ──────────────────────
// Lag3 smooths section automation sweeps with an S-curve shape.
SynthDef(\fxLPF, { |bus=0, freq=18000, lagTime=3|
    ReplaceOut.ar(bus, LPF.ar(In.ar(bus, 2), Lag3.kr(freq, lagTime)));
}).add;

// ── LFO-MODULATED LOWPASS ───────────────────────────────────
// Cascaded 2× LPF (24 dB/oct) with mild resonance for audible sweep.
SynthDef(\fxLPFLfo, { |bus=0, centerFreq=3000,
    lfoRate=0.04, lfoMin=800, lfoMax=6000, rq=0.7|

    var lfo = SinOsc.kr(lfoRate).range(lfoMin, lfoMax);
    var sig = In.ar(bus, 2);
    sig = RLPF.ar(sig, lfo, rq);
    sig = LPF.ar(sig, lfo);   // second stage for 24 dB/oct total
    ReplaceOut.ar(bus, sig);
}).add;

// ── PING-PONG DELAY ────────────────────────────────────────
// Cross-feedback stereo delay with dry/wet mix.
SynthDef(\fxPingPong, { |bus=0, delayTime=0.5, feedback=0.35,
    wet=0.25, maxDelay=6|

    var sig = In.ar(bus, 2);
    var mono = (sig[0] + sig[1]) * 0.5;
    var fb = LocalIn.ar(1);
    var del1 = DelayL.ar(mono + (fb * feedback), maxDelay, delayTime);
    var del2 = DelayL.ar(del1 * feedback, maxDelay, delayTime);
    var delayed = [del1, del2];

    // Feedback loop completion
    LocalOut.ar(del2);

    // Stereo spread: first tap left, second tap right
    ReplaceOut.ar(bus, (sig * (1 - wet)) + (delayed * wet));
}).add;

// ── COMPRESSOR ──────────────────────────────────────────────
SynthDef(\fxCompressor, { |bus=0, thresh=(-24), ratio=4,
    atkTime=0.01, relTime=0.3|

    var sig = In.ar(bus, 2);
    ReplaceOut.ar(bus,
        Compander.ar(sig, sig, thresh.dbamp, 1, 1/ratio, atkTime, relTime)
    );
}).add;

// ── AUTO GAIN CONTROL ──────────────────────────────────────
// Tracks signal amplitude and adjusts gain to hit a target level.
// Smoothed with lag to avoid pumping. maxGain caps boost on silence.
SynthDef(\fxAGC, { |bus=0, targetAmp=0.3, atkTime=0.5, relTime=3, maxGain=20|
    var sig = In.ar(bus, 2);
    var amp = Amplitude.kr((sig[0] + sig[1]) * 0.5, atkTime, relTime);
    var gain = (targetAmp / amp.max(0.001)).min(maxGain);
    ReplaceOut.ar(bus, sig * gain.lag(0.5));
}).add;

// ── REVERB SEND ─────────────────────────────────────────────
// Sends a scaled copy of the signal to a reverb bus.
// Uses Out (additive) so signal accumulates on the reverb bus.
SynthDef(\fxReverbSend, { |bus=0, sendBus=16, level=0.5, lagTime=4|
    Out.ar(sendBus, In.ar(bus, 2) * Lag3.kr(level, lagTime));
}).add;

// ── TRACK OUTPUT ────────────────────────────────────────────
// Routes processed track signal to the master bus.
SynthDef(\fxTrackOut, { |bus=0, masterBus=2, gain=1, lagTime=4|
    Out.ar(masterBus, In.ar(bus, 2) * Lag3.kr(gain, lagTime));
}).add;


// ════════════════════════════════════════════════════════════
//  SHARED REVERBS
// ════════════════════════════════════════════════════════════

// ── SHORT REVERB (lead, ~6s decay) ─────────────────────────
SynthDef(\reverbShort, { |inBus=16, outBus=2, decay=16, damp=0.3|
    var sig = In.ar(inBus, 2);
    // FreeVerb2 room maps 0–1; approximate decay mapping
    var room = (decay / 20).clip(0, 1);
    var rev = FreeVerb2.ar(sig[0], sig[1], 1.0, room, damp);
    Out.ar(outBus, rev);
}).add;

// ── LONG REVERB (texture, archive, freesound, ~14s decay) ──
SynthDef(\reverbLong, { |inBus=18, outBus=2, decay=19, damp=0.2|
    var sig = In.ar(inBus, 2);
    var room = (decay / 20).clip(0, 1);
    var rev = FreeVerb2.ar(sig[0], sig[1], 1.0, room, damp);
    Out.ar(outBus, rev);
}).add;


// ════════════════════════════════════════════════════════════
//  MASTER EFFECTS — in-place processing on master bus
// ════════════════════════════════════════════════════════════

// ── MASTER REVERB (deep, long tail) ─────────────────────────
// Wet/dry mix with Lag3 for smooth per-song transitions.
SynthDef(\fxMasterReverb, { |bus=2, wet=0.15, decay=18, damp=0.2, lagTime=8|
    var sig = In.ar(bus, 2);
    var room = (decay / 20).clip(0, 1);
    var rev = FreeVerb2.ar(sig[0], sig[1], 1.0, room, damp);
    var mix = Lag3.kr(wet, lagTime);
    ReplaceOut.ar(bus, (sig * (1 - mix)) + (rev * mix));
}).add;

// ── MASTER DELAY (long, diffuse) ────────────────────────────
// Cross-feedback stereo delay with lagged wet/dry mix.
SynthDef(\fxMasterDelay, { |bus=2, wet=0.1, delayTime=1.5,
    feedback=0.4, maxDelay=6, lagTime=8|
    var sig = In.ar(bus, 2);
    var mono = (sig[0] + sig[1]) * 0.5;
    var fb = LocalIn.ar(1);
    var del1 = DelayL.ar(mono + (fb * feedback), maxDelay, delayTime);
    var del2 = DelayL.ar(del1 * feedback, maxDelay, delayTime);
    var mix = Lag3.kr(wet, lagTime);

    // Feedback loop completion (after all var declarations)
    LocalOut.ar(del2);

    ReplaceOut.ar(bus, (sig * (1 - mix)) + ([del1, del2] * mix));
}).add;

// ── MASTER FILTER LFO (slow movement) ──────────────────────
// Sweeps a lowpass cutoff around centerFreq for subtle timbral movement.
// depth 0 = no modulation (filter wide open at 18 kHz),
// depth 1 = full sweep across lfoMin–lfoMax range.
SynthDef(\fxMasterLPFLfo, { |bus=2, centerFreq=8000,
    lfoRate=0.03, depth=0.0, rq=0.85, lagTime=8|
    var sig = In.ar(bus, 2);
    var d = Lag3.kr(depth, lagTime);
    var r = Lag3.kr(lfoRate, lagTime);
    var cf = Lag3.kr(centerFreq, lagTime);
    // When depth=0, freq stays at 18kHz (transparent). When depth>0, LFO sweeps.
    var lfo = SinOsc.kr(r).range(-1, 1);
    var freq = ((cf + (lfo * cf * d * 0.6)).clip(200, 18000));
    var target = LinXFade2.ar(
        sig,
        RLPF.ar(sig, freq, Lag3.kr(rq, lagTime)),
        (d * 2 - 1).clip(-1, 1)  // -1 = dry, 1 = filtered
    );
    ReplaceOut.ar(bus, target);
}).add;


// ════════════════════════════════════════════════════════════
//  MASTER OUTPUT
// ════════════════════════════════════════════════════════════

SynthDef(\masterOut, { |inBus=2, outBus=0, gain=0.8, lagTime=4|
    Out.ar(outBus, In.ar(inBus, 2) * Lag3.kr(gain, lagTime));
}).add;

// ── SILENCE BUS ─────────────────────────────────────────────
// Clears a bus each cycle (required because Out.ar is additive).
// One instance per track bus + reverb bus, placed at head of group.
SynthDef(\busClear, { |bus=0|
    ReplaceOut.ar(bus, Silent.ar(2));
}).add;

// ── BUS METER ──────────────────────────────────────────────
// Reads a stereo audio bus, computes RMS and peak amplitude,
// writes both to adjacent control buses for polling via /c_getn.
// Place at tail of effects group so levels reflect post-processing.
SynthDef(\busMeter, { |audioBus=0, ctlBus=100|
    var sig = In.ar(audioBus, 2);
    var mono = (sig[0] + sig[1]) * 0.5;
    var rms = Amplitude.kr(mono, 0.05, 0.2);
    var peak = Peak.kr(mono.abs, Impulse.kr(3)).lag(0.1);
    Out.kr(ctlBus, [rms, peak]);
}).add;

"[synthdefs] All SynthDefs compiled and added.".postln;
)
