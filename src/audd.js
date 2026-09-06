// Wraps AudD's music recognition API (https://audd.io) for the auto
// song-detection feature. Given a short audio clip, returns the
// recognized { title, artist } or null if nothing matched.

async function recognizeAudio(buffer, mimeType) {
  const apiKey = process.env.AUDD_API_KEY;
  if (!apiKey) {
    const err = new Error('AUDD_API_KEY is not configured');
    err.code = 'NOT_CONFIGURED';
    throw err;
  }

  const form = new FormData();
  form.append('api_token', apiKey);
  form.append(
    'file',
    new Blob([buffer], { type: mimeType || 'audio/webm' }),
    'sample.webm'
  );

  const res = await fetch('https://api.audd.io/', {
    method: 'POST',
    body: form,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`AudD API error ${res.status}: ${text}`);
  }

  const data = await res.json();

  if (data.status !== 'success') {
    throw new Error(`AudD API returned an error: ${JSON.stringify(data)}`);
  }

  if (!data.result) {
    return null;
  }

  return {
    title: data.result.title || null,
    artist: data.result.artist || null,
  };
}

module.exports = { recognizeAudio };
