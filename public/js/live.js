(function () {
  const statusDot = document.getElementById('live-status-dot');
  const statusLabel = document.getElementById('live-status-label');
  const eventNameEl = document.getElementById('live-event-name');
  const requestForm = document.getElementById('request-form');
  const requestFormWrap = document.getElementById('request-form-wrap');
  const offlineNotice = document.getElementById('offline-notice');
  const pendingBody = document.getElementById('pending-body');
  const pendingEmpty = document.getElementById('pending-empty');
  const playedBody = document.getElementById('played-body');
  const playedEmpty = document.getElementById('played-empty');
  const formMessage = document.getElementById('form-message');

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }

  function formatTime(isoLike) {
    if (!isoLike) return '';
    // SQLite datetime('now') returns "YYYY-MM-DD HH:MM:SS" in UTC.
    const iso = isoLike.includes('T') ? isoLike : isoLike.replace(' ', 'T') + 'Z';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return isoLike;
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function renderPending(rows) {
    if (!rows.length) {
      pendingBody.innerHTML = '';
      pendingEmpty.style.display = 'block';
      return;
    }
    pendingEmpty.style.display = 'none';
    pendingBody.innerHTML = rows
      .map(
        (r) => `
      <tr>
        <td><strong>${escapeHtml(r.song_title)}</strong>${r.artist ? `<br><span class="small-muted">${escapeHtml(r.artist)}</span>` : ''}</td>
        <td>${escapeHtml(r.requesters)}</td>
        <td>${formatTime(r.first_requested_at)}</td>
        <td><span class="count-pill">${r.times_requested}</span></td>
      </tr>`
      )
      .join('');
  }

  function renderPlayed(rows) {
    if (!rows.length) {
      playedBody.innerHTML = '';
      playedEmpty.style.display = 'block';
      return;
    }
    playedEmpty.style.display = 'none';
    playedBody.innerHTML = rows
      .map(
        (r) => `
      <tr>
        <td><strong>${escapeHtml(r.song_title)}</strong>${r.artist ? `<br><span class="small-muted">${escapeHtml(r.artist)}</span>` : ''}</td>
        <td>${escapeHtml(r.requesters)}</td>
        <td>${formatTime(r.played_at)}</td>
        <td><span class="count-pill">${r.times_requested}</span></td>
      </tr>`
      )
      .join('');
  }

  async function refresh() {
    try {
      const res = await fetch('/api/live-state', { headers: { Accept: 'application/json' } });
      if (!res.ok) return;
      const data = await res.json();

      const isLive = !!data.isLive;
      statusDot.classList.toggle('offline', !isLive);
      statusLabel.textContent = isLive ? 'LIVE NOW' : 'OFFLINE';
      statusLabel.classList.toggle('offline', !isLive);

      if (eventNameEl) {
        eventNameEl.textContent = isLive && data.eventName ? data.eventName : '';
        eventNameEl.style.display = isLive && data.eventName ? 'block' : 'none';
      }

      if (requestFormWrap && offlineNotice) {
        requestFormWrap.style.display = isLive ? 'block' : 'none';
        offlineNotice.style.display = isLive ? 'none' : 'block';
      }

      renderPending(data.pending || []);
      renderPlayed(data.recentlyPlayed || []);
    } catch (err) {
      // Silently retry on next interval; avoid spamming the console on flaky mobile connections.
    }
  }

  if (requestForm) {
    requestForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      formMessage.textContent = '';
      formMessage.className = '';

      const submitBtn = requestForm.querySelector('button[type="submit"]');
      submitBtn.disabled = true;

      const formData = new FormData(requestForm);
      const payload = Object.fromEntries(formData.entries());

      try {
        const res = await fetch('/api/requests', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await res.json();

        if (res.ok && data.ok) {
          formMessage.textContent = 'Request sent! Keep an eye on the board below.';
          formMessage.className = 'alert alert-success';
          requestForm.reset();
          refresh();
        } else {
          formMessage.textContent = data.error || 'Something went wrong. Please try again.';
          formMessage.className = 'alert alert-error';
        }
      } catch (err) {
        formMessage.textContent = 'Network error. Please try again.';
        formMessage.className = 'alert alert-error';
      } finally {
        submitBtn.disabled = false;
      }
    });
  }

  refresh();
  setInterval(refresh, 5000);
})();
