import * as Tone from 'tone';
import { getRandomSound, getCacheSize } from './fetcher.js';
import { updateFreesoundStatus } from '../ui/debug.js';

let isActive = false;
let triggerTimer = null;
let destination = null;
let activeNodes = [];  // Track nodes for cleanup
let totalPlayed = 0;

const MIN_INTERVAL_MS = 2000;
const MAX_INTERVAL_MS = 10000;
const REVERB_DECAY = 20;
const REVERB_WET = 0.9;
const REVERB_TAIL_EXTRA = 25; // seconds to wait after play before disposing

function safeUpdateStatus(msg) {
  try {
    updateFreesoundStatus(msg);
  } catch {
    // debug panel not initialized yet
  }
}

function statusText(extra) {
  const lines = [];
  lines.push(`Played: ${totalPlayed} sounds`);
  lines.push(`Active: ${activeNodes.length} (with reverb tails)`);
  lines.push(`Cache: ${getCacheSize()} sounds`);
  if (extra) lines.push(extra);
  return lines.join('\n');
}

/**
 * Plays a single sound effect with deep reverb, then disposes all nodes
 * after the reverb tail fades out.
 */
async function playSoundEffect() {
  if (!isActive) return;

  try {
    safeUpdateStatus(statusText('Fetching sound...'));
    const sound = await getRandomSound();
    if (!sound || !isActive) {
      safeUpdateStatus(statusText('Fetch failed, retrying...'));
      scheduleNext();
      return;
    }

    safeUpdateStatus(statusText(`Loading: "${sound.name}"`));

    const player = new Tone.Player({
      url: sound.previewUrl,
      volume: -12,
      onload: () => {
        if (!isActive) {
          player.dispose();
          return;
        }

        // Build per-sound effect chain: player → lowpass → reverb → destination
        const filter = new Tone.Filter({
          type: 'lowpass',
          frequency: 2500,
          Q: 0.5,
        });

        const reverb = new Tone.Reverb({
          decay: REVERB_DECAY,
          preDelay: 0.5,
          wet: REVERB_WET,
        });

        const entry = { player, filter, reverb, name: sound.name, disposed: false };
        activeNodes.push(entry);

        reverb.generate().then(() => {
          if (entry.disposed || !isActive) {
            disposeEntry(entry);
            return;
          }

          player.connect(filter);
          filter.connect(reverb);
          reverb.connect(destination);

          player.start();
          totalPlayed++;
          console.log(`[freesound] playing: "${sound.name}"`);
          safeUpdateStatus(statusText(`Playing: "${sound.name}"`));

          // Dispose after reverb tail fades
          setTimeout(() => {
            disposeEntry(entry);
            safeUpdateStatus(statusText());
          }, REVERB_TAIL_EXTRA * 1000);
        });
      },
      onerror: (err) => {
        console.warn(`[freesound] load error for "${sound.name}":`, err);
        safeUpdateStatus(statusText(`Load error: "${sound.name}"`));
      },
    });
  } catch (err) {
    console.warn('[freesound] playSoundEffect error:', err);
    safeUpdateStatus(statusText('Error, retrying...'));
  }

  scheduleNext();
}

function disposeEntry(entry) {
  if (entry.disposed) return;
  entry.disposed = true;

  try {
    entry.player.stop();
  } catch {}
  try { entry.player.dispose(); } catch {}
  try { entry.filter.dispose(); } catch {}
  try { entry.reverb.dispose(); } catch {}

  activeNodes = activeNodes.filter(e => e !== entry);
}

function scheduleNext() {
  if (!isActive) return;
  const delay = MIN_INTERVAL_MS + Math.random() * (MAX_INTERVAL_MS - MIN_INTERVAL_MS);
  triggerTimer = setTimeout(playSoundEffect, delay);
}

/**
 * Starts the Freesound SFX layer.
 * @param {Tone.ToneAudioNode} dest - Gain node to connect sounds to
 */
export function startFreesoundLayer(dest) {
  if (isActive) return;
  isActive = true;
  destination = dest;
  totalPlayed = 0;
  console.log('[freesound] starting');
  safeUpdateStatus('Starting...');

  // First sound after a short initial delay
  triggerTimer = setTimeout(playSoundEffect, 3000);
}

/**
 * Stops the Freesound SFX layer and cleans up all active audio nodes.
 */
export function stopFreesoundLayer() {
  console.log('[freesound] stopping');
  isActive = false;

  if (triggerTimer) {
    clearTimeout(triggerTimer);
    triggerTimer = null;
  }

  // Dispose all active sound nodes
  for (const entry of [...activeNodes]) {
    disposeEntry(entry);
  }
  activeNodes = [];
  safeUpdateStatus('Stopped');
}
