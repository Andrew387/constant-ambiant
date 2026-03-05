import { FREESOUND_API_KEY, SEARCH_QUERIES } from './config.js';

const API_BASE = 'https://freesound.org/apiv2';
const CACHE_MIN = 5;
const PAGE_SIZE = 15;
const MAX_PAGES = 5;

let cache = [];          // Array of { id, name, previewUrl }
let usedIds = new Set();
let fetching = false;

function randomQuery() {
  return SEARCH_QUERIES[Math.floor(Math.random() * SEARCH_QUERIES.length)];
}

/**
 * Fetches a page of short sound effects from Freesound.
 * Filters to sounds under 10 seconds for quick loading and punchy SFX.
 * If the randomly chosen page 404s (beyond total pages), retries with page 1.
 */
async function searchSounds(query) {
  let page = Math.floor(Math.random() * MAX_PAGES) + 1;

  for (let attempt = 0; attempt < 2; attempt++) {
    const params = new URLSearchParams({
      query,
      token: FREESOUND_API_KEY,
      fields: 'id,name,previews,duration',
      page_size: PAGE_SIZE,
      page,
      filter: 'duration:[0 TO 10]',
    });

    const res = await fetch(`${API_BASE}/search/text/?${params}`);
    if (res.status === 404 && page > 1) {
      // Page out of range — retry with page 1
      page = 1;
      continue;
    }
    if (!res.ok) {
      console.warn(`[freesound] search failed (${res.status}): ${query}`);
      return [];
    }

    const data = await res.json();
    if (!data.results || data.results.length === 0) return [];

    return data.results
      .filter(r => r.previews && r.previews['preview-lq-mp3'])
      .map(r => ({
        id: r.id,
        name: r.name,
        previewUrl: r.previews['preview-lq-mp3'],
      }));
  }

  return [];
}

/**
 * Refills the cache with fresh sounds from random queries.
 * Skips sounds we've already used recently.
 */
async function refillCache() {
  if (fetching) return;
  fetching = true;

  try {
    // Try up to 3 different queries to fill the cache
    for (let attempt = 0; attempt < 3 && cache.length < CACHE_MIN; attempt++) {
      const query = randomQuery();
      const results = await searchSounds(query);

      for (const sound of results) {
        if (!usedIds.has(sound.id)) {
          cache.push(sound);
        }
      }
    }

    // If usedIds grows too large, trim old entries
    if (usedIds.size > 200) {
      usedIds = new Set([...usedIds].slice(-50));
    }
  } catch (err) {
    console.warn('[freesound] refill error:', err);
  } finally {
    fetching = false;
  }
}

/**
 * Returns a random sound from the cache.
 * Triggers a background refill if cache is low.
 *
 * @returns {Promise<{ id: number, name: string, previewUrl: string } | null>}
 */
export async function getRandomSound() {
  // Ensure we have sounds available
  if (cache.length === 0) {
    await refillCache();
  }

  if (cache.length === 0) {
    console.warn('[freesound] cache empty after refill');
    return null;
  }

  // Pick a random sound from cache
  const idx = Math.floor(Math.random() * cache.length);
  const sound = cache.splice(idx, 1)[0];
  usedIds.add(sound.id);

  // Refill in background if running low
  if (cache.length < CACHE_MIN) {
    refillCache();
  }

  return sound;
}

export function getCacheSize() {
  return cache.length;
}
