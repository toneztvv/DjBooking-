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

  function pendingTile(p) {
    return `<div class="wall-admin-tile" data-id="${p.id}">
      <img src="${esc(p.url)}" alt="Photo waiting for approval" />
      <div class="wall-admin-meta">${p.name ? `<strong>${esc(p.name)}</strong>` : '<em>No name</em>'}${p.caption ? ` &mdash; ${esc(p.caption)}` : ''}</div>
      <div class="wall-admin-actions">
        <button type="button" class="btn btn-success btn-sm" data-act="approve">&#10003; Approve</button>
        <button type="button" class="btn btn-danger btn-sm" data-act="remove">&#10005; Reject</button>
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

  card.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const tile = btn.closest('.wall-admin-tile');
    if (!tile) return;
    btn.disabled = true;
    const act = btn.dataset.act;
    try {
      await fetch(`/admin/wall/${tile.dataset.id}/${act}`, { method: 'POST' });
      tile.remove();
    } catch (err) {
      btn.disabled = false;
    }
    refresh();
  });

  refresh();
  setInterval(refresh, 3000);
})();
