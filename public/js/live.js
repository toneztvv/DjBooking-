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

  const chatWrap = document.getElementById('chat-wrap');
  const chatLog = document.getElementById('chat-log');
  const chatEmpty = document.getElementById('chat-empty');
  const chatError = document.getElementById('chat-error');
  const chatForm = document.getElementById('chat-form');
  const chatMessageInput = document.getElementById('chat-message');
  let lastChatId = 0;
  let chatPollTimer = null;

  const CHAT_CLIENT_ID_KEY = 'djxpress_chat_client_id';
  function getChatClientId() {
    try {
      let id = localStorage.getItem(CHAT_CLIENT_ID_KEY);
      if (!id) {
        id = (window.crypto && window.crypto.randomUUID) ? window.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        localStorage.setItem(CHAT_CLIENT_ID_KEY, id);
      }
      return id;
    } catch (err) {
      // Private browsing / storage disabled — chat still works, just can't be re-identified if banned and rejoining.
      return null;
    }
  }

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
        <td><strong>${escapeHtml(r.song_title)}</strong>${r.artist ? `<br><span class="small-muted">${escapeHtml(r.artist)}</span>` : ''}${r.accepted ? '<br><span class="badge badge-booked">&#10003; Accepted</span>' : ''}</td>
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

  function renderChatMessages(messages) {
    if (!messages || !messages.length) return;
    const atBottom = chatLog.scrollHeight - chatLog.scrollTop - chatLog.clientHeight < 40;

    messages.forEach((m) => {
      if (m.id <= lastChatId) return;
      lastChatId = Math.max(lastChatId, m.id);

      const bubble = document.createElement('div');
      bubble.className = 'chat-bubble' + (m.is_dj ? ' chat-bubble-dj' : '');
      bubble.innerHTML = `
        <span class="chat-sender">${escapeHtml(m.is_dj ? 'DJ' : m.sender_name)}</span>
        <span class="chat-text">${escapeHtml(m.message)}</span>
        <span class="chat-time">${formatTime(m.created_at)}</span>`;
      chatLog.appendChild(bubble);
    });

    chatEmpty.style.display = chatLog.childElementCount ? 'none' : 'block';
    if (atBottom) chatLog.scrollTop = chatLog.scrollHeight;
  }

  async function pollChat() {
    if (!chatWrap) return;
    try {
      const res = await fetch(`/api/chat?afterId=${lastChatId}`, { headers: { Accept: 'application/json' } });
      if (!res.ok) return;
      const data = await res.json();
      chatWrap.style.display = data.isLive ? 'block' : 'none';
      renderChatMessages(data.messages);
    } catch (err) {
      // Silently retry on next interval.
    }
  }

  if (chatForm) {
    chatForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      chatError.style.display = 'none';

      const submitBtn = chatForm.querySelector('button[type="submit"]');
      submitBtn.disabled = true;

      const message = chatMessageInput.value.trim();

      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message, client_id: getChatClientId() }),
        });
        const data = await res.json();

        if (res.ok && data.ok) {
          chatMessageInput.value = '';
          chatMessageInput.focus();
          pollChat();
        } else {
          chatError.textContent = data.error || 'Something went wrong. Please try again.';
          chatError.style.display = 'block';
        }
      } catch (err) {
        chatError.textContent = 'Network error. Please try again.';
        chatError.style.display = 'block';
      } finally {
        submitBtn.disabled = false;
      }
    });
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

  if (chatWrap) {
    pollChat();
    chatPollTimer = setInterval(pollChat, 3000);
  }
})();
