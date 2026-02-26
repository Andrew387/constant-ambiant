/**
 * Fetches random audio items from the Internet Archive API.
 * Caches discovered URLs so there's always a pool to draw from,
 * even if subsequent API calls fail. Retries on failure.
 */

const SEARCH_QUERIES = [
  // Field recordings & nature
  'field recording ambient',
  'nature sounds ambient',
  'environmental soundscape',
  'ocean waves rain',
  'birdsong forest',
  'thunder storm recording',
  'river stream water sounds',
  'wind howling field recording',
  'underwater hydrophone recording',
  'desert night sounds',
  'swamp marsh sounds',
  'cave ambience recording',
  'rainforest canopy sounds',
  'arctic wind ice sounds',
  // Urban & industrial
  'city street ambience recording',
  'train station platform sounds',
  'harbor port ship sounds',
  'factory machinery ambient',
  'industrial noise texture',
  'subway underground ambience',
  // Musical & tonal
  'drone ambient music',
  'atmospheric sound',
  'synthesizer meditation',
  'tibetan singing bowls',
  'organ cathedral',
  'gamelan percussion',
  'choral sacred music',
  'classical piano solo',
  'harmonium drone sustained',
  'crystal singing bowls meditation',
  'oud traditional instrumental',
  'kora west african music',
  'shakuhachi flute bamboo',
  'sitar raga instrumental',
  'didgeridoo drone aboriginal',
  'hang drum handpan ambient',
  'church bells carillon',
  'kalimba thumb piano',
  // Experimental & texture
  'experimental electronic',
  'tape loop ambient',
  'musique concrete experimental',
  'shortwave radio static recording',
  'electromagnetic field recording',
];

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

/** Cache of discovered audio entries: { url, title, identifier }[] */
let cache = [];
/** Set of URLs already played, to avoid immediate repeats */
let played = new Set();
/** Set of Archive.org identifiers already in cache, to avoid clustering */
let cachedIdentifiers = new Set();

/**
 * Single attempt to fetch audio items from Archive.org.
 * On success, adds ALL found audio entries to the cache (not just the one returned).
 * @returns {Promise<{ url: string, title: string } | null>}
 */
async function fetchOnce() {
  const query = SEARCH_QUERIES[Math.floor(Math.random() * SEARCH_QUERIES.length)];
  const page = Math.floor(Math.random() * 5) + 1;


  const searchUrl = `https://archive.org/advancedsearch.php?q=${encodeURIComponent(query)}&fl=identifier,title&sort=downloads+desc&rows=15&page=${page}&output=json`;

  const response = await fetch(searchUrl);
  if (!response.ok) {
    console.warn(`[archive/fetcher] search failed: ${response.status}`);
    return null;
  }

  const data = await response.json();
  const docs = (data?.response?.docs || []).filter(item => {
    const text = `${item.identifier || ''} ${item.title || ''}`.toLowerCase();
    return !text.includes('grateful dead') && !text.includes('gratefuldead')
      && !/(\b)gd\d{2,4}/.test(text);
  });
  if (docs.length === 0) return null;

  // Resolve audio files for multiple items to fill the cache
  const resolved = [];
  // Shuffle docs so we explore different items each time
  const shuffled = [...docs].sort(() => Math.random() - 0.5);

  for (const item of shuffled.slice(0, 5)) {
    // Skip items we already have in cache to maximize variety
    if (cachedIdentifiers.has(item.identifier)) continue;
    const entries = await resolveItemAudio(item);
    if (entries.length > 0) {
      // Pick only 1 random file per item to avoid clustering similar recordings
      const pick = entries[Math.floor(Math.random() * entries.length)];
      resolved.push(pick);
      cachedIdentifiers.add(item.identifier);
    }
  }

  if (resolved.length === 0) return null;

  // Add all resolved entries to cache (deduplicated)
  const existingUrls = new Set(cache.map(e => e.url));
  for (const entry of resolved) {
    if (!existingUrls.has(entry.url)) {
      cache.push(entry);
      existingUrls.add(entry.url);
    }
  }

  // Return one that hasn't been played yet
  return pickFromCache();
}

/**
 * Resolves audio file URLs for a single Archive.org item.
 * @returns {Promise<{ url: string, title: string }[]>}
 */
async function resolveItemAudio(item) {
  const identifier = item.identifier;
  const itemTitle = item.title || identifier;

  try {
    const metaUrl = `https://archive.org/metadata/${identifier}/files`;
    const metaResponse = await fetch(metaUrl);
    if (!metaResponse.ok) return [];

    const metaData = await metaResponse.json();
    const audioFiles = (metaData.result || []).filter(f =>
      f.name && (f.name.endsWith('.mp3') || f.name.endsWith('.ogg'))
    );

    return audioFiles.map(f => {
      const trackName = f.title || f.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ');
      return {
        url: `https://archive.org/download/${identifier}/${encodeURIComponent(f.name)}`,
        title: `${itemTitle} — ${trackName}`,
        identifier,
      };
    });
  } catch {
    return [];
  }
}

/**
 * Picks a random entry from the cache, preferring unplayed ones.
 * @returns {{ url: string, title: string } | null}
 */
/** Identifier of the last played track, to avoid back-to-back same-source */
let lastPlayedIdentifier = null;

function pickFromCache() {
  if (cache.length === 0) return null;

  // Prefer entries that haven't been played AND are from a different source
  const unplayed = cache.filter(e => !played.has(e.url));
  let pool = unplayed.length > 0 ? unplayed : cache;

  // If all have been played, reset the played set
  if (unplayed.length === 0) {
    played.clear();
  }

  // Avoid picking from the same identifier as last played
  if (lastPlayedIdentifier && pool.length > 1) {
    const different = pool.filter(e => e.identifier !== lastPlayedIdentifier);
    if (different.length > 0) pool = different;
  }

  const entry = pool[Math.floor(Math.random() * pool.length)];
  played.add(entry.url);
  lastPlayedIdentifier = entry.identifier;
  return entry;
}

/**
 * Fetches a random audio file URL and title from Archive.org.
 * Retries on failure and falls back to cached entries.
 *
 * @returns {Promise<{ url: string, title: string } | null>}
 */
export async function fetchRandomArchiveAudio() {
  // First, try to serve from cache if we have unplayed entries
  if (cache.length > 3) {
    const cached = pickFromCache();
    if (cached) {
      // Refill cache in the background (fire and forget)
      fetchOnce().catch(() => {});
      return cached;
    }
  }

  // Otherwise fetch with retries
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const result = await fetchOnce();
      if (result) return result;
    } catch (err) {
      console.warn('[archive] fetch error:', err);
    }

    // Fall back to cache between retries
    if (cache.length > 0) {
      return pickFromCache();
    }

    // Wait before retrying
    if (attempt < MAX_RETRIES) {
      await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
    }
  }

  // Final fallback to cache
  if (cache.length > 0) {
    return pickFromCache();
  }

  console.error('[archive] all fetch retries failed and cache is empty');
  return null;
}

/**
 * Returns the current cache size (for debug display).
 */
export function getCacheSize() {
  return cache.length;
}
