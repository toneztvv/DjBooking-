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
  let chatPollTimer = null;

  const guestCounterPill = document.getElementById('guest-counter-pill');
  const guestCounterCount = document.getElementById('guest-counter-count');

  const reactionsWrap = document.getElementById('reactions-wrap');
  const reactionCounts = document.getElementById('reaction-counts');
  const reactionFloatLayer = document.getElementById('reaction-float-layer');
  let lastReactionId = 0;

  const pollWrap = document.getElementById('poll-wrap');
  const pollQuestion = document.getElementById('poll-question');
  const pollLabelA = document.getElementById('poll-label-a');
  const pollLabelB = document.getElementById('poll-label-b');
  const pollFillA = document.getElementById('poll-fill-a');
  const pollFillB = document.getElementById('poll-fill-b');
  const pollBtnA = document.getElementById('poll-btn-a');
  const pollBtnB = document.getElementById('poll-btn-b');
  const pollVoteButtons = document.getElementById('poll-vote-buttons');
  const pollVotedNote = document.getElementById('poll-voted-note');

  const guestbookWrap = document.getElementById('guestbook-wrap');
  const guestbookList = document.getElementById('guestbook-list');
  const guestbookEmpty = document.getElementById('guestbook-empty');
  const guestbookError = document.getElementById('guestbook-error');
  const guestbookForm = document.getElementById('guestbook-form');
  const guestbookNameInput = document.getElementById('guestbook-name');
  const guestbookMessageInput = document.getElementById('guestbook-message');

  const CLIENT_ID_KEY = 'djxpress_client_id';
  function getClientId() {
    try {
      let id = localStorage.getItem(CLIENT_ID_KEY);
      if (!id) {
        id = (window.crypto && window.crypto.randomUUID) ? window.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        localStorage.setItem(CLIENT_ID_KEY, id);
      }
      return id;
    } catch (err) {
      return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
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

  // Full snapshot every poll (not incremental) so a message the DJ deletes
  // actually disappears here too, not just stop showing up going forward.
  function renderChatMessages(messages) {
    const currentIds = new Set((messages || []).map((m) => String(m.id)));

    Array.from(chatLog.children).forEach((el) => {
      if (!currentIds.has(el.dataset.id)) el.remove();
    });

    if (!messages || !messages.length) {
      chatEmpty.style.display = 'block';
      return;
    }

    const atBottom = chatLog.scrollHeight - chatLog.scrollTop - chatLog.clientHeight < 40;

    messages.forEach((m) => {
      if (chatLog.querySelector(`[data-id="${m.id}"]`)) return;

      const bubble = document.createElement('div');
      bubble.className = 'chat-bubble' + (m.is_dj ? ' chat-bubble-dj' : '');
      bubble.dataset.id = m.id;
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
      const res = await fetch('/api/chat', { headers: { Accept: 'application/json' } });
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
          body: JSON.stringify({ message }),
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

  // --- Live reactions ---------------------------------------------------

  function spawnFloatingReaction(emoji) {
    if (!reactionFloatLayer) return;
    const el = document.createElement('div');
    el.className = 'reaction-float';
    el.textContent = emoji;
    el.style.left = `${5 + Math.random() * 90}%`;
    el.style.setProperty('--drift', `${Math.round((Math.random() - 0.5) * 120)}px`);
    reactionFloatLayer.appendChild(el);
    setTimeout(() => el.remove(), 2800);
  }

  async function pollReactions() {
    if (!reactionsWrap) return;
    try {
      const res = await fetch(`/api/reactions?afterId=${lastReactionId}`, { headers: { Accept: 'application/json' } });
      if (!res.ok) return;
      const data = await res.json();

      (data.recent || []).forEach((r) => {
        lastReactionId = Math.max(lastReactionId, r.id);
        spawnFloatingReaction(r.emoji);
      });

      if (reactionCounts && data.counts) {
        const parts = Object.entries(data.counts).map(([emoji, n]) => `${emoji} ${n}`);
        reactionCounts.textContent = parts.join('   ');
      }
    } catch (err) {
      // Silently retry on next interval.
    }
  }

  document.querySelectorAll('.reaction-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      spawnFloatingReaction(btn.dataset.emoji);
      try {
        await fetch('/api/reactions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ emoji: btn.dataset.emoji }),
        });
        pollReactions();
      } catch (err) {
        // Ignore — the tap still animated locally.
      } finally {
        setTimeout(() => (btn.disabled = false), 300);
      }
    });
  });

  // --- Quick polls ---------------------------------------------------------

  let renderedPollId = null;

  function votedKey(pollId) {
    return `djxpress_poll_vote_${pollId}`;
  }

  function renderPoll(poll) {
    if (!pollWrap) return;
    if (!poll) {
      pollWrap.style.display = 'none';
      renderedPollId = null;
      return;
    }

    pollWrap.style.display = 'block';
    pollQuestion.textContent = poll.question;

    const total = poll.votesA + poll.votesB;
    const pctA = total ? Math.round((poll.votesA / total) * 100) : 0;
    const pctB = total ? Math.round((poll.votesB / total) * 100) : 0;
    pollLabelA.textContent = `${poll.optionA} — ${poll.votesA} (${pctA}%)`;
    pollLabelB.textContent = `${poll.optionB} — ${poll.votesB} (${pctB}%)`;
    pollFillA.style.width = `${pctA}%`;
    pollFillB.style.width = `${pctB}%`;
    pollBtnA.textContent = poll.optionA;
    pollBtnB.textContent = poll.optionB;

    if (renderedPollId !== poll.id) {
      renderedPollId = poll.id;
      let alreadyVoted = null;
      try {
        alreadyVoted = localStorage.getItem(votedKey(poll.id));
      } catch (err) {
        // ignore
      }
      pollVoteButtons.style.display = alreadyVoted ? 'none' : 'grid';
      pollVotedNote.style.display = alreadyVoted ? 'block' : 'none';
    }
  }

  async function votePoll(choice) {
    if (!renderedPollId) return;
    pollVoteButtons.style.display = 'none';
    pollVotedNote.style.display = 'block';
    try {
      await fetch(`/api/polls/${renderedPollId}/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ choice, client_id: getClientId() }),
      });
      try {
        localStorage.setItem(votedKey(renderedPollId), choice);
      } catch (err) {
        // ignore
      }
      refresh();
    } catch (err) {
      // Leave the "voted" UI as-is — worst case they just don't see a live count update.
    }
  }

  if (pollBtnA) pollBtnA.addEventListener('click', () => votePoll('a'));
  if (pollBtnB) pollBtnB.addEventListener('click', () => votePoll('b'));

  // --- Guestbook -------------------------------------------------------

  const GUESTBOOK_NAME_KEY = 'djxpress_guestbook_name';
  if (guestbookNameInput) {
    try {
      const savedName = localStorage.getItem(GUESTBOOK_NAME_KEY);
      if (savedName) guestbookNameInput.value = savedName;
    } catch (err) {
      // ignore
    }
  }

  function renderGuestbook(entries) {
    if (!guestbookList) return;
    if (!entries || !entries.length) {
      guestbookList.innerHTML = '';
      guestbookEmpty.style.display = 'block';
      return;
    }
    guestbookEmpty.style.display = 'none';
    guestbookList.innerHTML = entries
      .map(
        (e) => `
      <div class="guestbook-entry">
        <div class="gb-name">${escapeHtml(e.name)}</div>
        <div class="gb-message">${escapeHtml(e.message)}</div>
        <div class="gb-time">${formatTime(e.created_at)}</div>
      </div>`
      )
      .join('');
  }

  async function pollGuestbook() {
    if (!guestbookWrap) return;
    try {
      const res = await fetch('/api/guestbook', { headers: { Accept: 'application/json' } });
      if (!res.ok) return;
      const data = await res.json();
      renderGuestbook(data.entries);
    } catch (err) {
      // Silently retry on next interval.
    }
  }

  if (guestbookForm) {
    guestbookForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      guestbookError.style.display = 'none';

      const submitBtn = guestbookForm.querySelector('button[type="submit"]');
      submitBtn.disabled = true;

      const name = guestbookNameInput.value.trim();
      const message = guestbookMessageInput.value.trim();

      try {
        const res = await fetch('/api/guestbook', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, message }),
        });
        const data = await res.json();

        if (res.ok && data.ok) {
          try {
            localStorage.setItem(GUESTBOOK_NAME_KEY, name);
          } catch (err) {
            // ignore
          }
          guestbookMessageInput.value = '';
          guestbookMessageInput.focus();
          pollGuestbook();
        } else {
          guestbookError.textContent = data.error || 'Something went wrong. Please try again.';
          guestbookError.style.display = 'block';
        }
      } catch (err) {
        guestbookError.textContent = 'Network error. Please try again.';
        guestbookError.style.display = 'block';
      } finally {
        submitBtn.disabled = false;
      }
    });
  }

  // --- Guest presence heartbeat -----------------------------------------

  let presenceTimer = null;
  function pingPresence() {
    fetch('/api/presence/ping', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: getClientId() }),
    }).catch(() => {});
  }

  async function refresh() {
    try {
      const res = await fetch('/api/live-state', { headers: { Accept: 'application/json' } });
      if (!res.ok) return;
      const data = await res.json();

      const isLive = !!data.isLive;
      const features = data.features || {};
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

      if (guestCounterPill) {
        const showCounter = isLive && features.guestCounter && data.activeGuests != null;
        guestCounterPill.style.display = showCounter ? 'inline-flex' : 'none';
        if (showCounter) guestCounterCount.textContent = data.activeGuests;
      }

      if (reactionsWrap) {
        reactionsWrap.style.display = isLive && features.reactions ? 'block' : 'none';
      }

      if (guestbookWrap) {
        guestbookWrap.style.display = isLive && features.guestbook ? 'block' : 'none';
      }

      if (pollWrap) {
        renderPoll(isLive && features.polls ? data.poll : null);
      }

      if (isLive && features.guestCounter) {
        pingPresence();
        if (!presenceTimer) presenceTimer = setInterval(pingPresence, 20000);
      } else if (presenceTimer) {
        clearInterval(presenceTimer);
        presenceTimer = null;
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

  if (reactionsWrap) {
    pollReactions();
    setInterval(pollReactions, 2000);
  }

  if (guestbookWrap) {
    pollGuestbook();
    setInterval(pollGuestbook, 5000);
  }
})();
