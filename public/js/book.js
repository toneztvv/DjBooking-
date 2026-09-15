(function () {
  const grid = document.getElementById('calendar-grid');
  const monthLabel = document.getElementById('cal-month-label');
  const prevBtn = document.getElementById('cal-prev');
  const nextBtn = document.getElementById('cal-next');
  if (!grid) return;

  const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];

  let bookedDates = new Set();
  const today = new Date();
  let viewYear = today.getFullYear();
  let viewMonth = today.getMonth();

  function toDateKey(y, m, d) {
    return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }

  function render() {
    monthLabel.textContent = `${MONTH_NAMES[viewMonth]} ${viewYear}`;
    grid.innerHTML = '';

    ['S', 'M', 'T', 'W', 'T', 'F', 'S'].forEach((d) => {
      const cell = document.createElement('div');
      cell.className = 'cal-weekday';
      cell.textContent = d;
      grid.appendChild(cell);
    });

    const firstDay = new Date(viewYear, viewMonth, 1).getDay();
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const todayKey = toDateKey(today.getFullYear(), today.getMonth(), today.getDate());

    for (let i = 0; i < firstDay; i++) {
      const blank = document.createElement('div');
      blank.className = 'cal-day cal-blank';
      grid.appendChild(blank);
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const key = toDateKey(viewYear, viewMonth, day);
      const cell = document.createElement('div');
      cell.className = 'cal-day';
      if (bookedDates.has(key)) cell.classList.add('cal-booked');
      if (key === todayKey) cell.classList.add('cal-today');
      cell.textContent = day;
      grid.appendChild(cell);
    }
  }

  prevBtn.addEventListener('click', () => {
    viewMonth -= 1;
    if (viewMonth < 0) {
      viewMonth = 11;
      viewYear -= 1;
    }
    render();
  });

  nextBtn.addEventListener('click', () => {
    viewMonth += 1;
    if (viewMonth > 11) {
      viewMonth = 0;
      viewYear += 1;
    }
    render();
  });

  fetch('/api/booked-dates', { headers: { Accept: 'application/json' } })
    .then((res) => res.json())
    .then((data) => {
      bookedDates = new Set(data.dates || []);
      render();
    })
    .catch(() => render());

  render();
})();
