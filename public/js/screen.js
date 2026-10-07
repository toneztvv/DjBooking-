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
  const nowPlayingDedication = document.getElementById('now-playing-dedication');

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

  // When a song with a dedication starts, flash it across the big screen once
  // (not for whatever was already playing when this page first loaded).
  let lastNowKey;
  function announceDedication(song, features) {
    const key = `${song.normalized_key}|${song.played_at}`;
    const first = lastNowKey === undefined;
    const changed = key !== lastNowKey;
    lastNowKey = key;
    if (first || !changed || !song.dedication || !features.effects || !window.DJXEffects) return;
    const who = song.dedication_by ? `${song.dedication_by}: ` : '';
    window.DJXEffects.play('shoutout', `\u{1F48C} ${who}${song.dedication}`.slice(0, 140));
  }

  async function refresh() {
    try {
      const res = await fetch('/api/live-state');
      if (!res.ok) return;
      const data = await res.json();
      const isLive = !!data.isLive;
      const features = data.features || {};
      if (lastNowKey === undefined && !data.nowPlaying) lastNowKey = null;

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
        const dedication = data.nowPlaying.dedication;
        if (nowPlayingDedication) {
          nowPlayingDedication.textContent = dedication
            ? `\u{1F48C} ${dedication}${data.nowPlaying.dedication_by ? ` — ${data.nowPlaying.dedication_by}` : ''}`
            : '';
          nowPlayingDedication.style.display = dedication ? 'block' : 'none';
        }
        announceDedication(data.nowPlaying, features);
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

      if (window.DJXExtras) {
        window.DJXExtras.update({
          tips: isLive && features.tips ? data.tips : null,
          battle: isLive && features.battles ? data.battle : null,
          battleResult: isLive && features.battles ? data.battleResult : null,
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
            <div><div class="slr-song">${escapeHtml(r.song_title)}</div>${r.artist ? `<div class="slr-artist">${escapeHtml(r.artist)}</div>` : ''}${r.dedication ? `<div class="dedication-note">&#128140; ${escapeHtml(r.dedication)}</div>` : ''}</div>
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

  // --- Photo Wall spotlight ------------------------------------------------
  // Cycles through the approved photos; a photo approved while the screen is
  // open jumps the queue and gets a "NEW" tag.
  const wallEl = document.getElementById('screen-wall');
  const wallImg = document.getElementById('screen-wall-img');
  const wallNew = document.getElementById('screen-wall-new');
  const wallCaption = document.getElementById('screen-wall-caption');
  let wallPhotos = [];
  let wallIndex = 0;
  let wallSeenMax = null;
  let wallNewUntil = 0;

  function showWallPhoto(photo, isNew) {
    if (!wallImg || !photo) return;
    wallImg.classList.add('screen-wall-fade');
    setTimeout(() => {
      wallImg.src = photo.url;
      wallCaption.textContent = [photo.caption, photo.name && `— ${photo.name}`].filter(Boolean).join(' ');
      wallNew.style.display = isNew ? 'inline-block' : 'none';
      wallImg.classList.remove('screen-wall-fade');
    }, 250);
  }

  async function pollWall() {
    if (!wallEl) return;
    try {
      const res = await fetch('/api/wall');
      if (!res.ok) return;
      const data = await res.json();
      if (!data.enabled || !data.photos.length) {
        wallEl.style.display = 'none';
        wallPhotos = [];
        return;
      }
      wallEl.style.display = 'block';
      const newest = data.photos[0];
      const newestId = newest.id;
      if (wallSeenMax !== null && newestId > wallSeenMax) {
        // Something new was approved: show it right now.
        wallIndex = 0;
        wallNewUntil = Date.now() + 15000;
        showWallPhoto(newest, true);
      } else if (!wallPhotos.length) {
        wallIndex = 0;
        showWallPhoto(newest, false);
      }
      wallSeenMax = Math.max(wallSeenMax || 0, newestId);
      wallPhotos = data.photos;
    } catch (err) {
      // retry next cycle
    }
  }

  setInterval(() => {
    if (wallPhotos.length < 2 || Date.now() < wallNewUntil) return;
    wallIndex = (wallIndex + 1) % wallPhotos.length;
    showWallPhoto(wallPhotos[wallIndex], false);
  }, 7000);

  refresh();
  setInterval(refresh, 4000);
  pollWall();
  setInterval(pollWall, 4000);
  pollReactions();
  setInterval(pollReactions, 2000);
  pollGuestbook();
  setInterval(pollGuestbook, 6000);
})();
