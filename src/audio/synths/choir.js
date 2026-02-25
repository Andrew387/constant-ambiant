import * as Tone from 'tone';

/**
 * Choir synth — sample-based polyphonic instrument with click-free looping.
 *
 * Smooth looping uses the "dual offset source" technique:
 *   Two identical BufferSources loop the same sustain region but start
 *   offset by half the loop length. When source A hits the loop boundary
 *   (potential click), source B is in the middle of its loop (smooth).
 *   The click from one source is masked by the clean signal of the other.
 *   Each source runs at half gain so the sum is unity.
 *
 * Attack/release are handled by a per-voice gain envelope (0→1 ramp up,
 * 1→0 ramp down), independent of the loop mechanics.
 */

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// ── Loop region within each ~4s sample ──
// Well into the pure sustain, away from onset and tail.
const LOOP_START = 1.6;
const LOOP_END = 3.4;

function buildSampleUrls() {
  const urls = {};
  let fileIndex = 1;
  for (let octave = 1; octave <= 6; octave++) {
    for (let note = 0; note < 12; note++) {
      const padded = String(fileIndex).padStart(2, '0');
      urls[`${NOTE_NAMES[note]}${octave}`] = `maleChoir/maleChoirwav${padded}.wav`;
      fileIndex++;
    }
  }
  return urls;
}

/**
 * @param {Tone.ToneAudioNode} destination
 * @returns {Promise<object>} resolves when samples are loaded
 */
export function createChoirSynth(destination) {
  return new Promise((resolve) => {
    const buffers = new Tone.ToneAudioBuffers(buildSampleUrls(), {
      baseUrl: './',
      onload: () => {
        console.log('[choir] all samples loaded');
        resolve(choirApi);
      },
      onerror: (err) => {
        console.error('[choir] sample load error:', err);
      },
    });

    const activeVoices = new Map();

    let attackTime = 2;
    let releaseTime = 4;

    const loopLen = LOOP_END - LOOP_START;
    const halfLoop = loopLen / 2;

    /**
     * Starts a looping voice for a single note using dual offset sources.
     */
    function startVoice(note, time) {
      const buffer = buffers.get(note);
      if (!buffer) {
        console.warn(`[choir] no buffer for ${note}`);
        return null;
      }

      // Per-voice gain envelope (attack/release)
      const envelope = new Tone.Gain(0);
      envelope.connect(destination);

      // Mix node: two sources at half gain → unity sum
      const mixGain = new Tone.Gain(0.5);
      mixGain.connect(envelope);

      // Source A — starts at LOOP_START, loops the sustain region
      const sourceA = new Tone.ToneBufferSource({
        url: buffer,
        loop: true,
        loopStart: LOOP_START,
        loopEnd: LOOP_END,
      });
      sourceA.connect(mixGain);
      sourceA.start(time, LOOP_START);

      // Source B — same loop but offset by half the loop length.
      // Its boundary clicks land in the middle of A's clean sustain
      // and vice versa → clicks are always masked.
      const sourceB = new Tone.ToneBufferSource({
        url: buffer,
        loop: true,
        loopStart: LOOP_START,
        loopEnd: LOOP_END,
      });
      sourceB.connect(mixGain);
      sourceB.start(time, LOOP_START + halfLoop);

      // Attack ramp
      envelope.gain.setValueAtTime(0, time);
      envelope.gain.linearRampToValueAtTime(1, time + attackTime);

      const voice = { sources: [sourceA, sourceB], mixGain, envelope };
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

      const { sources, mixGain, envelope } = voice;
      const now = Tone.now();

      // Release ramp: current level → 0
      envelope.gain.cancelScheduledValues(now);
      envelope.gain.setValueAtTime(envelope.gain.value, now);
      envelope.gain.linearRampToValueAtTime(0, now + releaseTime);

      // Dispose after release tail completes
      setTimeout(() => {
        for (const src of sources) {
          try { src.stop(); } catch (_) { /* already stopped */ }
          src.dispose();
        }
        mixGain.dispose();
        envelope.dispose();
      }, (releaseTime + 0.5) * 1000);
    }

    // ── Public API (mirrors pad synth interface) ──

    const choirApi = {
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
          voice.mixGain.dispose();
          voice.envelope.dispose();
        }
        activeVoices.clear();
        buffers.dispose();
      },
    };
  });
}
