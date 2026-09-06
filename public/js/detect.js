(function () {
  const startBtn = document.getElementById('detect-start-btn');
  const stopBtn = document.getElementById('detect-stop-btn');
  const statusEl = document.getElementById('detect-status');

  if (!startBtn || !stopBtn || !statusEl) return;

  const RECORD_MS = 7000;
  const BASE_INTERVAL_MS = 30000;
  const MAX_INTERVAL_MS = 90000;

  let stream = null;
  let listening = false;
  let paused = false;
  let currentIntervalMs = BASE_INTERVAL_MS;
  let lastDetectedKey = null;
  let cycleTimer = null;
  let wakeLock = null;

  async function requestWakeLock() {
    if (!('wakeLock' in navigator)) return;
    try {
      wakeLock = await navigator.wakeLock.request('screen');
    } catch (err) {
      // Not fatal — screen may just dim/lock on its own, which will pause
      // detection via the visibilitychange handler below.
    }
  }

  function setStatus(text, tone) {
    statusEl.textContent = text;
    statusEl.className = 'small-muted';
    if (tone === 'error') statusEl.style.color = 'var(--danger, #f87171)';
    else if (tone === 'good') statusEl.style.color = 'var(--success, #34d399)';
    else statusEl.style.color = '';
  }

  function normKey(title, artist) {
    return (title + '::' + (artist || '')).trim().toLowerCase();
  }

  function stopListening(message, tone) {
    listening = false;
    paused = false;
    if (cycleTimer) clearTimeout(cycleTimer);
    cycleTimer = null;
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      stream = null;
    }
    if (wakeLock) {
      wakeLock.release().catch(() => {});
      wakeLock = null;
    }
    startBtn.hidden = false;
    stopBtn.hidden = true;
    if (message) setStatus(message, tone);
  }

  // Phones (and to a lesser extent laptops) suspend mic access the moment
  // this tab is backgrounded — switching apps, locking the screen, even
  // briefly. There's no way around that from a website; the best we can do
  // is pause cleanly and say so, then pick back up the moment it's visible
  // again, rather than silently failing or wasting API calls on a doomed
  // recording.
  document.addEventListener('visibilitychange', () => {
    if (!listening) return;

    if (document.hidden) {
      paused = true;
      if (cycleTimer) clearTimeout(cycleTimer);
      cycleTimer = null;
      setStatus('Paused — bring this tab back to the front to keep listening.', 'error');
    } else if (paused) {
      paused = false;
      requestWakeLock();
      setStatus('Resuming…');
      runCycle();
    }
  });

  function recordOnce() {
    return new Promise((resolve, reject) => {
      const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '';
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      const chunks = [];

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunks.push(e.data);
      };
      recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType || 'audio/webm' }));
      recorder.onerror = (e) => reject(e.error || new Error('Recording failed'));

      recorder.start();
      setTimeout(() => {
        if (recorder.state !== 'inactive') recorder.stop();
      }, RECORD_MS);
    });
  }

  async function runCycle() {
    if (!listening) return;

    try {
      setStatus('Listening…');
      const blob = await recordOnce();
      if (!listening) return;

      const formData = new FormData();
      formData.append('audio', blob, 'sample.webm');

      const res = await fetch('/admin/detect/sample', { method: 'POST', body: formData });
      const data = await res.json().catch(() => ({}));

      if (res.status === 409) {
        stopListening('Event is no longer live — stopped listening.', 'error');
        return;
      }
      if (res.status === 503) {
        stopListening(data.error || 'Song detection is not set up yet.', 'error');
        return;
      }

      if (data.ok && data.match) {
        const key = normKey(data.title, data.artist);
        const label = data.artist ? `${data.title} — ${data.artist}` : data.title;

        if (key === lastDetectedKey) {
          currentIntervalMs = Math.min(currentIntervalMs * 1.5, MAX_INTERVAL_MS);
          setStatus(`Still playing: ${label}`, 'good');
        } else {
          currentIntervalMs = BASE_INTERVAL_MS;
          lastDetectedKey = key;
          const note =
            data.action === 'matched_request'
              ? 'matched a request'
              : data.action === 'logged_dj_pick'
              ? 'added to setlist'
              : '';
          setStatus(`Now playing: ${label}${note ? ' — ' + note : ''}`, 'good');
        }
      } else if (data.ok) {
        currentIntervalMs = BASE_INTERVAL_MS;
        setStatus('Listening… (nothing recognized that cycle)');
      } else {
        setStatus(data.error || 'Detection hiccup — retrying…', 'error');
      }
    } catch (err) {
      setStatus('Network hiccup — retrying…', 'error');
    }

    if (listening) {
      cycleTimer = setTimeout(runCycle, currentIntervalMs);
    }
  }

  startBtn.addEventListener('click', async () => {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      setStatus('Microphone permission denied — allow mic access to use auto-detect.', 'error');
      return;
    }

    listening = true;
    paused = false;
    currentIntervalMs = BASE_INTERVAL_MS;
    lastDetectedKey = null;
    startBtn.hidden = true;
    stopBtn.hidden = false;
    requestWakeLock();
    runCycle();
  });

  stopBtn.addEventListener('click', () => {
    stopListening('Stopped listening.');
  });
})();
