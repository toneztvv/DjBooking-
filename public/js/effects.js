(function () {
  // Plays the "drops" the DJ fires from the dashboard. Every open /live page
  // and the Big Screen polls the same feed, so they all go off together.
  const reduceMotion =
    window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const COLORS = ['#ff2fbf', '#33e0ff', '#7c4dff', '#fbbf24', '#34d399', '#f87171', '#ffffff'];

  let canvas = null;
  let ctx = null;
  let particles = [];
  let rafId = null;
  let mode = 'confetti';

  function ensureCanvas() {
    if (canvas) return;
    canvas = document.createElement('canvas');
    canvas.className = 'fx-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    document.body.appendChild(canvas);
    ctx = canvas.getContext('2d');
    resize();
    window.addEventListener('resize', resize);
  }

  function resize() {
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function rand(min, max) {
    return min + Math.random() * (max - min);
  }

  function spawnConfetti(count) {
    for (let i = 0; i < count; i++) {
      particles.push({
        type: 'confetti',
        x: rand(0, window.innerWidth),
        y: rand(-60, -10),
        vx: rand(-1.8, 1.8),
        vy: rand(2.5, 6),
        size: rand(6, 11),
        rot: rand(0, Math.PI * 2),
        vr: rand(-0.2, 0.2),
        color: COLORS[(Math.random() * COLORS.length) | 0],
        life: 1,
      });
    }
  }

  function spawnBurst(x, y) {
    const color = COLORS[(Math.random() * (COLORS.length - 1)) | 0];
    for (let i = 0; i < 70; i++) {
      const angle = (Math.PI * 2 * i) / 70 + rand(-0.05, 0.05);
      const speed = rand(2, 7);
      particles.push({
        type: 'spark',
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: rand(1.5, 3),
        color,
        life: 1,
      });
    }
  }

  function frame() {
    if (mode === 'fireworks') {
      // Fade the previous frame instead of clearing it, which leaves trails.
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = 'rgba(0, 0, 0, 0.22)';
      ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);
      ctx.globalCompositeOperation = 'lighter';
    } else {
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      ctx.globalCompositeOperation = 'source-over';
    }

    particles = particles.filter((p) => p.life > 0 && p.y < window.innerHeight + 40);

    particles.forEach((p) => {
      if (p.type === 'confetti') {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.05;
        p.rot += p.vr;
        p.life -= 0.0035;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.globalAlpha = Math.max(p.life, 0);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        ctx.restore();
      } else {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.07;
        p.vx *= 0.985;
        p.life -= 0.013;
        ctx.globalAlpha = Math.max(p.life, 0);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    ctx.globalAlpha = 1;

    if (particles.length) {
      rafId = requestAnimationFrame(frame);
    } else {
      rafId = null;
      if (canvas) {
        canvas.remove();
        window.removeEventListener('resize', resize);
        canvas = null;
        ctx = null;
      }
    }
  }

  function startLoop(newMode) {
    ensureCanvas();
    mode = newMode;
    if (!rafId) rafId = requestAnimationFrame(frame);
  }

  function confetti() {
    if (reduceMotion) return toast('🎉');
    startLoop('confetti');
    spawnConfetti(180);
    setTimeout(() => spawnConfetti(120), 500);
  }

  function fireworks() {
    if (reduceMotion) return toast('🎆');
    startLoop('fireworks');
    for (let i = 0; i < 7; i++) {
      setTimeout(() => {
        if (canvas) {
          startLoop('fireworks');
          spawnBurst(rand(window.innerWidth * 0.15, window.innerWidth * 0.85), rand(window.innerHeight * 0.12, window.innerHeight * 0.5));
        }
      }, i * 380);
    }
  }

  function wash() {
    if (reduceMotion) return toast('✨');
    const el = document.createElement('div');
    el.className = 'fx-wash';
    el.setAttribute('aria-hidden', 'true');
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 4200);
  }

  function toast(text) {
    const el = document.createElement('div');
    el.className = 'fx-toast';
    el.textContent = text;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2200);
  }

  function shoutout(message) {
    const el = document.createElement('div');
    el.className = 'fx-shoutout';
    el.setAttribute('role', 'status');
    const inner = document.createElement('div');
    inner.className = 'fx-shoutout-text';
    inner.textContent = message || '';
    el.appendChild(inner);
    document.body.appendChild(el);
    if (!reduceMotion) {
      startLoop('confetti');
      spawnConfetti(90);
    }
    setTimeout(() => el.classList.add('fx-shoutout-out'), 6500);
    setTimeout(() => el.remove(), 7200);
  }

  function play(kind, message) {
    if (kind === 'confetti') return confetti();
    if (kind === 'fireworks') return fireworks();
    if (kind === 'wash') return wash();
    if (kind === 'shoutout') return shoutout(message);
    if (kind && kind.startsWith('sound:')) {
      // Only the Big Screen loads the soundboard; phones stay silent.
      if (window.DJXAudio) window.DJXAudio.play(kind.slice(6));
    }
  }

  window.DJXEffects = { play };

  // --- polling -----------------------------------------------------------
  let lastId = null; // null until we've baselined to "now"
  let timer = null;

  async function baseline() {
    try {
      const res = await fetch('/api/effects', { headers: { Accept: 'application/json' } });
      if (!res.ok) return;
      const data = await res.json();
      lastId = data.latestId || 0;
    } catch (err) {
      // try again next tick
    }
  }

  async function poll() {
    if (document.hidden) return;
    if (lastId === null) return baseline();
    try {
      const res = await fetch(`/api/effects?afterId=${lastId}`, { headers: { Accept: 'application/json' } });
      if (!res.ok) return;
      const data = await res.json();
      if (!data.enabled) {
        lastId = data.latestId || 0;
        return;
      }
      (data.effects || []).forEach((fx, i) => {
        lastId = Math.max(lastId, fx.id);
        setTimeout(() => play(fx.kind, fx.message), i * 600);
      });
    } catch (err) {
      // try again next tick
    }
  }

  // Coming back to a tab after a while: skip whatever fired while away.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) lastId = null;
  });

  baseline();
  timer = setInterval(poll, 2000);
  window.addEventListener('beforeunload', () => clearInterval(timer));
})();
