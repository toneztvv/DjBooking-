const express = require('express');
const multer = require('multer');
const { db, getSetting, setSetting, normalizeKey } = require('../db');
const adminAuth = require('../middleware/adminAuth');
const { getLiveUrl, getQrTargetUrl } = require('../qr');
const { recognizeAudio } = require('../audd');
const { getSetupGuideText } = require('../setupGuide');

const router = express.Router();

router.use(adminAuth);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 }, // one short audio clip, generous cap
});

const DJ_PICK_LABEL = 'DJ Pick';

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
              GROUP_CONCAT(DISTINCT requested_by) AS requesters,
              MAX(accepted) AS accepted
       FROM song_requests
       WHERE event_id = ? AND status = 'pending'
       GROUP BY normalized_key
       ORDER BY accepted DESC, times_requested DESC, first_requested_at ASC`
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
    liveUrl: getQrTargetUrl(),
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

function applyDetection(eventId, detected) {
  const { title, artist } = detected;
  if (!title) return { action: 'ignored' };

  const key = normalizeKey(title, artist);

  // Skip if this is the same song we last logged as played for this event —
  // a song usually spans several detection cycles, and we don't want a
  // fresh row (or a wasted API-quota-driven duplicate) for every cycle it's
  // still playing.
  const lastPlayed = db
    .prepare(
      `SELECT normalized_key FROM song_requests
       WHERE event_id = ? AND status = 'played'
       ORDER BY played_at DESC, id DESC LIMIT 1`
    )
    .get(eventId);

  if (lastPlayed && lastPlayed.normalized_key === key) {
    return { action: 'unchanged', title, artist };
  }

  const pendingMatch = db
    .prepare(
      `SELECT COUNT(*) AS c FROM song_requests
       WHERE event_id = ? AND normalized_key = ? AND status = 'pending'`
    )
    .get(eventId, key);

  if (pendingMatch.c > 0) {
    db.prepare(
      `UPDATE song_requests
       SET status = 'played', played_at = datetime('now')
       WHERE event_id = ? AND normalized_key = ? AND status = 'pending'`
    ).run(eventId, key);
    return { action: 'matched_request', title, artist };
  }

  // Nobody requested this one — log it anyway so the event history is a
  // complete tracklist of the night, not just fulfilled requests.
  db.prepare(
    `INSERT INTO song_requests
      (event_id, song_title, artist, normalized_key, requested_by, dedication, created_at, played_at, status)
     VALUES (?, ?, ?, ?, ?, NULL, datetime('now'), datetime('now'), 'played')`
  ).run(eventId, title, artist || null, key, DJ_PICK_LABEL);

  return { action: 'logged_dj_pick', title, artist };
}

router.post('/detect/sample', upload.single('audio'), async (req, res) => {
  const isLive = getSetting('is_live') === '1';
  if (!isLive) {
    return res.status(409).json({ ok: false, error: 'Not live right now — stop listening.' });
  }
  if (!req.file || !req.file.buffer || !req.file.buffer.length) {
    return res.status(400).json({ ok: false, error: 'No audio received.' });
  }

  const eventId = Number(getSetting('current_event_id') || '1');

  try {
    const result = await recognizeAudio(req.file.buffer, req.file.mimetype);
    if (!result || !result.title) {
      return res.json({ ok: true, match: false });
    }
    const outcome = applyDetection(eventId, result);
    return res.json({
      ok: true,
      match: true,
      title: result.title,
      artist: result.artist,
      action: outcome.action,
    });
  } catch (err) {
    if (err.code === 'NOT_CONFIGURED') {
      return res
        .status(503)
        .json({ ok: false, error: 'Song detection is not configured (missing AUDD_API_KEY).' });
    }
    console.error('Song detection failed:', err.message);
    return res.status(502).json({ ok: false, error: 'Detection service hiccup — will retry next cycle.' });
  }
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

router.post('/requests/accept', (req, res) => {
  const key = clean(req.body.normalized_key, 400);
  const eventId = Number(getSetting('current_event_id') || '1');
  const accept = req.body.unaccept !== '1';

  if (key) {
    db.prepare(
      `UPDATE song_requests
       SET accepted = ?
       WHERE event_id = ? AND normalized_key = ? AND status = 'pending'`
    ).run(accept ? 1 : 0, eventId, key);
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

// --- Live chat ---------------------------------------------------------------

router.get('/chat', (req, res) => {
  const eventId = Number(getSetting('current_event_id') || '1');
  const afterId = Number(req.query.afterId) || 0;

  const messages = db
    .prepare(
      `SELECT id, sender_name, message, is_dj, created_at
       FROM chat_messages
       WHERE event_id = ? AND id > ?
       ORDER BY id ASC
       LIMIT 200`
    )
    .all(eventId, afterId);

  res.json({ messages });
});

router.post('/chat/reply', (req, res) => {
  const isLive = getSetting('is_live') === '1';
  if (!isLive) {
    return res.status(409).json({ ok: false, error: 'Go live before replying in chat.' });
  }

  const message = clean(req.body.message, 500);
  if (!message) {
    return res.status(400).json({ ok: false, error: 'Type a message first.' });
  }

  const eventId = Number(getSetting('current_event_id') || '1');
  const result = db
    .prepare(
      `INSERT INTO chat_messages (event_id, sender_name, message, is_dj)
       VALUES (?, 'DJ', ?, 1)`
    )
    .run(eventId, message);

  const saved = db
    .prepare(`SELECT id, sender_name, message, is_dj, created_at FROM chat_messages WHERE id = ?`)
    .get(result.lastInsertRowid);

  res.status(201).json({ ok: true, message: saved });
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

  const chatLog = db
    .prepare(
      `SELECT id, sender_name, message, is_dj, created_at
       FROM chat_messages WHERE event_id = ? ORDER BY id ASC`
    )
    .all(id);

  res.render('admin/event-detail', {
    page: 'admin',
    event,
    stats,
    setlist: getPlayedSetlist(id, 'ASC'),
    neverPlayed: getPendingBoard(id),
    chatLog,
    currentEventId: Number(getSetting('current_event_id') || '1'),
  });
});

router.post('/events/:id/delete', (req, res) => {
  const id = Number(req.params.id);
  const currentEventId = Number(getSetting('current_event_id') || '1');

  if (id && id !== currentEventId) {
    const deleteRequests = db.prepare(`DELETE FROM song_requests WHERE event_id = ?`);
    const deleteChat = db.prepare(`DELETE FROM chat_messages WHERE event_id = ?`);
    const deleteEvent = db.prepare(`DELETE FROM events WHERE id = ?`);
    db.transaction(() => {
      deleteRequests.run(id);
      deleteChat.run(id);
      deleteEvent.run(id);
    })();
  }

  res.redirect('/admin/events');
});

// --- Services & billing -----------------------------------------------------

const EXTERNAL_SERVICES = [
  {
    name: 'Render',
    purpose: 'Hosts the website itself — the app, the database, everything.',
    cost: 'Paid plan + disk, ~$7.25/month',
    url: 'https://dashboard.render.com',
  },
  {
    name: 'Cloudflare',
    purpose: 'dj-xpress.com is registered here, and its DNS is managed here.',
    cost: 'Domain renews yearly, ~$10–12/year',
    url: 'https://dash.cloudflare.com',
  },
  {
    name: 'Resend',
    purpose: 'Sends you an email the moment someone submits a booking.',
    cost: 'Free up to 3,000 emails/month',
    url: 'https://resend.com/overview',
  },
  {
    name: 'AudD',
    purpose: 'Powers automatic song detection (identifies what’s playing).',
    cost: 'Pay-as-you-go, ~$5 per 1,000 recognitions',
    url: 'https://dashboard.audd.io',
  },
  {
    name: 'Twilio',
    purpose: 'Texts your phone for new bookings and new song requests.',
    cost: '~$1/month for the number, plus ~1¢ per text',
    url: 'https://console.twilio.com',
    status: 'Coming soon — built, not turned on yet (requires adding a card)',
  },
];

router.get('/services', (req, res) => {
  res.render('admin/services', { page: 'admin', services: EXTERNAL_SERVICES });
});

router.get('/setup-guide', (req, res) => {
  res.render('admin/setup-guide', { page: 'admin', guideText: getSetupGuideText() });
});

router.get('/setup-guide/download', (req, res) => {
  res.set('Content-Type', 'text/plain; charset=utf-8');
  res.set('Content-Disposition', 'attachment; filename="djxpress-setup-guide.txt"');
  res.send(getSetupGuideText());
});

module.exports = router;
