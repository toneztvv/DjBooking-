(function () {
  const form = document.getElementById('plan-form');
  if (!form) return;

  const timelineEl = document.getElementById('plan-timeline');
  const status = document.getElementById('plan-status');
  const saveBtn = document.getElementById('plan-save');
  const sendBtn = document.getElementById('plan-send');
  let dirty = false;

  function say(text, color) {
    status.textContent = text;
    status.style.color = color || '';
  }

  function addRow(time, label, focus) {
    const row = document.createElement('div');
    row.className = 'plan-timeline-row';

    const t = document.createElement('input');
    t.type = 'text';
    t.placeholder = 'Time';
    t.maxLength = 20;
    t.value = time || '';
    t.setAttribute('aria-label', 'Time');

    const l = document.createElement('input');
    l.type = 'text';
    l.placeholder = 'What happens?';
    l.maxLength = 100;
    l.value = label || '';
    l.setAttribute('aria-label', 'Moment');

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'btn btn-ghost btn-sm';
    del.textContent = '✕';
    del.setAttribute('aria-label', 'Remove this moment');
    del.addEventListener('click', () => {
      row.remove();
      dirty = true;
    });

    row.append(t, l, del);
    timelineEl.appendChild(row);
    if (focus) (time ? l : t).focus();
  }

  let initial = [];
  try {
    initial = JSON.parse(form.dataset.timeline || '[]');
  } catch (err) {
    initial = [];
  }
  initial.forEach((r) => addRow(r.time, r.label));
  if (!initial.length) addRow('', '');

  document.getElementById('plan-chips').addEventListener('click', (e) => {
    const chip = e.target.closest('.plan-chip');
    if (!chip) return;
    // Reuse an empty row first so tapping a chip never leaves blank rows behind.
    const blank = Array.from(timelineEl.children).find((r) => !r.children[0].value && !r.children[1].value);
    if (blank) {
      blank.children[1].value = chip.dataset.label;
      blank.children[0].focus();
    } else {
      addRow('', chip.dataset.label, true);
    }
    dirty = true;
  });

  document.getElementById('plan-add-row').addEventListener('click', () => {
    addRow('', '', true);
    dirty = true;
  });

  form.addEventListener('input', () => {
    dirty = true;
  });

  function collect(submit) {
    return {
      must_play: document.getElementById('plan-must').value,
      do_not_play: document.getElementById('plan-skip').value,
      announcements: document.getElementById('plan-announce').value,
      notes: document.getElementById('plan-notes').value,
      timeline: Array.from(timelineEl.children).map((r) => ({ time: r.children[0].value, label: r.children[1].value })),
      submit: !!submit,
    };
  }

  async function save(submit) {
    saveBtn.disabled = sendBtn.disabled = true;
    say('Saving…');
    try {
      const res = await fetch(window.location.pathname, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(collect(submit)),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        dirty = false;
        say(submit ? '✅ Sent! Your DJ has your plan. You can still edit and re-send any time.' : '✅ Draft saved.', 'var(--success)');
      } else {
        say(data.error || 'Something went wrong. Please try again.', 'var(--danger)');
      }
    } catch (err) {
      say('Network error — your changes are still on this page. Please try again.', 'var(--danger)');
    } finally {
      saveBtn.disabled = sendBtn.disabled = false;
    }
  }

  saveBtn.addEventListener('click', () => save(false));
  sendBtn.addEventListener('click', () => save(true));

  window.addEventListener('beforeunload', (e) => {
    if (!dirty) return;
    e.preventDefault();
    e.returnValue = '';
  });
})();
