(function () {
  const card = document.getElementById('battle-card');
  if (!card) return;

  const hadBattle = !!card.dataset.battleId;
  const votesA = document.getElementById('battle-admin-votes-a');
  const votesB = document.getElementById('battle-admin-votes-b');
  const timerEl = document.getElementById('battle-admin-timer');

  function fmt(seconds) {
    const s = Math.max(0, seconds);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  async function refresh() {
    try {
      const res = await fetch('/admin/battles/state', { headers: { Accept: 'application/json' } });
      if (!res.ok) return;
      const data = await res.json();

      // A timed battle ended on its own, or one was started elsewhere —
      // reload so the card shows the right controls.
      if (hadBattle && !data.active) return window.location.reload();
      if (!hadBattle && data.active) return window.location.reload();
      if (!data.active) return;

      votesA.textContent = data.active.votesA;
      votesB.textContent = data.active.votesB;
      if (timerEl && data.active.endsInSeconds != null) timerEl.textContent = fmt(data.active.endsInSeconds);
    } catch (err) {
      // retry next cycle
    }
  }

  setInterval(refresh, 3000);
})();
