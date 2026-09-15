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

module.exports = { fetchArtworkUrl };
