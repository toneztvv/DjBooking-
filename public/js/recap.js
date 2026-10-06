(function () {
  // SQLite stores UTC; show dates/times in the viewer's own timezone.
  document.querySelectorAll('time[data-utc]').forEach((el) => {
    const iso = el.dataset.utc.replace(' ', 'T') + 'Z';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return;
    el.textContent =
      el.dataset.format === 'time'
        ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
        : d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  });

  // If a cover image fails to load, show the music-note tile instead of a
  // broken-image icon. Checks images that already failed before this ran.
  function artFallback(img) {
    const tile = document.createElement('span');
    tile.className = 'recap-art recap-art-empty';
    tile.textContent = '\u{1F3B5}';
    img.replaceWith(tile);
  }
  document.querySelectorAll('img.recap-art').forEach((img) => {
    if (img.complete && img.naturalWidth === 0) artFallback(img);
    else img.addEventListener('error', () => artFallback(img), { once: true });
  });

  const shareBtn = document.getElementById('recap-share-btn');
  const note = document.getElementById('recap-share-note');
  if (!shareBtn) return;

  shareBtn.addEventListener('click', async () => {
    const url = window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({ title: document.title, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      note.textContent = 'Link copied — paste it anywhere to share.';
    } catch (err) {
      if (err && err.name === 'AbortError') return; // user closed the share sheet
      note.textContent = 'Copy the link from your address bar to share.';
    }
  });
})();
