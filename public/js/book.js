(function () {
  // Never allow a date in the past, and show the form's own message right away.
  const dateInput = document.getElementById('event_date');
  if (dateInput) {
    const t = new Date();
    dateInput.min = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
  }

  // One tap, one inquiry: show "Sending…" and lock the button so a double tap
  // (or a slow connection) can't send the same booking twice.
  const bookForm = document.querySelector('form[action="/api/inquiries"]');
  const bookBtn = document.getElementById('book-submit');
  if (bookForm && bookBtn) {
    bookForm.addEventListener('submit', () => {
      if (!bookForm.checkValidity()) return;
      bookBtn.disabled = true;
      bookBtn.textContent = 'Sending…';
    });
  }
  const bookError = document.getElementById('book-error');
  if (bookError) bookError.scrollIntoView({ block: 'center' });

  const grid = document.getElementById('calendar-grid');
  const monthLabel = document.getElementById('cal-month-label');
  const prevBtn = document.getElementById('cal-prev');
  const nextBtn = document.getElementById('cal-next');
  const eventDateInput = document.getElementById('event_date');
  if (!grid) return;

  const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];

  let bookedDates = new Set();
  const today = new Date();
  const todayKey = toDateKey(today.getFullYear(), today.getMonth(), today.getDate());
  let viewYear = today.getFullYear();
  let viewMonth = today.getMonth();
  let selectedKey = eventDateInput ? eventDateInput.value : '';

  function toDateKey(y, m, d) {
    return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }

  function selectDate(key, cell) {
    selectedKey = key;
    if (eventDateInput) {
      eventDateInput.value = key;
      eventDateInput.classList.add('field-confirm-flash');
      setTimeout(() => eventDateInput.classList.remove('field-confirm-flash'), 900);
    }
    grid.querySelectorAll('.cal-selected').forEach((el) => el.classList.remove('cal-selected'));
    if (cell) cell.classList.add('cal-selected');
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

    for (let i = 0; i < firstDay; i++) {
      const blank = document.createElement('div');
      blank.className = 'cal-day cal-blank';
      grid.appendChild(blank);
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const key = toDateKey(viewYear, viewMonth, day);
      const isPast = key < todayKey;
      const isBooked = bookedDates.has(key);
      const cell = document.createElement('div');
      cell.className = 'cal-day';
      if (isBooked) cell.classList.add('cal-booked');
      if (isPast) cell.classList.add('cal-past');
      if (key === todayKey) cell.classList.add('cal-today');
      if (key === selectedKey) cell.classList.add('cal-selected');
      cell.textContent = day;

      if (!isBooked && !isPast && eventDateInput) {
        cell.classList.add('cal-pickable');
        cell.setAttribute('role', 'button');
        cell.setAttribute('tabindex', '0');
        cell.setAttribute('aria-label', `Pick ${MONTH_NAMES[viewMonth]} ${day}, ${viewYear} as your event date`);
        cell.addEventListener('click', () => selectDate(key, cell));
        cell.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            selectDate(key, cell);
          }
        });
      }

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
