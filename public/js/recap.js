(function () {
  // SQLite stores UTC; show dates/times in the viewer's own timezone.
  function showTimes() {
    const loc = window.DJXI18n ? window.DJXI18n.locale() : [];
    document.querySelectorAll('time[data-utc]').forEach((el) => {
      const iso = el.dataset.utc.replace(' ', 'T') + 'Z';
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return;
      el.textContent =
        el.dataset.format === 'time'
          ? d.toLocaleTimeString(loc, { hour: 'numeric', minute: '2-digit' })
          : d.toLocaleDateString(loc, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    });
  }
  showTimes();
  document.addEventListener('djx:lang', showTimes);

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

  // --- Review form -------------------------------------------------------
  const reviewSection = document.getElementById('review-section');
  if (reviewSection) {
    const form = document.getElementById('review-form');
    const thanks = document.getElementById('review-thanks');
    const googleLink = document.getElementById('review-google');
    const message = document.getElementById('review-message');
    const picker = document.getElementById('star-picker');
    const doneKey = `djxpress_reviewed_${reviewSection.dataset.event}`;
    let rating = 0;

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

    function showThanks(googleUrl) {
      form.style.display = 'none';
      thanks.style.display = 'block';
      if (googleUrl) {
        googleLink.href = googleUrl;
        googleLink.style.display = 'inline-flex';
      }
    }

    try {
      if (localStorage.getItem(doneKey)) showThanks('');
    } catch (err) {
      // ignore
    }

    function paint(value) {
      picker.querySelectorAll('button').forEach((b) => {
        const on = Number(b.dataset.value) <= value;
        b.classList.toggle('on', on);
        b.setAttribute('aria-checked', Number(b.dataset.value) === rating ? 'true' : 'false');
      });
    }
    picker.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-value]');
      if (!b) return;
      rating = Number(b.dataset.value);
      paint(rating);
    });
    picker.addEventListener('mouseover', (e) => {
      const b = e.target.closest('button[data-value]');
      if (b) paint(Number(b.dataset.value));
    });
    picker.addEventListener('mouseleave', () => paint(rating));

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      message.className = '';
      message.textContent = '';
      const submitBtn = form.querySelector('button[type="submit"]');
      submitBtn.disabled = true;
      try {
        const res = await fetch('/api/reviews', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token: form.dataset.token,
            rating,
            name: document.getElementById('review-name').value,
            quote: document.getElementById('review-quote').value,
            client_id: getClientId(),
            company_website: form.elements.company_website.value,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.ok) {
          try {
            localStorage.setItem(doneKey, '1');
          } catch (err) {
            // ignore
          }
          showThanks(data.googleUrl || '');
        } else {
          message.textContent = data.error || 'Something went wrong. Please try again.';
          message.className = 'alert alert-error';
          if (res.status === 409) showThanks('');
        }
      } catch (err) {
        message.textContent = 'Network error. Please try again.';
        message.className = 'alert alert-error';
      } finally {
        submitBtn.disabled = false;
      }
    });
  }

  // --- Referral share --------------------------------------------------------
  const referralBtn = document.getElementById('referral-share');
  if (referralBtn) {
    const referralNote = document.getElementById('referral-note');
    referralBtn.addEventListener('click', async () => {
      const url = referralBtn.dataset.url;
      const text = referralBtn.dataset.text;
      try {
        if (navigator.share) {
          await navigator.share({ title: 'DJXpress', text, url });
          return;
        }
        await navigator.clipboard.writeText(`${text} ${url}`);
        referralNote.textContent = 'Link copied — paste it into a text or post.';
      } catch (err) {
        if (err && err.name === 'AbortError') return;
        referralNote.textContent = `Copy this link to share: ${url}`;
      }
    });
  }

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
