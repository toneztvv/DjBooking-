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
    const code = data.error && data.error.error_code;
    // These codes just mean "this clip had nothing fingerprintable" — a
    // moment of silence between songs, crowd noise, a too-short sample.
    // Expected during normal polling, not a real problem.
    const recoverableCodes = [300, 400, 500, 600, 700];
    if (recoverableCodes.includes(code)) {
      return null;
    }
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
