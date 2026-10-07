// Guest side of the Photo Wall: pick a photo, shrink it on the phone, send it
// for the DJ to approve, and show the approved photos.
(function () {
  const wrap = document.getElementById('wall-wrap');
  if (!wrap) return;

  const form = document.getElementById('wall-form');
  const fileInput = document.getElementById('wall-file');
  const preview = document.getElementById('wall-preview');
  const nameInput = document.getElementById('wall-name');
  const captionInput = document.getElementById('wall-caption');
  const submitBtn = document.getElementById('wall-submit');
  const message = document.getElementById('wall-message');
  const grid = document.getElementById('wall-grid');
  const empty = document.getElementById('wall-empty');

  const MAX_DIMENSION = 900;
  const MAX_BYTES = 300 * 1024; // server allows 350KB; stay safely under
  let blob = null;
  let previewUrl = null;
  let gridSig = null;

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

  try {
    const saved = localStorage.getItem('djxpress_guestbook_name');
    if (saved) nameInput.value = saved;
  } catch (err) {
    // ignore
  }

  function say(text, kind) {
    message.textContent = text;
    message.className = text ? `alert alert-${kind}` : '';
  }

  function esc(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }

  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('unreadable'));
      };
      img.src = url;
    });
  }

  function canvasToBlob(canvas, quality) {
    return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  }

  // Redrawing onto a canvas shrinks the photo AND strips hidden camera data
  // (like GPS location) before anything leaves the phone.
  async function shrink(file) {
    const img = await loadImage(file);
    let scale = Math.min(1, MAX_DIMENSION / Math.max(img.naturalWidth, img.naturalHeight));
    let quality = 0.78;

    for (let attempt = 0; attempt < 6; attempt++) {
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const out = await canvasToBlob(canvas, quality);
      if (out && out.size <= MAX_BYTES) return out;
      quality = Math.max(0.45, quality - 0.1);
      scale *= 0.85;
    }
    throw new Error('toobig');
  }

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files && fileInput.files[0];
    blob = null;
    submitBtn.disabled = true;
    preview.hidden = true;
    say('', '');
    if (!file) return;
    if (!/^image\//.test(file.type) && file.type) {
      say('Please choose a photo (not a video or file).', 'error');
      return;
    }
    say('Getting your photo ready…', 'info');
    try {
      blob = await shrink(file);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = URL.createObjectURL(blob);
      preview.src = previewUrl;
      preview.hidden = false;
      submitBtn.disabled = false;
      say('', '');
    } catch (err) {
      say('We couldn’t read that photo. Try a different one (JPG or PNG works best).', 'error');
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!blob) return;
    submitBtn.disabled = true;
    say('Sending…', 'info');

    const fd = new FormData();
    fd.append('photo', blob, 'photo.jpg');
    fd.append('name', nameInput.value.trim());
    fd.append('caption', captionInput.value.trim());
    fd.append('client_id', getClientId());
    fd.append('company_website', form.elements.company_website.value);

    try {
      const res = await fetch('/api/wall', { method: 'POST', body: fd });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        try {
          if (nameInput.value.trim()) localStorage.setItem('djxpress_guestbook_name', nameInput.value.trim());
        } catch (err) {
          // ignore
        }
        say('Sent! The DJ will check it and it’ll pop up on the Big Screen once approved. \u{1F389}', 'success');
        blob = null;
        fileInput.value = '';
        captionInput.value = '';
        preview.hidden = true;
        refresh();
      } else {
        say(data.error || 'Something went wrong. Please try again.', 'error');
        submitBtn.disabled = false;
      }
    } catch (err) {
      say('Network error. Please try again.', 'error');
      submitBtn.disabled = false;
    }
  });

  async function refresh() {
    try {
      const res = await fetch(`/api/wall?client_id=${encodeURIComponent(getClientId())}`, { headers: { Accept: 'application/json' } });
      if (!res.ok) return;
      const data = await res.json();
      wrap.style.display = data.enabled ? 'block' : 'none';
      if (!data.enabled) return;

      const sig = data.photos.map((p) => p.id).join(',');
      if (sig !== gridSig) {
        gridSig = sig;
        grid.innerHTML = data.photos
          .map(
            (p) =>
              `<figure class="wall-thumb"><img src="${esc(p.url)}" alt="${esc(p.caption || 'Photo from the party')}" loading="lazy" />${p.name || p.caption ? `<figcaption>${esc(p.caption || p.name)}</figcaption>` : ''}</figure>`
          )
          .join('');
      }
      empty.style.display = data.photos.length ? 'none' : 'block';
    } catch (err) {
      // retry next cycle
    }
  }

  refresh();
  setInterval(refresh, 6000);
})();
