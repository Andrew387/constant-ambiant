import * as Tone from 'tone';

/**
 * Generic sample-based instrument factory.
 *
 * Uses the exact same "dual offset source" looping technique as the
 * proven choir.js implementation:
 *   Two identical BufferSources loop the same sustain region but start
 *   offset by half the loop length. When source A hits the loop boundary
 *   (potential click), source B is in the middle of its loop (smooth).
 *   Each source runs at half gain so the sum is unity.
 *
 * Plucked mode: one-shot playback from sample start, no loop.
 */

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// Default loop region for ~7.4s samples.
// Starts at 1.5s — safely past attack/modulation (~0–1s).
// Ends at 4.5s — well before any release tail.
const DEFAULT_LOOP_START = 1.5;
const DEFAULT_LOOP_END = 4.5;

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

    const lStart = loopStart ?? DEFAULT_LOOP_START;
    const lEnd = loopEnd ?? DEFAULT_LOOP_END;
    const loopLen = lEnd - lStart;
    const halfLoop = loopLen / 2;

    const buffers = new Tone.ToneAudioBuffers(urls, {
      baseUrl,
      onload: () => {
        console.log(
          `[sample] ${filePrefix} loaded ` +
          `(${plucked ? 'plucked' : `loop ${lStart}–${lEnd}s`})`
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

    function startVoice(note, time) {
      const buffer = buffers.get(note);
      if (!buffer) {
        console.warn(`[sample] no buffer for ${note}`);
        return null;
      }

      // Per-voice gain envelope (attack/release)
      const envelope = new Tone.Gain(0);
      envelope.connect(destination);

      if (plucked) {
        const source = new Tone.ToneBufferSource({
          url: buffer,
          loop: false,
        });
        source.connect(envelope);
        source.start(time, 0);

        envelope.gain.setValueAtTime(0, time);
        envelope.gain.linearRampToValueAtTime(1, time + 0.01);

        const voice = { sources: [source], mixGain: null, envelope };
        activeVoices.set(note, voice);
        return voice;
      }

      // ── Loopable: dual offset sources (same technique as choir.js) ──

      // Mix node: two sources at half gain → unity sum
      const mixGain = new Tone.Gain(0.5);
      mixGain.connect(envelope);

      // Source A — starts at lStart, loops the sustain region
      const sourceA = new Tone.ToneBufferSource({
        url: buffer,
        loop: true,
        loopStart: lStart,
        loopEnd: lEnd,
      });
      sourceA.connect(mixGain);
      sourceA.start(time, lStart);

      // Source B — same loop but offset by half the loop length.
      // Its boundary clicks land in the middle of A's clean sustain
      // and vice versa → clicks are always masked.
      const sourceB = new Tone.ToneBufferSource({
        url: buffer,
        loop: true,
        loopStart: lStart,
        loopEnd: lEnd,
      });
      sourceB.connect(mixGain);
      sourceB.start(time, lStart + halfLoop);

      // Attack ramp
      envelope.gain.setValueAtTime(0, time);
      envelope.gain.linearRampToValueAtTime(1, time + attackTime);

      const voice = { sources: [sourceA, sourceB], mixGain, envelope };
      activeVoices.set(note, voice);
      return voice;
    }

    function stopVoice(note) {
      const voice = activeVoices.get(note);
      if (!voice) return;
      activeVoices.delete(note);

      const { sources, mixGain, envelope } = voice;
      const now = Tone.now();

      const relTime = plucked ? Math.min(releaseTime, 0.3) : releaseTime;

      envelope.gain.cancelScheduledValues(now);
      envelope.gain.setValueAtTime(envelope.gain.value, now);
      envelope.gain.linearRampToValueAtTime(0, now + relTime);

      setTimeout(() => {
        for (const src of sources) {
          try { src.stop(); } catch (_) { /* already stopped */ }
          src.dispose();
        }
        if (mixGain) mixGain.dispose();
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

      playChord(notes, time) {
        for (const note of [...activeVoices.keys()]) {
          stopVoice(note);
        }
        for (const note of notes) {
          startVoice(note, time);
        }
      },

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
          for (const src of voice.sources) {
            try { src.stop(); } catch (_) {}
            src.dispose();
          }
          if (voice.mixGain) voice.mixGain.dispose();
          voice.envelope.dispose();
        }
        activeVoices.clear();
        buffers.dispose();
      },
    };
  });
}
