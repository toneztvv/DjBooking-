(function () {
  const statusDot = document.getElementById('screen-status-dot');
  const statusLabel = document.getElementById('screen-status-label');
  const eventNameEl = document.getElementById('screen-event-name');
  const guestCountWrap = document.getElementById('screen-guest-count');
  const guestCountNum = document.getElementById('screen-guest-count-num');

  const offlineEl = document.getElementById('screen-offline');
  const liveEl = document.getElementById('screen-live');

  const nowPlayingWrap = document.getElementById('now-playing');
  const nowPlayingArt = document.getElementById('now-playing-art');
  if (nowPlayingArt) nowPlayingArt.addEventListener('error', () => (nowPlayingArt.style.display = 'none'));
  const nowPlayingTitle = document.getElementById('now-playing-title');
  const nowPlayingArtist = document.getElementById('now-playing-artist');

  const pendingList = document.getElementById('screen-pending');
  const pendingEmpty = document.getElementById('screen-pending-empty');

  const pollWrap = document.getElementById('screen-poll-wrap');
  const pollQuestion = document.getElementById('screen-poll-question');
  const pollLabelA = document.getElementById('screen-poll-label-a');
  const pollLabelB = document.getElementById('screen-poll-label-b');
  const pollFillA = document.getElementById('screen-poll-fill-a');
  const pollFillB = document.getElementById('screen-poll-fill-b');

  const guestbookList = document.getElementById('screen-guestbook');
  const reactionFloatLayer = document.getElementById('reaction-float-layer');

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }

  function spawnFloatingReaction(emoji) {
    if (!reactionFloatLayer) return;
    const el = document.createElement('div');
    el.className = 'reaction-float';
    el.textContent = emoji;
    el.style.left = `${5 + Math.random() * 90}%`;
    el.style.fontSize = '3rem';
    el.style.setProperty('--drift', `${Math.round((Math.random() - 0.5) * 160)}px`);
    reactionFloatLayer.appendChild(el);
    setTimeout(() => el.remove(), 2800);
  }

  let lastReactionId = 0;
  async function pollReactions() {
    try {
      const res = await fetch(`/api/reactions?afterId=${lastReactionId}`);
      if (!res.ok) return;
      const data = await res.json();
      (data.recent || []).forEach((r) => {
        lastReactionId = Math.max(lastReactionId, r.id);
        spawnFloatingReaction(r.emoji);
      });
    } catch (err) {
      // retry next cycle
    }
  }

  async function pollGuestbook() {
    try {
      const res = await fetch('/api/guestbook');
      if (!res.ok) return;
      const data = await res.json();
      if (!data.enabled || !data.entries || !data.entries.length) {
        guestbookList.innerHTML = '<div class="screen-empty">No notes yet</div>';
        return;
      }
      guestbookList.innerHTML = data.entries
        .slice(0, 12)
        .map(
          (e) => `<div class="screen-list-row"><div><div class="slr-song">${escapeHtml(e.name)}</div><div class="slr-artist">${escapeHtml(e.message)}</div></div></div>`
        )
        .join('');
    } catch (err) {
      // retry next cycle
    }
  }

  async function refresh() {
    try {
      const res = await fetch('/api/live-state');
      if (!res.ok) return;
      const data = await res.json();
      const isLive = !!data.isLive;
      const features = data.features || {};

      statusDot.classList.toggle('offline', !isLive);
      statusLabel.textContent = isLive ? 'LIVE NOW' : 'OFFLINE';
      eventNameEl.textContent = isLive ? data.eventName || '' : '';

      offlineEl.style.display = isLive ? 'none' : 'block';
      liveEl.style.display = isLive ? 'grid' : 'none';

      if (isLive && features.guestCounter && data.activeGuests != null) {
        guestCountWrap.style.display = 'inline-flex';
        guestCountNum.textContent = data.activeGuests;
      } else {
        guestCountWrap.style.display = 'none';
      }

      if (data.nowPlaying) {
        nowPlayingWrap.style.display = 'flex';
        nowPlayingTitle.textContent = data.nowPlaying.song_title;
        nowPlayingArtist.textContent = data.nowPlaying.artist || '';
        if (data.nowPlaying.artwork_url) {
          nowPlayingArt.src = data.nowPlaying.artwork_url;
          nowPlayingArt.style.display = 'block';
        } else {
          nowPlayingArt.style.display = 'none';
        }
      } else {
        nowPlayingWrap.style.display = 'none';
      }

      if (window.DJXMoments) {
        window.DJXMoments.update({
          energy: isLive ? data.energy : null,
          countdown: isLive ? data.countdown : null,
        });
      }

      const pending = (data.pending || []).slice(0, 6);
      if (!pending.length) {
        pendingList.innerHTML = '';
        pendingEmpty.style.display = 'block';
      } else {
        pendingEmpty.style.display = 'none';
        pendingList.innerHTML = pending
          .map(
            (r) => `
          <div class="screen-list-row">
            <div><div class="slr-song">${escapeHtml(r.song_title)}</div>${r.artist ? `<div class="slr-artist">${escapeHtml(r.artist)}</div>` : ''}</div>
            <div class="count-pill">${r.times_requested}</div>
          </div>`
          )
          .join('');
      }

      if (isLive && features.polls && data.poll) {
        pollWrap.style.display = 'block';
        const total = data.poll.votesA + data.poll.votesB;
        const pctA = total ? Math.round((data.poll.votesA / total) * 100) : 0;
        const pctB = total ? Math.round((data.poll.votesB / total) * 100) : 0;
        pollQuestion.textContent = data.poll.question;
        pollLabelA.textContent = `${data.poll.optionA} — ${pctA}%`;
        pollLabelB.textContent = `${data.poll.optionB} — ${pctB}%`;
        pollFillA.style.width = `${pctA}%`;
        pollFillB.style.width = `${pctB}%`;
      } else {
        pollWrap.style.display = 'none';
      }
    } catch (err) {
      // retry next cycle
    }
  }

  // Browsers won't play audio until the page has been clicked once, so the
  // Big Screen laptop needs a single click here before the soundboard works.
  const soundToggle = document.getElementById('sound-toggle');
  if (soundToggle && window.DJXAudio) {
    soundToggle.addEventListener('click', () => {
      if (window.DJXAudio.unlock()) {
        soundToggle.textContent = '\u{1F50A} Sound on';
        soundToggle.classList.add('sound-on');
        soundToggle.disabled = true;
      } else {
        soundToggle.textContent = 'Sound not supported here';
      }
    });
  }

  refresh();
  setInterval(refresh, 4000);
  pollReactions();
  setInterval(pollReactions, 2000);
  pollGuestbook();
  setInterval(pollGuestbook, 6000);
})();
