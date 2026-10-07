(function () {
  const card = document.getElementById('wall-card');
  if (!card || card.dataset.mode === '0') return;

  const pendingEl = document.getElementById('wall-pending');
  const pendingEmpty = document.getElementById('wall-pending-empty');
  const pendingCount = document.getElementById('wall-pending-count');
  const approvedEl = document.getElementById('wall-approved');
  const approvedEmpty = document.getElementById('wall-approved-empty');
  const approvedCount = document.getElementById('wall-approved-count');
  const baseTitle = document.title;


  function esc(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }

  // Photos waiting for review start BLURRED, so nothing explicit ever flashes on
  // a screen other people can see. Tap the photo to open it full size.
  function pendingTile(p) {
    return `<div class="wall-admin-tile" data-id="${p.id}" data-url="${esc(p.url)}" data-name="${esc(p.name)}" data-caption="${esc(p.caption)}">
      <div class="wall-admin-imgwrap wall-blurred" data-act="open" role="button" tabindex="0" aria-label="Open this photo full size to review it">
        <img src="${esc(p.url)}" alt="Photo waiting for approval" />
        <span class="wall-blur-hint">&#128274; Blurred &mdash; tap to review</span>
      </div>
      <div class="wall-admin-meta">${p.name ? `<strong>${esc(p.name)}</strong>` : '<em>No name</em>'}${p.caption ? ` &mdash; ${esc(p.caption)}` : ''}</div>
      <div class="wall-admin-actions">
        <button type="button" class="btn btn-success btn-sm" data-act="approve">&#10003; Approve</button>
        <button type="button" class="btn btn-danger btn-sm" data-act="remove">&#10005; Reject</button>
        <button type="button" class="btn btn-ghost btn-sm" data-act="block" title="Delete this photo, block this phone from uploading, and turn off their Photo Pass">&#9940; Reject &amp; block</button>
      </div>
    </div>`;
  }

  function approvedTile(p) {
    return `<div class="wall-admin-tile" data-id="${p.id}">
      <img src="${esc(p.url)}" alt="Approved photo" />
      <div class="wall-admin-actions">
        <button type="button" class="btn btn-ghost btn-sm" data-act="remove" title="Take this photo off the wall">Remove</button>
      </div>
    </div>`;
  }

  // Adds new tiles and removes gone ones without rebuilding the rest, so a
  // tile never changes under the DJ's finger while they're about to tap it.
  function reconcile(container, items, tileFn, newestFirst) {
    const wanted = new Set(items.map((p) => String(p.id)));
    Array.from(container.children).forEach((el) => {
      if (!wanted.has(el.dataset.id)) el.remove();
    });
    const have = new Set(Array.from(container.children).map((el) => el.dataset.id));
    const fresh = items.filter((p) => !have.has(String(p.id)));
    (newestFirst ? fresh.slice().reverse() : fresh).forEach((p) => {
      const holder = document.createElement('div');
      holder.innerHTML = tileFn(p);
      const tile = holder.firstElementChild;
      if (newestFirst) container.insertBefore(tile, container.firstChild);
      else container.appendChild(tile);
    });
  }

  async function refresh() {
    try {
      const res = await fetch('/admin/wall/state', { headers: { Accept: 'application/json' } });
      if (!res.ok) return;
      const data = await res.json();

      reconcile(pendingEl, data.pending, pendingTile, false);
      reconcile(approvedEl, data.approved, approvedTile, true);

      pendingCount.textContent = data.pending.length;
      approvedCount.textContent = data.approved.length;
      pendingEmpty.style.display = data.pending.length ? 'none' : 'block';
      approvedEmpty.style.display = data.approved.length ? 'none' : 'block';
      card.classList.toggle('wall-has-pending', data.pending.length > 0);
      document.title = data.pending.length ? `(${data.pending.length}) photo${data.pending.length === 1 ? '' : 's'} waiting — ${baseTitle}` : baseTitle;
    } catch (err) {
      // retry next cycle
    }
  }

  const revealAll = document.getElementById('wall-reveal-all');
  if (revealAll) {
    revealAll.addEventListener('change', () => card.classList.toggle('wall-reveal-all', revealAll.checked));
  }

  // --- Full-size review window ---------------------------------------------------
  let lightbox = null;
  function closeLightbox() {
    if (lightbox) lightbox.remove();
    lightbox = null;
  }
  function openLightbox(tile) {
    closeLightbox();
    lightbox = document.createElement('div');
    lightbox.className = 'wall-lightbox';
    lightbox.setAttribute('role', 'dialog');
    lightbox.setAttribute('aria-label', 'Review photo');
    lightbox.dataset.id = tile.dataset.id;
    lightbox.innerHTML = `
      <div class="wall-lightbox-inner">
        <img src="${esc(tile.dataset.url)}" alt="Photo to review" />
        <div class="wall-admin-meta" style="text-align:center; margin:10px 0;">${tile.dataset.name ? `<strong>${esc(tile.dataset.name)}</strong>` : '<em>No name</em>'}${tile.dataset.caption ? ` &mdash; ${esc(tile.dataset.caption)}` : ''}</div>
        <div class="wall-admin-actions" style="justify-content:center;">
          <button type="button" class="btn btn-success" data-act="approve">&#10003; Approve</button>
          <button type="button" class="btn btn-danger" data-act="remove">&#10005; Reject</button>
          <button type="button" class="btn btn-ghost" data-act="block">&#9940; Reject &amp; block</button>
          <button type="button" class="btn btn-secondary" data-act="close">Close</button>
        </div>
      </div>`;
    document.body.appendChild(lightbox);
    lightbox.addEventListener('click', (e) => {
      if (e.target === lightbox) return closeLightbox();
      const btn = e.target.closest('button[data-act]');
      if (btn) act(btn, lightbox.dataset.id);
    });
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeLightbox();
  });

  async function act(btn, id) {
    const action = btn.dataset.act;
    if (action === 'close') return closeLightbox();
    if (action === 'block' && !window.confirm('Reject this photo AND block this phone from uploading?\n\nIt also turns off their Photo Pass and deletes anything else of theirs that is waiting.')) return;

    btn.disabled = true;
    try {
      if (action === 'approve') {
        await fetch(`/admin/wall/${id}/approve`, { method: 'POST' });
      } else {
        await fetch(`/admin/wall/${id}/remove`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ block: action === 'block' }),
        });
      }
      closeLightbox();
      const tile = card.querySelector(`.wall-admin-tile[data-id="${id}"]`);
      if (tile) tile.remove();
    } catch (err) {
      btn.disabled = false;
    }
    refresh();
  }

  card.addEventListener('click', (e) => {
    const target = e.target.closest('[data-act]');
    if (!target) return;
    const tile = target.closest('.wall-admin-tile');
    if (!tile) return;
    if (target.dataset.act === 'open') return openLightbox(tile);
    act(target, tile.dataset.id);
  });
  card.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const wrap = e.target.closest('.wall-admin-imgwrap[data-act="open"]');
    if (wrap) {
      e.preventDefault();
      openLightbox(wrap.closest('.wall-admin-tile'));
    }
  });

  refresh();
  setInterval(refresh, 3000);
})();
