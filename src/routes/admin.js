const express = require('express');
const { db, getSetting, setSetting } = require('../db');
const adminAuth = require('../middleware/adminAuth');
const { getLiveUrl } = require('../qr');

const router = express.Router();

router.use(adminAuth);

function clean(value, maxLen = 300) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLen);
}

function getPendingBoard(eventId) {
  return db
    .prepare(
      `SELECT normalized_key,
              song_title,
              artist,
              COUNT(*) AS times_requested,
              MIN(created_at) AS first_requested_at,
              GROUP_CONCAT(DISTINCT requested_by) AS requesters
       FROM song_requests
       WHERE event_id = ? AND status = 'pending'
       GROUP BY normalized_key
       ORDER BY times_requested DESC, first_requested_at ASC`
    )
    .all(eventId);
}

function getRecentlyPlayed(eventId) {
  return db
    .prepare(
      `SELECT normalized_key,
              song_title,
              artist,
              played_at,
              COUNT(*) AS times_requested,
              GROUP_CONCAT(DISTINCT requested_by) AS requesters
       FROM song_requests
       WHERE event_id = ? AND status = 'played'
       GROUP BY normalized_key, played_at
       ORDER BY played_at DESC
       LIMIT 50`
    )
    .all(eventId);
}

router.get('/', (req, res) => {
  const isLive = getSetting('is_live') === '1';
  const eventName = getSetting('event_name') || '';
  const eventId = Number(getSetting('current_event_id') || '1');
  const newInquiries = db
    .prepare(`SELECT COUNT(*) AS c FROM inquiries WHERE status = 'new'`)
    .get().c;

  res.render('admin/dashboard', {
    page: 'admin',
    isLive,
    eventName,
    pending: getPendingBoard(eventId),
    recentlyPlayed: getRecentlyPlayed(eventId),
    liveUrl: getLiveUrl(),
    newInquiries,
  });
});

router.post('/live/toggle', (req, res) => {
  const isLive = getSetting('is_live') === '1';
  const nextEventName = clean(req.body.event_name, 120);

  if (!isLive) {
    // Going live: start a fresh request board for the new event.
    const nextEventId = Number(getSetting('current_event_id') || '1') + 1;
    setSetting('current_event_id', nextEventId);
    setSetting('event_name', nextEventName);
    setSetting('is_live', '1');
  } else {
    setSetting('is_live', '0');
  }

  res.redirect('/admin');
});

router.post('/requests/mark-played', (req, res) => {
  const key = clean(req.body.normalized_key, 400);
  const eventId = Number(getSetting('current_event_id') || '1');

  if (key) {
    db.prepare(
      `UPDATE song_requests
       SET status = 'played', played_at = datetime('now')
       WHERE event_id = ? AND normalized_key = ? AND status = 'pending'`
    ).run(eventId, key);
  }

  res.redirect('/admin');
});

router.post('/requests/clear', (req, res) => {
  const nextEventId = Number(getSetting('current_event_id') || '1') + 1;
  setSetting('current_event_id', nextEventId);
  res.redirect('/admin');
});

router.get('/inquiries', (req, res) => {
  const inquiries = db
    .prepare(`SELECT * FROM inquiries ORDER BY created_at DESC`)
    .all();
  res.render('admin/inquiries', { page: 'admin', inquiries });
});

router.post('/inquiries/:id/status', (req, res) => {
  const id = Number(req.params.id);
  const status = clean(req.body.status, 30);
  const allowed = ['new', 'contacted', 'booked', 'declined'];

  if (id && allowed.includes(status)) {
    db.prepare(`UPDATE inquiries SET status = ? WHERE id = ?`).run(status, id);
  }

  res.redirect('/admin/inquiries');
});

module.exports = router;
