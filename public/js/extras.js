// Tip jar + song battle cards, shared by the guests' live page (interactive:
// guests can vote) and the Big Screen (display only). Both pages use the same
// element ids; `data-interactive` on #battle-wrap decides which mode it is.
(function () {
  const tipsWrap = document.getElementById('tips-wrap');
  const tipsMessage = document.getElementById('tips-message');
  const tipsButtons = document.getElementById('tips-buttons');
  const tipsQr = document.getElementById('tips-qr');
  const tipsCopied = document.getElementById('tips-copied');

  const battleWrap = document.getElementById('battle-wrap');
  const battleResult = document.getElementById('battle-result');
  const battleTimer = document.getElementById('battle-timer');
  const battleNote = document.getElementById('battle-note');
  const interactive = !!battleWrap && battleWrap.dataset.interactive === '1';

  function esc(str) {
    return String(str == null ? '' : str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function getClientId() {
    try {
      let id = localStorage.getItem('djxpress_client_id');
      if (!id) {
        id = (window.crypto && window.crypto.randomUUID) ? window.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        localStorage.setItem('djxpress_client_id', id);
      }
      return id;
    } catch (err) {
      return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }
  }

  // --- Tip jar ---------------------------------------------------------------

  let tipsSig = null;

  function renderTips(tips) {
    if (!tipsWrap) return;
    if (!tips || !tips.methods || !tips.methods.length) {
      tipsWrap.style.display = 'none';
      tipsSig = null;
      return;
    }
    tipsWrap.style.display = '';

    const sig = JSON.stringify(tips);
    if (sig === tipsSig) return;
    tipsSig = sig;

    tipsMessage.textContent = tips.message || '';

    if (tipsQr) {
      // Big Screen: a scannable QR for the first method that has a link,
      // plus the handles written out for everyone else.
      const linkable = tips.methods.find((m) => m.url);
      if (linkable) {
        tipsQr.src = `/api/tip-qr/${encodeURIComponent(linkable.id)}.png`;
        tipsQr.alt = `Scan to tip with ${linkable.label}`;
        tipsQr.style.display = 'block';
      } else {
        tipsQr.style.display = 'none';
      }
      tipsButtons.innerHTML = tips.methods
        .map((m) => `<div class="tips-handle" translate="no"><strong>${esc(m.label)}</strong> ${esc(m.display)}</div>`)
        .join('');
      return;
    }

    tipsButtons.innerHTML = tips.methods
      .map((m) =>
        m.url
          ? `<a class="btn btn-primary" translate="no" href="${esc(m.url)}" target="_blank" rel="noopener noreferrer">${esc(m.label)} ${esc(m.display)}</a>`
          : `<button type="button" class="btn btn-secondary" data-copy="${esc(m.display)}">${esc(m.label)}: ${esc(m.display)} &mdash; tap to copy</button>`
      )
      .join('');
  }

  if (tipsButtons) {
    tipsButtons.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-copy]');
      if (!btn) return;
      const value = btn.dataset.copy;
      let ok = false;
      try {
        await navigator.clipboard.writeText(value);
        ok = true;
      } catch (err) {
        // Fall through to the message below.
      }
      if (tipsCopied) {
        tipsCopied.textContent = ok ? `Copied ${value} — paste it into your banking app.` : `Send it to: ${value}`;
        tipsCopied.style.display = 'block';
      }
    });
  }

  // --- Song battle -----------------------------------------------------------

  let renderedBattleId = null;
  let endsAtLocal = null;

  const el = (id) => document.getElementById(id);
  const side = { a: el('battle-side-a'), b: el('battle-side-b') };

  function votedKey(id) {
    return `djxpress_battle_vote_${id}`;
  }
  function getVote(id) {
    try {
      return localStorage.getItem(votedKey(id));
    } catch (err) {
      return null;
    }
  }

  function tickTimer() {
    if (!battleTimer) return;
    if (endsAtLocal == null) {
      battleTimer.textContent = '';
      return;
    }
    const remaining = Math.max(0, Math.round((endsAtLocal - Date.now()) / 1000));
    battleTimer.textContent = remaining > 0 ? `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}` : 'Closing…';
  }
  setInterval(tickTimer, 500);

  function renderBattle(battle) {
    if (!battleWrap) return;
    if (!battle) {
      battleWrap.style.display = 'none';
      renderedBattleId = null;
      endsAtLocal = null;
      return;
    }
    battleWrap.style.display = 'block';

    const total = battle.votesA + battle.votesB;
    const pctA = total ? Math.round((battle.votesA / total) * 100) : 0;
    const pctB = total ? 100 - pctA : 0;

    el('battle-song-a').textContent = battle.songA;
    el('battle-artist-a').textContent = battle.artistA;
    el('battle-song-b').textContent = battle.songB;
    el('battle-artist-b').textContent = battle.artistB;
    el('battle-fill-a').style.width = `${pctA}%`;
    el('battle-fill-b').style.width = `${pctB}%`;
    el('battle-pct-a').textContent = `${pctA}% · ${battle.votesA} vote${battle.votesA === 1 ? '' : 's'}`;
    el('battle-pct-b').textContent = `${pctB}% · ${battle.votesB} vote${battle.votesB === 1 ? '' : 's'}`;

    endsAtLocal = battle.endsInSeconds != null ? Date.now() + battle.endsInSeconds * 1000 : null;
    tickTimer();

    if (interactive) {
      const mine = getVote(battle.id);
      ['a', 'b'].forEach((k) => {
        side[k].disabled = !!mine;
        side[k].classList.toggle('battle-picked', mine === k);
      });
      battleNote.textContent = mine ? 'Vote locked in — watch the bars!' : 'Tap a song to vote. The winner goes straight into Up Next.';
    } else {
      battleNote.textContent = '';
    }
    renderedBattleId = battle.id;
  }

  async function vote(choice) {
    if (!renderedBattleId || getVote(renderedBattleId)) return;
    const id = renderedBattleId;
    side.a.disabled = side.b.disabled = true;
    try {
      const res = await fetch(`/api/battles/${id}/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ choice, client_id: getClientId() }),
      });
      // 409 = already voted from this device; either way remember it.
      if (res.ok || res.status === 409) {
        try {
          localStorage.setItem(votedKey(id), choice);
        } catch (err) {
          // ignore
        }
      } else {
        side.a.disabled = side.b.disabled = false;
      }
    } catch (err) {
      side.a.disabled = side.b.disabled = false;
    }
    if (window.DJXExtrasRefresh) window.DJXExtrasRefresh();
  }

  if (interactive) {
    side.a.addEventListener('click', () => vote('a'));
    side.b.addEventListener('click', () => vote('b'));
  }

  function renderResult(result) {
    if (!battleResult) return;
    if (!result) {
      battleResult.style.display = 'none';
      return;
    }
    let text;
    if (result.winner === 'a') text = `\u{1F3C6} ${result.songA} wins! It's coming up next.`;
    else if (result.winner === 'b') text = `\u{1F3C6} ${result.songB} wins! It's coming up next.`;
    else if (result.winner === 'tie') text = `\u{1F91D} It's a tie! Both songs are coming up.`;
    else text = 'No votes this time — the DJ will pick!';
    battleResult.textContent = text;
    battleResult.style.display = 'block';
  }

  window.DJXExtras = {
    update(state) {
      renderTips(state.tips);
      renderBattle(state.battle);
      renderResult(state.battle ? null : state.battleResult);
    },
  };
})();
