import { fetchRandomArchiveAudio, getCacheSize } from './fetcher.js';
import { processArchiveAudio } from './processor.js';
import { updateArchiveStatus } from '../ui/debug.js';

let activeTrack = null;
let pendingTrack = null;
let isActive = false;
let crossfadeTimer = null;

const CROSSFADE_DURATION = 12; // seconds
const LOAD_RETRIES = 3;
const LOAD_RETRY_DELAY_MS = 3000;

/**
 * Loads a track (fetch URL + process audio). Retries on failure.
 * Does NOT start playback.
 */
async function loadTrack(destination) {
  for (let attempt = 1; attempt <= LOAD_RETRIES; attempt++) {
    const result = await fetchRandomArchiveAudio();
    if (!result) {
      if (attempt < LOAD_RETRIES) {
        await new Promise(r => setTimeout(r, LOAD_RETRY_DELAY_MS));
      }
      continue;
    }

    const { url, title } = result;
    const processed = await processArchiveAudio(url, destination);
    if (!processed) {
      if (attempt < LOAD_RETRIES) {
        await new Promise(r => setTimeout(r, LOAD_RETRY_DELAY_MS));
      }
      continue;
    }

    return { ...processed, title, targetVolume: processed.player.volume.value };
  }

  console.warn('[archive] all load attempts failed');
  return null;
}

function fadeIn(track) {
  track.player.volume.value = -60;
  track.player.start();
  track.player.volume.rampTo(track.targetVolume, CROSSFADE_DURATION);
}

function fadeOutAndDispose(track) {
  if (!track) return;
  track.player.volume.rampTo(-60, CROSSFADE_DURATION);
  setTimeout(() => {
    try {
      track.player.stop();
      track.player.dispose();
      track.highpass.dispose();
      track.filter.dispose();
      track.reverb.dispose();
    } catch (err) {
    }
  }, (CROSSFADE_DURATION + 1) * 1000);
}

function statusText() {
  const lines = [];
  if (activeTrack) lines.push(`Playing: ${activeTrack.title}`);
  if (pendingTrack) lines.push(`Next: ${pendingTrack.title}`);
  lines.push(`Cache: ${getCacheSize()} tracks`);
  return lines.join('\n');
}

/**
 * Pre-fetches the next track while the current one is still playing.
 */
async function prefetchNext(destination) {
  if (!isActive || pendingTrack) return;

  safeUpdateStatus(statusText() + '\nPre-loading next...');

  const track = await loadTrack(destination);
  if (!track || !isActive) {
    safeUpdateStatus(statusText() + '\nPre-fetch failed, will retry at crossfade');
    return;
  }

  pendingTrack = track;
  safeUpdateStatus(statusText());
}

/**
 * Crossfades from active to pending, then pre-fetches another.
 */
function crossfade(destination) {
  if (!isActive) return;

  if (activeTrack) {
    fadeOutAndDispose(activeTrack);
    activeTrack = null;
  }

  if (pendingTrack) {
    activeTrack = pendingTrack;
    pendingTrack = null;
    fadeIn(activeTrack);
    safeUpdateStatus(statusText());
  } else {
    // No pending track ready — load one now (blocking crossfade)
    safeUpdateStatus('Loading track...');
    loadTrack(destination).then(track => {
      if (!track || !isActive) return;
      activeTrack = track;
      fadeIn(activeTrack);
      safeUpdateStatus(statusText());
      prefetchNext(destination);
    });
  }

  prefetchNext(destination);
  scheduleCrossfade(destination);
}

function scheduleCrossfade(destination) {
  if (!isActive) return;
  const delay = 90000 + Math.random() * 78000; // 1.5–2.8 min (caps playback under 3 min with crossfade)
  crossfadeTimer = setTimeout(() => crossfade(destination), delay);
}

/**
 * Starts the Archive.org ambient texture layer.
 */
export async function startArchiveLayer(destination) {
  if (isActive) {
    return;
  }
  isActive = true;
  safeUpdateStatus('Fetching first track...');

  const track = await loadTrack(destination);
  if (!track || !isActive) {
    console.warn('[archive] failed to load first track, retrying...');
    safeUpdateStatus('Failed to load (will keep retrying)');
    // Schedule a retry instead of giving up
    setTimeout(() => {
      if (isActive) {
        isActive = false; // reset so startArchiveLayer can re-enter
        startArchiveLayer(destination);
      }
    }, 10000);
    return;
  }

  activeTrack = track;
  fadeIn(activeTrack);
  safeUpdateStatus(statusText());

  prefetchNext(destination);
  scheduleCrossfade(destination);
}

/**
 * Stops the archive layer with a fade-out.
 */
export async function stopArchiveLayer() {
  isActive = false;

  if (crossfadeTimer) {
    clearTimeout(crossfadeTimer);
    crossfadeTimer = null;
  }

  if (activeTrack) {
    fadeOutAndDispose(activeTrack);
    activeTrack = null;
  }
  if (pendingTrack) {
    try {
      pendingTrack.player.dispose();
      pendingTrack.highpass.dispose();
      pendingTrack.filter.dispose();
      pendingTrack.reverb.dispose();
    } catch (err) {
    }
    pendingTrack = null;
  }

  safeUpdateStatus('Stopped');
}

function safeUpdateStatus(msg) {
  try {
    updateArchiveStatus(msg);
  } catch {
    // debug panel not initialized yet
  }
}
