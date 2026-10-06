(function () {
  // Renders the crowd-energy meter and the "moment" countdown. Both /live and
  // /screen call DJXMoments.update() with the fields from /api/live-state.
  const SEGMENTS = 10;

  const wrapEnergy = document.getElementById('energy-wrap');
  const barEnergy = document.getElementById('energy-bar');
  const labelEnergy = document.getElementById('energy-label');

  const wrapCd = document.getElementById('countdown-wrap');
  const labelCd = document.getElementById('countdown-label');
  const timeCd = document.getElementById('countdown-time');

  if (barEnergy && !barEnergy.children.length) {
    for (let i = 0; i < SEGMENTS; i++) {
      const seg = document.createElement('span');
      seg.className = 'energy-seg';
      barEnergy.appendChild(seg);
    }
  }

  function renderEnergy(energy) {
    if (!wrapEnergy) return;
    if (!energy) {
      wrapEnergy.style.display = 'none';
      return;
    }
    wrapEnergy.style.display = 'block';
    labelEnergy.textContent = energy.label;
    Array.from(barEnergy.children).forEach((seg, i) => {
      seg.classList.toggle('on', i < energy.level);
    });
    wrapEnergy.classList.toggle('energy-max', energy.level >= 9);
  }

  // --- countdown ---------------------------------------------------------
  let cdLabel = null;
  let cdEndsAt = 0; // local clock time the countdown hits zero
  let cdFired = false;
  let cdTimer = null;

  function format(secs) {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  function tickCountdown() {
    if (!cdLabel) return;
    const remaining = Math.round((cdEndsAt - Date.now()) / 1000);
    if (remaining > 0) {
      timeCd.textContent = format(remaining);
      wrapCd.classList.remove('countdown-now');
    } else {
      timeCd.textContent = 'NOW! 🎉';
      wrapCd.classList.add('countdown-now');
      if (!cdFired) {
        cdFired = true;
        if (window.DJXEffects) window.DJXEffects.play('confetti');
      }
    }
  }

  function renderCountdown(countdown) {
    if (!wrapCd) return;
    if (!countdown) {
      wrapCd.style.display = 'none';
      cdLabel = null;
      if (cdTimer) {
        clearInterval(cdTimer);
        cdTimer = null;
      }
      return;
    }

    const serverEndsAt = Date.now() + countdown.remainingSeconds * 1000;
    const isNew = countdown.label !== cdLabel;
    // Re-sync only on a new countdown or real drift, so the display doesn't jitter.
    if (isNew || Math.abs(serverEndsAt - cdEndsAt) > 2500) cdEndsAt = serverEndsAt;
    if (isNew) {
      cdLabel = countdown.label;
      // A countdown that's already past zero when first seen (page opened late)
      // shouldn't throw confetti at someone who just arrived.
      cdFired = countdown.remainingSeconds <= 0;
    }

    labelCd.textContent = countdown.label;
    wrapCd.style.display = 'block';
    tickCountdown();
    if (!cdTimer) cdTimer = setInterval(tickCountdown, 500);
  }

  window.DJXMoments = {
    update(state) {
      renderEnergy(state.energy || null);
      renderCountdown(state.countdown || null);
    },
  };
})();
