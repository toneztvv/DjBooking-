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

function getPlayedSetlist(eventId, order = 'DESC') {
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
       ORDER BY played_at ${order === 'ASC' ? 'ASC' : 'DESC'}`
    )
    .all(eventId);
}

function getEventById(id) {
  return db.prepare('SELECT * FROM events WHERE id = ?').get(id);
}

function startNewEvent(name) {
  const result = db
    .prepare(`INSERT INTO events (name, started_at) VALUES (?, datetime('now'))`)
    .run(name || null);
  return result.lastInsertRowid;
}

function endEvent(id) {
  db.prepare(
    `UPDATE events SET ended_at = datetime('now') WHERE id = ? AND ended_at IS NULL`
  ).run(id);
}

router.get('/', (req, res) => {
  const isLive = getSetting('is_live') === '1';
  const eventId = Number(getSetting('current_event_id') || '1');
  const currentEvent = getEventById(eventId);
  const newInquiries = db
    .prepare(`SELECT COUNT(*) AS c FROM inquiries WHERE status = 'new'`)
    .get().c;

  res.render('admin/dashboard', {
    page: 'admin',
    isLive,
    eventName: currentEvent ? currentEvent.name || '' : '',
    pending: getPendingBoard(eventId),
    recentlyPlayed: getPlayedSetlist(eventId, 'DESC').slice(0, 50),
    liveUrl: getLiveUrl(),
    newInquiries,
  });
});

router.post('/live/toggle', (req, res) => {
  const isLive = getSetting('is_live') === '1';
  const nextEventName = clean(req.body.event_name, 120);
  const currentEventId = Number(getSetting('current_event_id') || '1');

  if (!isLive) {
    // Going live: close out any dangling unended event left over from a
    // "Clear Board" done while offline, then start a fresh one.
    endEvent(currentEventId);
    const newEventId = startNewEvent(nextEventName);
    setSetting('current_event_id', newEventId);
    setSetting('is_live', '1');
  } else {
    endEvent(currentEventId);
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
  const currentEventId = Number(getSetting('current_event_id') || '1');
  const currentEvent = getEventById(currentEventId);

  // Close out the current event segment and start a fresh one under the
  // same name, so "Clear Board" mid-gig still shows up as its own chapter
  // in the event history rather than silently merging with the next one.
  endEvent(currentEventId);
  const newEventId = startNewEvent(currentEvent ? currentEvent.name : null);
  setSetting('current_event_id', newEventId);

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

router.post('/inquiries/:id/delete', (req, res) => {
  const id = Number(req.params.id);
  if (id) {
    db.prepare(`DELETE FROM inquiries WHERE id = ?`).run(id);
  }
  res.redirect('/admin/inquiries');
});

// --- Event history ---------------------------------------------------------

router.get('/events', (req, res) => {
  const currentEventId = Number(getSetting('current_event_id') || '1');

  const events = db
    .prepare(
      `SELECT e.id, e.name, e.started_at, e.ended_at,
              (SELECT COUNT(*) FROM (
                 SELECT DISTINCT normalized_key, played_at
                 FROM song_requests
                 WHERE event_id = e.id AND status = 'played'
               )) AS songs_played,
              (SELECT COUNT(*) FROM song_requests WHERE event_id = e.id) AS total_requests,
              (SELECT COUNT(DISTINCT requested_by) FROM song_requests WHERE event_id = e.id) AS requester_count
       FROM events e
       WHERE e.id = ? OR EXISTS (SELECT 1 FROM song_requests WHERE event_id = e.id)
       ORDER BY e.started_at DESC`
    )
    .all(currentEventId);

  const isLive = getSetting('is_live') === '1';

  res.render('admin/events', { page: 'admin', events, currentEventId, isLive });
});

router.get('/events/:id', (req, res) => {
  const id = Number(req.params.id);
  const event = getEventById(id);

  if (!event) {
    return res.status(404).render('404');
  }

  const stats = db
    .prepare(
      `SELECT COUNT(*) AS total_requests,
              COUNT(DISTINCT requested_by) AS requester_count
       FROM song_requests WHERE event_id = ?`
    )
    .get(id);

  res.render('admin/event-detail', {
    page: 'admin',
    event,
    stats,
    setlist: getPlayedSetlist(id, 'ASC'),
    neverPlayed: getPendingBoard(id),
    currentEventId: Number(getSetting('current_event_id') || '1'),
  });
});

router.post('/events/:id/delete', (req, res) => {
  const id = Number(req.params.id);
  const currentEventId = Number(getSetting('current_event_id') || '1');

  if (id && id !== currentEventId) {
    const deleteRequests = db.prepare(`DELETE FROM song_requests WHERE event_id = ?`);
    const deleteEvent = db.prepare(`DELETE FROM events WHERE id = ?`);
    db.transaction(() => {
      deleteRequests.run(id);
      deleteEvent.run(id);
    })();
  }

  res.redirect('/admin/events');
});

module.exports = router;
