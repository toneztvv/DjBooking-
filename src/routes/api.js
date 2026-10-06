const express = require('express');
const { db, getSetting, normalizeKey, getFeatureFlags } = require('../db');
const { liveQrBuffer } = require('../qr');
const { sendInquiryNotification } = require('../mail');
const { sendSms } = require('../sms');
const { containsBannedWord } = require('../moderation');
const presence = require('../presence');

const router = express.Router();

function clean(value, maxLen = 300) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLen);
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// --- Booking inquiries ---------------------------------------------------

router.post('/inquiries', (req, res) => {
  const body = req.body || {};

  // Honeypot field: real users never fill this in.
  if (clean(body.company_website)) {
    return res.redirect('/book?submitted=1');
  }

  const name = clean(body.name, 120);
  const email = clean(body.email, 200);
  const phone = clean(body.phone, 60);
  const eventDate = clean(body.event_date, 60);
  const eventType = clean(body.event_type, 60);
  const location = clean(body.location, 200);
  const guestCount = clean(body.guest_count, 60);
  const message = clean(body.message, 2000);

  if (!name || !email || !isValidEmail(email)) {
    return res.status(400).render('book', {
      page: 'book',
      submitted: false,
      error: 'Please provide a valid name and email address.',
      values: { name, email, phone, eventDate, eventType, location, guestCount, message },
    });
  }

  db.prepare(
    `INSERT INTO inquiries
      (name, email, phone, event_date, event_type, location, guest_count, message)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(name, email, phone, eventDate, eventType, location, guestCount, message);

  sendInquiryNotification({ name, email, phone, eventDate, eventType, location, guestCount, message }).catch(
    (err) => console.error('Failed to send inquiry notification email:', err.message)
  );

  sendSms(`DJXpress: New booking inquiry from ${name}${eventType ? ` (${eventType})` : ''}. Check your email or /admin for details.`).catch(
    (err) => console.error('Failed to send inquiry notification SMS:', err.message)
  );

  if (req.headers.accept && req.headers.accept.includes('application/json')) {
    return res.status(201).json({ ok: true });
  }
  res.redirect('/book?submitted=1');
});

// --- Live song requests ---------------------------------------------------

function getPendingBoard(eventId) {
  return db
    .prepare(
      `SELECT sr.normalized_key,
              sr.song_title,
              sr.artist,
              COUNT(*) AS times_requested,
              MIN(sr.created_at) AS first_requested_at,
              GROUP_CONCAT(DISTINCT sr.requested_by) AS requesters,
              MAX(sr.accepted) AS accepted,
              (SELECT COUNT(*) FROM request_upvotes u
                WHERE u.event_id = sr.event_id AND u.normalized_key = sr.normalized_key) AS upvotes
       FROM song_requests sr
       WHERE sr.event_id = ? AND sr.status = 'pending'
       GROUP BY sr.normalized_key
       ORDER BY accepted DESC, (times_requested + upvotes) DESC, first_requested_at ASC`
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
              MAX(artwork_url) AS artwork_url,
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

function getActivePoll(eventId) {
  const poll = db
    .prepare(`SELECT * FROM polls WHERE event_id = ? AND closed_at IS NULL ORDER BY id DESC LIMIT 1`)
    .get(eventId);
  if (!poll) return null;

  const counts = db
    .prepare(`SELECT choice, COUNT(*) AS n FROM poll_votes WHERE poll_id = ? GROUP BY choice`)
    .all(poll.id);
  const votesA = counts.find((c) => c.choice === 'a')?.n || 0;
  const votesB = counts.find((c) => c.choice === 'b')?.n || 0;

  return {
    id: poll.id,
    question: poll.question,
    optionA: poll.option_a,
    optionB: poll.option_b,
    votesA,
    votesB,
  };
}

const ENERGY_LABELS = [
  [0, 'Warming up'],
  [3, 'Getting loose'],
  [5, 'Heating up'],
  [7, 'On fire'],
  [9, 'Absolutely insane'],
];

function getEnergy() {
  const level = Math.min(10, Math.max(0, Number(getSetting('energy_level')) || 0));
  const label = ENERGY_LABELS.filter(([min]) => level >= min).pop()[1];
  return { level, label };
}

// The DJ can set a "moment" countdown (cake cutting, first dance...). We send
// seconds remaining rather than a timestamp so a guest's wrong phone clock
// can't skew it.
function getCountdown() {
  const label = getSetting('countdown_label');
  const endsAt = Number(getSetting('countdown_ends_at'));
  if (!label || !endsAt) return null;
  const remaining = Math.round((endsAt - Date.now()) / 1000);
  if (remaining < -30) return null; // linger on "NOW" for 30s, then vanish
  return { label, remainingSeconds: remaining };
}

router.get('/live-state', (req, res) => {
  const isLive = getSetting('is_live') === '1';
  const eventId = Number(getSetting('current_event_id') || '1');
  const currentEvent = db.prepare('SELECT name FROM events WHERE id = ?').get(eventId);
  const eventName = (currentEvent && currentEvent.name) || '';
  const features = getFeatureFlags();

  const recentlyPlayed = getRecentlyPlayed(eventId);

  res.json({
    isLive,
    eventName,
    features,
    activeGuests: isLive && features.guestCounter ? presence.getActiveCount(eventId) : null,
    poll: isLive && features.polls ? getActivePoll(eventId) : null,
    nowPlaying: isLive ? recentlyPlayed[0] || null : null,
    energy: isLive && features.energy ? getEnergy() : null,
    countdown: isLive && features.effects ? getCountdown() : null,
    pending: getPendingBoard(eventId),
    recentlyPlayed,
  });
});

// Effects the DJ fires (confetti, shoutouts, sounds...). Only recent ones are
// returned so a phone that wakes up later doesn't replay old drops, and a
// fresh page load starts from "now" using latestId rather than replaying.
router.get('/effects', (req, res) => {
  const isLive = getSetting('is_live') === '1';
  const features = getFeatureFlags();
  if (!isLive || !features.effects) {
    return res.json({ enabled: false, latestId: 0, effects: [] });
  }

  const eventId = Number(getSetting('current_event_id') || '1');
  const latest = db
    .prepare(`SELECT COALESCE(MAX(id), 0) AS id FROM drops WHERE event_id = ?`)
    .get(eventId).id;

  const afterId = req.query.afterId === undefined ? null : Number(req.query.afterId) || 0;
  if (afterId === null) {
    return res.json({ enabled: true, latestId: latest, effects: [] });
  }

  const effects = db
    .prepare(
      `SELECT id, kind, message FROM drops
       WHERE event_id = ? AND id > ? AND created_at >= datetime('now', '-20 seconds')
       ORDER BY id ASC LIMIT 20`
    )
    .all(eventId, afterId);

  res.json({ enabled: true, latestId: latest, effects });
});

router.post('/presence/ping', (req, res) => {
  const isLive = getSetting('is_live') === '1';
  const features = getFeatureFlags();
  if (!isLive || !features.guestCounter) {
    return res.json({ ok: true });
  }

  const clientId = clean((req.body || {}).client_id, 100);
  if (clientId) {
    const eventId = Number(getSetting('current_event_id') || '1');
    presence.recordPing(eventId, clientId);
  }

  res.json({ ok: true });
});

router.post('/requests', (req, res) => {
  const isLive = getSetting('is_live') === '1';
  if (!isLive) {
    return res.status(409).json({ ok: false, error: 'The DJ is not live right now.' });
  }

  const body = req.body || {};

  if (clean(body.company_website)) {
    return res.status(201).json({ ok: true });
  }

  const songTitle = clean(body.song_title, 150);
  const artist = clean(body.artist, 150);
  const requestedBy = clean(body.requested_by, 80);
  const dedication = clean(body.dedication, 300);

  if (!songTitle || !requestedBy) {
    return res.status(400).json({ ok: false, error: 'Please enter your name and a song title.' });
  }

  const eventId = Number(getSetting('current_event_id') || '1');
  const key = normalizeKey(songTitle, artist);

  const alreadyRequested = db
    .prepare(
      `SELECT 1 FROM song_requests WHERE event_id = ? AND normalized_key = ? AND status = 'pending' LIMIT 1`
    )
    .get(eventId, key);

  db.prepare(
    `INSERT INTO song_requests
      (event_id, song_title, artist, normalized_key, requested_by, dedication)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(eventId, songTitle, artist || null, key, requestedBy, dedication || null);

  // Only text for the first request of a given song per event — a song
  // getting re-requested by more guests doesn't need a fresh text each time.
  if (!alreadyRequested) {
    sendSms(
      `DJXpress: New song request — "${songTitle}"${artist ? ` by ${artist}` : ''}, requested by ${requestedBy}.`
    ).catch((err) => console.error('Failed to send song request SMS:', err.message));
  }

  res.status(201).json({ ok: true });
});

router.post('/requests/upvote', (req, res) => {
  const isLive = getSetting('is_live') === '1';
  if (!isLive) {
    return res.status(409).json({ ok: false, error: 'The DJ is not live right now.' });
  }

  const key = clean((req.body || {}).normalized_key, 400);
  const clientId = clean((req.body || {}).client_id, 100);

  if (!key || !clientId) {
    return res.status(400).json({ ok: false, error: 'Missing request or chatter id.' });
  }

  const eventId = Number(getSetting('current_event_id') || '1');
  const exists = db
    .prepare(`SELECT 1 FROM song_requests WHERE event_id = ? AND normalized_key = ? AND status = 'pending' LIMIT 1`)
    .get(eventId, key);

  if (!exists) {
    return res.status(404).json({ ok: false, error: 'That request is no longer pending.' });
  }

  try {
    db.prepare(
      `INSERT INTO request_upvotes (event_id, normalized_key, client_id) VALUES (?, ?, ?)`
    ).run(eventId, key, clientId);
  } catch (err) {
    return res.status(409).json({ ok: false, error: 'You already boosted this request.' });
  }

  res.status(201).json({ ok: true });
});

// --- Booking calendar --------------------------------------------------------

router.get('/booked-dates', (req, res) => {
  const rows = db
    .prepare(
      `SELECT DISTINCT event_date FROM inquiries
       WHERE status = 'booked' AND event_date IS NOT NULL AND event_date != ''`
    )
    .all();
  res.json({ dates: rows.map((r) => r.event_date) });
});

// --- Live chat ---------------------------------------------------------------

// A fixed palette guests pick from client-side for their chat/guestbook
// display color — validated against this list server-side so an inline
// style value never comes from unsanitized user input.
const GUEST_COLORS = [
  '#ff6b9d', '#33e0ff', '#7c4dff', '#34d399', '#fbbf24',
  '#fb923c', '#f87171', '#a78bfa', '#4ade80', '#38bdf8',
];
function cleanColor(value) {
  return GUEST_COLORS.includes(value) ? value : null;
}

// Full snapshot every poll (not just new messages since afterId) so a
// message the DJ deletes actually disappears for guests who already have
// it rendered, not just stop showing up in future polls.
function getChatMessages(eventId) {
  return db
    .prepare(
      `SELECT id, sender_name, message, is_dj, color, created_at FROM (
         SELECT id, sender_name, message, is_dj, color, created_at
         FROM chat_messages WHERE event_id = ?
         ORDER BY id DESC LIMIT 200
       ) sub ORDER BY id ASC`
    )
    .all(eventId);
}

router.get('/chat', (req, res) => {
  const isLive = getSetting('is_live') === '1';
  const eventId = Number(getSetting('current_event_id') || '1');

  res.json({
    isLive,
    messages: isLive ? getChatMessages(eventId) : [],
  });
});

router.post('/chat', (req, res) => {
  const isLive = getSetting('is_live') === '1';
  if (!isLive) {
    return res.status(409).json({ ok: false, error: 'The DJ is not live right now.' });
  }

  const body = req.body || {};

  if (clean(body.company_website)) {
    return res.status(201).json({ ok: true });
  }

  const senderName = clean(body.sender_name, 60) || 'Guest';
  const message = clean(body.message, 500);
  const color = cleanColor(body.color);

  if (!message) {
    return res.status(400).json({ ok: false, error: 'Please enter a message.' });
  }

  if (containsBannedWord(message)) {
    return res.status(400).json({ ok: false, error: 'That message isn’t allowed. Please remove the inappropriate language and try again.' });
  }

  const eventId = Number(getSetting('current_event_id') || '1');

  const result = db
    .prepare(
      `INSERT INTO chat_messages (event_id, sender_name, message, is_dj, color)
       VALUES (?, ?, ?, 0, ?)`
    )
    .run(eventId, senderName, message, color);

  const saved = db
    .prepare(`SELECT id, sender_name, message, is_dj, color, created_at FROM chat_messages WHERE id = ?`)
    .get(result.lastInsertRowid);

  res.status(201).json({ ok: true, message: saved });
});

// --- Live reactions ----------------------------------------------------------

const ALLOWED_REACTIONS = ['🔥', '❤️', '🙌', '😂', '👏'];

router.get('/reactions', (req, res) => {
  const isLive = getSetting('is_live') === '1';
  const features = getFeatureFlags();
  if (!isLive || !features.reactions) {
    return res.json({ enabled: false, recent: [], counts: {} });
  }

  const eventId = Number(getSetting('current_event_id') || '1');
  const afterId = Number(req.query.afterId) || 0;

  const recent = db
    .prepare(
      `SELECT id, emoji FROM reactions
       WHERE event_id = ? AND id > ?
       ORDER BY id ASC LIMIT 100`
    )
    .all(eventId, afterId);

  const countRows = db
    .prepare(`SELECT emoji, COUNT(*) AS n FROM reactions WHERE event_id = ? GROUP BY emoji`)
    .all(eventId);
  const counts = {};
  countRows.forEach((r) => (counts[r.emoji] = r.n));

  res.json({ enabled: true, recent, counts });
});

router.post('/reactions', (req, res) => {
  const isLive = getSetting('is_live') === '1';
  const features = getFeatureFlags();
  if (!isLive || !features.reactions) {
    return res.status(409).json({ ok: false, error: 'Reactions are turned off right now.' });
  }

  const emoji = clean((req.body || {}).emoji, 10);
  if (!ALLOWED_REACTIONS.includes(emoji)) {
    return res.status(400).json({ ok: false, error: 'Unknown reaction.' });
  }

  const eventId = Number(getSetting('current_event_id') || '1');
  db.prepare(`INSERT INTO reactions (event_id, emoji) VALUES (?, ?)`).run(eventId, emoji);

  res.status(201).json({ ok: true });
});

// --- Quick polls ---------------------------------------------------------------

router.post('/polls/:id/vote', (req, res) => {
  const isLive = getSetting('is_live') === '1';
  const features = getFeatureFlags();
  if (!isLive || !features.polls) {
    return res.status(409).json({ ok: false, error: 'Polls are turned off right now.' });
  }

  const pollId = Number(req.params.id);
  const choice = clean((req.body || {}).choice, 1);
  const clientId = clean((req.body || {}).client_id, 100);

  if (!['a', 'b'].includes(choice) || !clientId) {
    return res.status(400).json({ ok: false, error: 'Missing vote choice.' });
  }

  const poll = db.prepare(`SELECT * FROM polls WHERE id = ? AND closed_at IS NULL`).get(pollId);
  if (!poll) {
    return res.status(410).json({ ok: false, error: 'This poll has closed.' });
  }

  try {
    db.prepare(`INSERT INTO poll_votes (poll_id, choice, client_id) VALUES (?, ?, ?)`).run(
      pollId,
      choice,
      clientId
    );
  } catch (err) {
    return res.status(409).json({ ok: false, error: 'You already voted on this poll.' });
  }

  res.status(201).json({ ok: true });
});

// --- Guestbook / love notes ---------------------------------------------------

router.get('/guestbook', (req, res) => {
  const isLive = getSetting('is_live') === '1';
  const features = getFeatureFlags();
  if (!isLive || !features.guestbook) {
    return res.json({ enabled: false, entries: [] });
  }

  const eventId = Number(getSetting('current_event_id') || '1');
  const entries = db
    .prepare(
      `SELECT id, name, message, color, created_at FROM guestbook_entries
       WHERE event_id = ? ORDER BY id DESC LIMIT 200`
    )
    .all(eventId);

  res.json({ enabled: true, entries });
});

router.post('/guestbook', (req, res) => {
  const isLive = getSetting('is_live') === '1';
  const features = getFeatureFlags();
  if (!isLive || !features.guestbook) {
    return res.status(409).json({ ok: false, error: 'The guestbook is turned off right now.' });
  }

  const body = req.body || {};
  if (clean(body.company_website)) {
    return res.status(201).json({ ok: true });
  }

  const name = clean(body.name, 80);
  const message = clean(body.message, 500);
  const color = cleanColor(body.color);

  if (!name || !message) {
    return res.status(400).json({ ok: false, error: 'Please enter your name and a message.' });
  }

  if (containsBannedWord(name) || containsBannedWord(message)) {
    return res.status(400).json({ ok: false, error: 'That message isn’t allowed. Please remove the inappropriate language and try again.' });
  }

  const eventId = Number(getSetting('current_event_id') || '1');
  const result = db
    .prepare(`INSERT INTO guestbook_entries (event_id, name, message, color) VALUES (?, ?, ?, ?)`)
    .run(eventId, name, message, color);

  const saved = db
    .prepare(`SELECT id, name, message, color, created_at FROM guestbook_entries WHERE id = ?`)
    .get(result.lastInsertRowid);

  res.status(201).json({ ok: true, entry: saved });
});

// --- QR code ---------------------------------------------------------------

router.get('/qrcode.png', async (req, res, next) => {
  try {
    const size = Math.min(Math.max(Number(req.query.size) || 512, 128), 2000);
    const buffer = await liveQrBuffer(size);
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'no-cache');
    res.send(buffer);
  } catch (err) {
    next(err);
  }
});

router.get('/qrcode/download', async (req, res, next) => {
  try {
    const buffer = await liveQrBuffer(1200);
    res.set('Content-Type', 'image/png');
    res.set('Content-Disposition', 'attachment; filename="djxpress-live-requests-qr.png"');
    res.send(buffer);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
