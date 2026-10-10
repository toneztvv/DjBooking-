(function () {
  // --- Scroll-reveal for marketing sections ---
  const revealEls = document.querySelectorAll('.reveal');
  if (revealEls.length) {
    if ('IntersectionObserver' in window) {
      const observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              entry.target.classList.add('is-visible');
              observer.unobserve(entry.target);
            }
          });
        },
        { threshold: 0.15 }
      );
      revealEls.forEach((el) => observer.observe(el));
    } else {
      revealEls.forEach((el) => el.classList.add('is-visible'));
    }
  }

  // --- Animated stat counters ---
  const counters = document.querySelectorAll('[data-count-to]');
  if (!counters.length) return;

  function animateCounter(el) {
    const target = Number(el.dataset.countTo) || 0;
    if (!target) {
      el.textContent = '0';
      return;
    }
    const duration = 1400;
    const start = performance.now();

    function tick(now) {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      el.textContent = Math.round(eased * target).toLocaleString();
      if (progress < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  if ('IntersectionObserver' in window) {
    const counterObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            animateCounter(entry.target);
            counterObserver.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.4 }
    );
    counters.forEach((el) => counterObserver.observe(el));
  } else {
    counters.forEach((el) => (el.textContent = el.dataset.countTo));
  }
})();


// --- Tap a gallery photo to see it large (arrow keys / swipe-free: tap sides or buttons) ---
(function () {
  const photos = Array.from(document.querySelectorAll('img.gallery-zoom'));
  if (!photos.length) return;

  let box = null;
  let index = 0;

  function close() {
    if (box) box.remove();
    box = null;
    document.removeEventListener('keydown', onKey);
  }

  function show(i) {
    index = (i + photos.length) % photos.length;
    const img = photos[index];
    box.querySelector('img').src = img.src;
    box.querySelector('img').alt = img.alt;
    box.querySelector('.lb-caption').textContent = img.alt && img.alt !== 'DJXpress event photo' ? img.alt : '';
    box.querySelector('.lb-count').textContent = photos.length > 1 ? `${index + 1} / ${photos.length}` : '';
  }

  function onKey(e) {
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowRight') show(index + 1);
    else if (e.key === 'ArrowLeft') show(index - 1);
  }

  function open(i) {
    close();
    box = document.createElement('div');
    box.className = 'lb-overlay';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', 'Photo viewer');
    box.innerHTML = `
      <button type="button" class="lb-btn lb-close" aria-label="Close">&times;</button>
      ${photos.length > 1 ? '<button type="button" class="lb-btn lb-prev" aria-label="Previous photo">&#8249;</button><button type="button" class="lb-btn lb-next" aria-label="Next photo">&#8250;</button>' : ''}
      <figure><img alt="" /><figcaption><span class="lb-caption"></span> <span class="lb-count"></span></figcaption></figure>`;
    document.body.appendChild(box);
    show(i);
    document.addEventListener('keydown', onKey);
    box.addEventListener('click', (e) => {
      if (e.target.closest('.lb-prev')) show(index - 1);
      else if (e.target.closest('.lb-next')) show(index + 1);
      else if (!e.target.closest('img')) close();
    });
    box.querySelector('.lb-close').focus();
  }

  photos.forEach((img, i) => {
    img.addEventListener('click', () => open(i));
    img.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        open(i);
      }
    });
  });
})();
