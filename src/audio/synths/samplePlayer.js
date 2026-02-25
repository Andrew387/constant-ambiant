import * as Tone from 'tone';

/**
 * Generic sample-based instrument factory.
 *
 * Supports two playback modes:
 *
 *   - Loopable: Seamless looping via overlapping crossfaded segments.
 *     We pre-schedule a batch of segments ahead of time so that all
 *     gain automations live on the audio thread with precise times —
 *     no setTimeout jitter between overlapping segments. A single
 *     setTimeout only fires to schedule the *next batch* well before
 *     the current batch runs out.
 *
 *   - Plucked: One-shot playback from sample start, no loop.
 *
 * Both modes share the same public API.
 */

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// Default loop region for ~7.4s samples.
// Uses a wide region to maximise available material and reduce loop frequency.
// Starts at 0.8s — past the initial transient but keeps the body.
// Ends at 6.0s — uses most of the sustain before any release tail.
const DEFAULT_LOOP_START = 0.8;
const DEFAULT_LOOP_END = 6.0;

// Crossfade as a fraction of loop length.
// 40% gives generous overlap for seamless blending while leaving
// enough full-gain sustain in the middle of each segment.
const CROSSFADE_RATIO = 0.4;
const MAX_CROSSFADE_SEC = 3.0;

// Small random jitter (±seconds) applied to each segment's start offset.
// Breaks the rhythmic periodicity so the brain can't latch onto a
// repeating timbral fingerprint at the loop boundary.
const JITTER_SEC = 0.25;

// How many segments to pre-schedule in each batch.
const BATCH_SIZE = 8;

// ── Equal-power crossfade curves (sin / cos) ──
// Unlike linear crossfade (which dips ~3 dB at the midpoint for
// uncorrelated signals), sin²+cos² = 1 keeps constant perceived power.
const CURVE_SAMPLES = 256;

function buildFadeInCurve() {
  const c = new Float32Array(CURVE_SAMPLES);
  for (let i = 0; i < CURVE_SAMPLES; i++) {
    c[i] = Math.sin((i / (CURVE_SAMPLES - 1)) * Math.PI * 0.5);
  }
  return c;
}

function buildFadeOutCurve() {
  const c = new Float32Array(CURVE_SAMPLES);
  for (let i = 0; i < CURVE_SAMPLES; i++) {
    c[i] = Math.cos((i / (CURVE_SAMPLES - 1)) * Math.PI * 0.5);
  }
  return c;
}

const FADE_IN  = buildFadeInCurve();
const FADE_OUT = buildFadeOutCurve();

function buildSampleUrls(filePrefix) {
  const urls = {};
  let fileIndex = 1;
  for (let octave = 1; octave <= 6; octave++) {
    for (let note = 0; note < 12; note++) {
      const padded = String(fileIndex).padStart(2, '0');
      urls[`${NOTE_NAMES[note]}${octave}`] = `${filePrefix}${padded}.wav`;
      fileIndex++;
    }
  }
  return urls;
}

/**
 * Creates a sample-based instrument.
 *
 * @param {object} config
 * @param {string}  config.folder     - Path relative to ./samples/
 * @param {string}  config.filePrefix - Filename prefix before the 2-digit number
 * @param {boolean} config.plucked    - true → one-shot, false → looped
 * @param {number}  [config.loopStart] - Override loop start (seconds into sample)
 * @param {number}  [config.loopEnd]   - Override loop end (seconds into sample)
 * @param {Tone.ToneAudioNode} destination - Audio node to connect to
 * @returns {Promise<object>}
 */
export function createSampleSynth({ folder, filePrefix, plucked, loopStart, loopEnd }, destination) {
  return new Promise((resolve) => {
    const urls = buildSampleUrls(filePrefix);
    const baseUrl = `./samples/${folder}/`;

    // Per-instrument loop region (or defaults)
    const lStart = loopStart ?? DEFAULT_LOOP_START;
    const lEnd = loopEnd ?? DEFAULT_LOOP_END;
    const loopLen = lEnd - lStart;
    const crossfade = Math.min(MAX_CROSSFADE_SEC, loopLen * CROSSFADE_RATIO);
    // Stride = time between consecutive segment starts
    const stride = loopLen - crossfade;

    const buffers = new Tone.ToneAudioBuffers(urls, {
      baseUrl,
      onload: () => {
        console.log(
          `[sample] ${filePrefix} loaded ` +
          `(${plucked ? 'plucked' : `loop ${lStart}–${lEnd}s, xfade ${crossfade.toFixed(2)}s, stride ${stride.toFixed(2)}s`})`
        );
        resolve(api);
      },
      onerror: (err) => {
        console.error(`[sample] ${filePrefix} load error:`, err);
      },
    });

    const activeVoices = new Map();

    let attackTime = 2;
    let releaseTime = 4;

    /**
     * Starts a voice for a single note.
     */
    function startVoice(note, time) {
      const buffer = buffers.get(note);
      if (!buffer) {
        console.warn(`[sample] no buffer for ${note}`);
        return null;
      }

      // Outer gain envelope for attack / release
      const envelope = new Tone.Gain(0);
      envelope.connect(destination);

      if (plucked) {
        // ── Plucked: single source, play from start, no loop ──
        const source = new Tone.ToneBufferSource({
          url: buffer,
          loop: false,
        });
        source.connect(envelope);
        source.start(time, 0);

        // Quick attack to avoid clicks
        envelope.gain.setValueAtTime(0, time);
        envelope.gain.linearRampToValueAtTime(1, time + 0.01);

        const voice = {
          envelope,
          segments: new Set([{ source, gain: null }]),
          stopScheduling() {},
        };
        activeVoices.set(note, voice);
        return voice;
      }

      // ── Loopable: pre-scheduled overlapping segments with crossfade ──
      //
      // We schedule BATCH_SIZE segments at once. Each segment plays the
      // buffer from lStart for loopLen seconds (one-shot, no Web Audio loop).
      // Consecutive segments overlap by `crossfade` seconds. All gain
      // automations are set up in one synchronous call, so they're
      // sample-accurate on the audio thread with zero jitter.

      const segments = new Set();
      let batchTimer = null;
      let voiceStopped = false;
      let nextSegIndex = 0; // how many segments have been scheduled total

      /**
       * Schedules a batch of segments starting from the given audio time.
       * All gain automations are set up synchronously — no setTimeout
       * between individual segments.
       */
      function scheduleBatch(batchStartTime) {
        if (voiceStopped) return;

        for (let i = 0; i < BATCH_SIZE; i++) {
          if (voiceStopped) return;

          const segIndex = nextSegIndex;
          const audioTime = batchStartTime + i * stride;
          nextSegIndex++;

          const source = new Tone.ToneBufferSource({ url: buffer, loop: false });
          const segGain = new Tone.Gain(0);
          source.connect(segGain);
          segGain.connect(envelope);

          // Per-segment random offset jitter — breaks rhythmic periodicity
          // so the same timbral fingerprint doesn't repeat every stride.
          const jitter = (Math.random() - 0.5) * 2 * JITTER_SEC;
          const segOffset = Math.max(0.05, lStart + jitter);

          // Play the loop region as a one-shot slice
          source.start(audioTime, segOffset);
          source.stop(audioTime + loopLen + 0.05);

          // ── Equal-power gain curves (sin²+cos² = 1, constant perceived power) ──
          if (segIndex === 0) {
            // First segment: full gain immediately (outer envelope handles attack)
            segGain.gain.setValueAtTime(1, audioTime);
          } else {
            // Equal-power fade in: sin(x·π/2) from 0 → 1
            segGain.gain.setValueCurveAtTime(FADE_IN, audioTime, crossfade);
          }
          // Equal-power fade out: cos(x·π/2) from 1 → 0
          segGain.gain.setValueCurveAtTime(FADE_OUT, audioTime + loopLen - crossfade, crossfade);

          const seg = { source, gain: segGain };
          segments.add(seg);

          // Self-cleanup after this segment's audio is done
          const cleanupDelay = (audioTime + loopLen + 0.5 - Tone.now()) * 1000;
          setTimeout(() => {
            if (segments.has(seg)) {
              try { source.stop(); } catch (_) { /* already stopped */ }
              source.dispose();
              segGain.dispose();
              segments.delete(seg);
            }
          }, Math.max(100, cleanupDelay));
        }

        // Schedule the next batch well before this one runs out.
        // The last segment in this batch starts at batchStartTime + (BATCH_SIZE-1)*stride.
        // We want to fire before that segment begins its fade-out.
        const lastSegStart = batchStartTime + (BATCH_SIZE - 1) * stride;
        const nextBatchAudioTime = lastSegStart + stride;
        // Fire the timer when we're ~2 segments from the end of this batch
        const fireAt = batchStartTime + (BATCH_SIZE - 2) * stride;
        const delayMs = Math.max(100, (fireAt - Tone.now()) * 1000);

        batchTimer = setTimeout(() => {
          scheduleBatch(nextBatchAudioTime);
        }, delayMs);
      }

      // Start the first batch
      scheduleBatch(time);

      // Attack ramp on outer envelope
      envelope.gain.setValueAtTime(0, time);
      envelope.gain.linearRampToValueAtTime(1, time + attackTime);

      const voice = {
        envelope,
        segments,
        stopScheduling() {
          voiceStopped = true;
          if (batchTimer) {
            clearTimeout(batchTimer);
            batchTimer = null;
          }
        },
      };
      activeVoices.set(note, voice);
      return voice;
    }

    /**
     * Releases a voice with a gain ramp to zero, then cleans up.
     */
    function stopVoice(note) {
      const voice = activeVoices.get(note);
      if (!voice) return;
      activeVoices.delete(note);

      // Stop scheduling new segments
      voice.stopScheduling();

      const { segments, envelope } = voice;
      const now = Tone.now();

      // Plucked voices get a short release; loopable use the full release time
      const relTime = plucked ? Math.min(releaseTime, 0.3) : releaseTime;

      // Freeze every segment's gain at its current level so the
      // equal-power fade-out curves don't silence segments before
      // the outer envelope finishes its release ramp.
      for (const seg of segments) {
        if (!seg.gain) continue;
        const g = seg.gain.gain;
        g.cancelScheduledValues(now);
        g.setValueAtTime(g.value, now);
      }

      // Release ramp: current level → 0
      envelope.gain.cancelScheduledValues(now);
      envelope.gain.setValueAtTime(envelope.gain.value, now);
      envelope.gain.linearRampToValueAtTime(0, now + relTime);

      // Dispose everything after release tail completes
      setTimeout(() => {
        for (const seg of segments) {
          try { seg.source.stop(); } catch (_) { /* already stopped */ }
          seg.source.dispose();
          if (seg.gain) seg.gain.dispose();
        }
        segments.clear();
        envelope.dispose();
      }, (relTime + 0.5) * 1000);
    }

    // ── Public API ──

    const api = {
      updateEnvelopes(chordSec, atkLevel = 1.0, relLevel = 1.0) {
        const floor = 0.01;
        attackTime = Math.max(floor, chordSec * 0.8 * atkLevel);
        releaseTime = Math.max(floor, chordSec * 1.2 * relLevel);
      },

      /**
       * Plays a chord: releases all current voices, starts new ones.
       * Used for the lead role (choir replacement).
       */
      playChord(notes, time) {
        for (const note of [...activeVoices.keys()]) {
          stopVoice(note);
        }
        for (const note of notes) {
          startVoice(note, time);
        }
      },

      /**
       * Plays a single note for a given duration.
       * Used for the bass role (drone replacement).
       */
      triggerAttackRelease(note, duration, time) {
        for (const n of [...activeVoices.keys()]) {
          stopVoice(n);
        }
        startVoice(note, time);
      },

      releaseAll(time) {
        for (const note of [...activeVoices.keys()]) {
          stopVoice(note);
        }
      },

      dispose() {
        for (const note of [...activeVoices.keys()]) {
          const voice = activeVoices.get(note);
          voice.stopScheduling();
          for (const seg of voice.segments) {
            try { seg.source.stop(); } catch (_) {}
            seg.source.dispose();
            if (seg.gain) seg.gain.dispose();
          }
          voice.segments.clear();
          voice.envelope.dispose();
        }
        activeVoices.clear();
        buffers.dispose();
      },
    };
  });
}
