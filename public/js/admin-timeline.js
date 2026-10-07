(function () {
  const root = document.getElementById('timeline-root');
  if (!root) return;

  const eventId = root.dataset.event;
  const isLive = root.dataset.live === '1';
  const CATS = window.TIMELINE_CATEGORIES || {};
  const statsEl = document.getElementById('tl-stats');
  const filtersEl = document.getElementById('tl-filters');
  const listEl = document.getElementById('tl-list');
  const emptyEl = document.getElementById('tl-empty');
  const searchEl = document.getElementById('tl-search');
  const orderBtn = document.getElementById('tl-order');
  const liveNote = document.getElementById('tl-live-note');

  let data = null;
  let filter = 'all';
  let newestFirst = isLive; // watching a night live? newest on top. Reading one afterwards? top to bottom.

  function esc(str) {
    return String(str == null ? '' : str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function toDate(at) {
    return new Date(String(at).replace(' ', 'T') + 'Z');
  }

  // Format the header date in the DJ's own timezone.
  document.querySelectorAll('time[data-utc]').forEach((el) => {
    const d = toDate(el.dataset.utc);
    if (!Number.isNaN(d.getTime())) el.textContent = d.toLocaleString([], { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  });

  function money(cents) {
    return `$${(cents / 100).toFixed(2)}`;
  }

  function renderStats() {
    const s = data.stats;
    const tiles = [
      ['\u{1F465}', s.peakGuests == null ? '—' : s.peakGuests, 'Peak guests online'],
      ['\u{1F3B5}', s.requests, 'Song requests'],
      ['✅', s.played, 'Songs played'],
      ['\u{1F4AC}', s.chatGuest, 'Guest chat messages' + (s.chatDeleted ? ` (${s.chatDeleted} deleted)` : '')],
      ['\u{1F525}', s.reactions, 'Reactions'],
      ['\u{1F4D5}', s.guestbook, 'Guestbook notes'],
      ['\u{1F4F8}', s.photosSent, `Photos sent (${s.photosApproved} approved, ${s.photosRejected} rejected)`],
      ['\u{1F39F}️', s.passesSold, 'Photo Passes sold' + (s.revenueCents ? ` — ${money(s.revenueCents)}` : '')],
      ['⚡', s.drops, 'Drops, shoutouts & sounds fired'],
    ];
    statsEl.innerHTML = tiles
      .map(([icon, n, label]) => `<div class="tl-stat"><div class="tl-stat-num">${icon} ${esc(n)}</div><div class="tl-stat-label">${esc(label)}</div></div>`)
      .join('');
  }

  function renderFilters() {
    const counts = { all: data.items.length };
    data.items.forEach((i) => (counts[i.cat] = (counts[i.cat] || 0) + 1));
    const order = ['all', 'requests', 'chat', 'photos', 'money', 'dj', 'guests'];
    filtersEl.innerHTML = order
      .filter((k) => k === 'all' || counts[k])
      .map((k) => `<button type="button" class="tl-chip${filter === k ? ' active' : ''}" data-filter="${k}">${k === 'all' ? 'Everything' : esc(CATS[k] || k)} <span class="tl-chip-n">${counts[k] || 0}</span></button>`)
      .join('');
  }

  function renderList() {
    const q = searchEl.value.trim().toLowerCase();
    let items = data.items.filter((i) => (filter === 'all' || i.cat === filter) && (!q || `${i.text} ${i.sub}`.toLowerCase().includes(q)));
    if (newestFirst) items = items.slice().reverse();
    emptyEl.style.display = items.length ? 'none' : 'block';

    let lastDay = '';
    const html = [];
    items.forEach((i) => {
      const d = toDate(i.at);
      const day = d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
      if (day !== lastDay) {
        html.push(`<div class="tl-day">${esc(day)}</div>`);
        lastDay = day;
      }
      const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });
      html.push(`<div class="tl-row tl-${esc(i.cat)}">
        <div class="tl-time">${esc(time)}</div>
        <div class="tl-icon" aria-hidden="true">${esc(i.icon)}</div>
        <div class="tl-body"><div class="tl-text">${esc(i.text)}</div>${i.sub ? `<div class="tl-sub">${esc(i.sub)}</div>` : ''}</div>
        <div class="tl-tag">${esc(CATS[i.cat] || i.cat)}</div>
      </div>`);
    });
    listEl.innerHTML = html.join('');
    orderBtn.textContent = newestFirst ? 'Newest first' : 'Oldest first';
  }

  async function load() {
    try {
      const res = await fetch(`/admin/events/${eventId}/timeline.json`, { headers: { Accept: 'application/json' } });
      if (!res.ok) return;
      data = await res.json();
      renderStats();
      renderFilters();
      renderList();
    } catch (err) {
      // try again on the next refresh
    }
  }

  filtersEl.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-filter]');
    if (!btn) return;
    filter = btn.dataset.filter;
    renderFilters();
    renderList();
  });
  searchEl.addEventListener('input', () => data && renderList());
  orderBtn.addEventListener('click', () => {
    newestFirst = !newestFirst;
    if (data) renderList();
  });

  load();
  if (isLive) {
    liveNote.style.display = 'block';
    setInterval(load, 10000);
  }
})();
