// Free, keyless lookup against iTunes's public search API — good enough
// for "does this song have a recognizable cover" without another paid
// integration. Fails silently; a missing cover just means no artwork,
// never a broken page.
async function fetchArtworkUrl(title, artist) {
  try {
    const term = `${title} ${artist || ''}`.trim();
    const url = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=song&limit=1`;
    const res = await fetch(url);
    if (!res.ok) return null;

    const data = await res.json();
    const track = data.results && data.results[0];
    if (!track || !track.artworkUrl100) return null;

    return track.artworkUrl100.replace('100x100', '300x300');
  } catch (err) {
    return null;
  }
}

// Song suggestions as a guest types ("Bail…" -> "Bailando — Enrique Iglesias").
// Results are cached for a few minutes so a party typing the same hits doesn't
// hammer iTunes, and any failure just means "no suggestions", never an error.
const searchCache = new Map();
const SEARCH_TTL_MS = 10 * 60 * 1000;

async function searchSongs(query) {
  const q = String(query || '').trim().slice(0, 80);
  if (q.length < 2) return [];
  const key = q.toLowerCase();
  const hit = searchCache.get(key);
  if (hit && Date.now() - hit.at < SEARCH_TTL_MS) return hit.results;

  try {
    const url = `https://itunes.apple.com/search?term=${encodeURIComponent(q)}&entity=song&limit=12`;
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return [];
    const data = await res.json();
    const seen = new Set();
    const results = [];
    for (const t of data.results || []) {
      if (!t.trackName || !t.artistName) continue;
      const dedupe = `${t.trackName}::${t.artistName}`.toLowerCase();
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
      results.push({
        title: String(t.trackName).slice(0, 150),
        artist: String(t.artistName).slice(0, 150),
        artwork: typeof t.artworkUrl60 === 'string' && /^https:\/\//.test(t.artworkUrl60) ? t.artworkUrl60 : '',
      });
      if (results.length >= 6) break;
    }
    if (searchCache.size > 500) searchCache.clear();
    searchCache.set(key, { at: Date.now(), results });
    return results;
  } catch (err) {
    return [];
  }
}

module.exports = { fetchArtworkUrl, searchSongs };
