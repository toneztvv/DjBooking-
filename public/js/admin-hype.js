(function () {
  const card = document.getElementById('hype-card');
  if (!card) return;

  const status = document.getElementById('hype-status');
  let statusTimer = null;

  function say(text, isError) {
    status.textContent = text;
    status.style.color = isError ? 'var(--danger)' : 'var(--success)';
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => (status.textContent = ''), 2500);
  }

  async function post(url, body) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {}),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        say(data.error || 'Something went wrong.', true);
        return false;
      }
      return true;
    } catch (err) {
      say('Network error — try again.', true);
      return false;
    }
  }

  // One-tap drops and sounds
  card.querySelectorAll('[data-drop]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      const ok = await post('/admin/drops', { kind: btn.dataset.drop });
      if (ok) say(`Sent: ${btn.textContent.trim()}`);
      setTimeout(() => (btn.disabled = false), 700);
    });
  });

  const shoutoutForm = document.getElementById('shoutout-form');
  if (shoutoutForm) {
    shoutoutForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = document.getElementById('shoutout-text');
      const message = input.value.trim();
      if (!message) return;
      if (await post('/admin/drops', { kind: 'shoutout', message })) {
        say('Shoutout sent to every screen.');
        input.value = '';
      }
    });
  }

  const countdownForm = document.getElementById('countdown-form');
  if (countdownForm) {
    countdownForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const label = document.getElementById('countdown-label-input').value.trim();
      const minutes = Number(document.getElementById('countdown-minutes').value);
      if (await post('/admin/countdown', { label, minutes })) {
        say(`Countdown started: ${label}`);
      }
    });
    document.getElementById('countdown-clear').addEventListener('click', async () => {
      if (await post('/admin/countdown/clear')) say('Countdown cleared.');
    });
  }

  const slider = document.getElementById('energy-slider');
  const readout = document.getElementById('energy-readout');
  if (slider) {
    let energyTimer = null;
    slider.addEventListener('input', () => {
      readout.textContent = slider.value;
      clearTimeout(energyTimer);
      energyTimer = setTimeout(async () => {
        if (await post('/admin/energy', { level: Number(slider.value) })) {
          say(`Energy set to ${slider.value}/10`);
        }
      }, 250);
    });
  }
})();
