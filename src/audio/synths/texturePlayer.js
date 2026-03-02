import * as Tone from 'tone';

/**
 * Single-file texture sample player with seamless crossfade looping.
 *
 * Uses the same overlapping-segment approach as samplePlayer.js but adapted
 * for a single mono WAV file (no note mapping). Designed for long ambient
 * texture samples (~14.5s). One random file is loaded per song cycle and
 * looped continuously until swapped.
 *
 * Loop region is wider than pitched samples to exploit the longer duration.
 */

const TEXTURE_COUNT = 79;

// Pitch shift: play samples faster to push bass content into higher range.
const PLAYBACK_RATE = 1.5;

// Loop region for ~14.5s texture samples (in buffer time).
const LOOP_START = 1.0;
const LOOP_END   = 13.0;
// Real-time duration accounts for playback rate.
const LOOP_LEN   = (LOOP_END - LOOP_START) / PLAYBACK_RATE;  // 8s at 1.5x

// Crossfade: generous overlap for smooth blending of ambient material.
const CROSSFADE_RATIO   = 0.35;
const MAX_CROSSFADE_SEC = 4.0;
const CROSSFADE = Math.min(MAX_CROSSFADE_SEC, LOOP_LEN * CROSSFADE_RATIO);
const STRIDE    = LOOP_LEN - CROSSFADE;

// Per-segment jitter to break loop periodicity.
const JITTER_SEC = 0.3;

// Pre-schedule this many segments per batch.
const BATCH_SIZE = 8;

// Fade time for song-cycle transitions (swap in/out).
const SWAP_FADE_SEC = 4.0;

// ── Equal-power crossfade curves ──
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

/**
 * Picks a random texture file URL.
 * @param {number} [exclude] - Index to avoid (so we don't repeat the same file)
 * @returns {{ url: string, index: number }}
 */
function pickRandomTexture(exclude) {
  let idx;
  do {
    idx = Math.floor(Math.random() * TEXTURE_COUNT) + 1;
  } while (idx === exclude && TEXTURE_COUNT > 1);
  const padded = String(idx).padStart(2, '0');
  return {
    url: `./samples/texturesNew/texturesNew${padded}.wav`,
    index: idx,
  };
}

/**
 * Creates a texture sample player that loops a single file continuously.
 *
 * @param {Tone.ToneAudioNode} destination - Audio node to connect output to
 * @returns {{ start, stop, swap, dispose }}
 */
export function createTexturePlayer(destination) {
  let currentIndex = null;
  let activeLoop = null;     // { envelope, segments, batchTimer, stopped }
  let swapPending = false;

  /**
   * Internal: begins looping a loaded buffer.
   * Returns a loop handle for stopping/cleanup.
   */
  function startLoop(buffer, startTime) {
    const envelope = new Tone.Gain(0);
    envelope.connect(destination);

    const segments = new Set();
    const segTimers = new Set(); // track per-segment cleanup timer IDs
    let batchTimer = null;
    let stopped = false;
    let nextSegIndex = 0;

    function scheduleBatch(batchStartTime) {
      if (stopped) return;

      for (let i = 0; i < BATCH_SIZE; i++) {
        if (stopped) return;

        const segIndex = nextSegIndex;
        const audioTime = batchStartTime + i * STRIDE;
        nextSegIndex++;

        const source = new Tone.ToneBufferSource({
          url: buffer,
          loop: false,
          playbackRate: PLAYBACK_RATE,
        });
        const segGain = new Tone.Gain(0);
        source.connect(segGain);
        segGain.connect(envelope);

        // Per-segment jitter
        const jitter = (Math.random() - 0.5) * 2 * JITTER_SEC;
        const segOffset = Math.max(0.05, LOOP_START + jitter);

        source.start(audioTime, segOffset);
        source.stop(audioTime + LOOP_LEN + 0.05);

        // Equal-power crossfade curves
        if (segIndex === 0) {
          segGain.gain.setValueAtTime(1, audioTime);
        } else {
          segGain.gain.setValueCurveAtTime(FADE_IN, audioTime, CROSSFADE);
        }
        segGain.gain.setValueCurveAtTime(FADE_OUT, audioTime + LOOP_LEN - CROSSFADE, CROSSFADE);

        const seg = { source, gain: segGain };
        segments.add(seg);

        // Self-cleanup
        const cleanupDelay = (audioTime + LOOP_LEN + 0.5 - Tone.now()) * 1000;
        const timerId = setTimeout(() => {
          segTimers.delete(timerId);
          if (segments.has(seg)) {
            try { source.stop(); } catch (_) {}
            source.dispose();
            segGain.dispose();
            segments.delete(seg);
          }
        }, Math.max(100, cleanupDelay));
        segTimers.add(timerId);
      }

      // Schedule next batch
      const lastSegStart = batchStartTime + (BATCH_SIZE - 1) * STRIDE;
      const nextBatchAudioTime = lastSegStart + STRIDE;
      const fireAt = batchStartTime + (BATCH_SIZE - 2) * STRIDE;
      const delayMs = Math.max(100, (fireAt - Tone.now()) * 1000);

      batchTimer = setTimeout(() => {
        scheduleBatch(nextBatchAudioTime);
      }, delayMs);
    }

    // Start looping
    scheduleBatch(startTime);

    // Attack ramp
    envelope.gain.setValueAtTime(0, startTime);
    envelope.gain.linearRampToValueAtTime(1, startTime + SWAP_FADE_SEC);

    const handle = {
      envelope,
      segments,
      get batchTimer() { return batchTimer; },

      stopScheduling() {
        stopped = true;
        if (batchTimer) {
          clearTimeout(batchTimer);
          batchTimer = null;
        }
        for (const id of segTimers) {
          clearTimeout(id);
        }
        segTimers.clear();
      },

      /**
       * Fades out and disposes after the tail completes.
       */
      fadeOutAndDispose() {
        this.stopScheduling();

        const now = Tone.now();

        // Freeze segment gains at current level
        for (const seg of segments) {
          if (!seg.gain) continue;
          const g = seg.gain.gain;
          g.cancelScheduledValues(now);
          g.setValueAtTime(g.value, now);
        }

        // Release ramp on outer envelope
        envelope.gain.cancelScheduledValues(now);
        envelope.gain.setValueAtTime(envelope.gain.value, now);
        envelope.gain.linearRampToValueAtTime(0, now + SWAP_FADE_SEC);

        // Dispose after tail
        setTimeout(() => {
          for (const seg of segments) {
            try { seg.source.stop(); } catch (_) {}
            seg.source.dispose();
            if (seg.gain) seg.gain.dispose();
          }
          segments.clear();
          envelope.dispose();
        }, (SWAP_FADE_SEC + 0.5) * 1000);
      },
    };

    return handle;
  }

  /**
   * Loads a texture buffer and starts looping it.
   * @param {number} [excludeIndex] - Texture index to avoid repeating
   */
  async function loadAndStart(excludeIndex) {
    const { url, index } = pickRandomTexture(excludeIndex);
    currentIndex = index;

    const label = `texturesNew${String(index).padStart(2, '0')}.wav`;
    console.log(`[sampleTexture] loading ${label}`);

    try {
      const buffer = await new Promise((resolve, reject) => {
        const buf = new Tone.ToneAudioBuffer(
          url,
          () => resolve(buf),
          (err) => reject(err),
        );
      });

      if (swapPending) return; // another swap happened before we loaded

      const now = Tone.now() + 0.05;
      activeLoop = startLoop(buffer, now);
      console.log(
        `[sampleTexture] playing ${label} ` +
        `(loop ${LOOP_START}–${LOOP_END}s, xfade ${CROSSFADE.toFixed(2)}s, stride ${STRIDE.toFixed(2)}s)`
      );
    } catch (err) {
      console.error(`[sampleTexture] failed to load ${label}:`, err);
    }
  }

  const api = {
    /**
     * Starts the texture layer with a random file.
     */
    async start() {
      if (activeLoop) return;
      await loadAndStart();
    },

    /**
     * Stops the texture layer with a fade-out.
     */
    stop() {
      swapPending = false;
      if (activeLoop) {
        activeLoop.fadeOutAndDispose();
        activeLoop = null;
      }
      currentIndex = null;
    },

    /**
     * Crossfades to a new random texture file (for song cycle transitions).
     */
    async swap() {
      swapPending = true;

      // Fade out current
      if (activeLoop) {
        activeLoop.fadeOutAndDispose();
        activeLoop = null;
      }

      swapPending = false;
      await loadAndStart(currentIndex);
    },

    dispose() {
      this.stop();
    },
  };

  return api;
}
