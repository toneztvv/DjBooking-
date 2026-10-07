const express = require('express');
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const { db, getSetting, normalizeKey, getFeatureFlags } = require('../db');
const { liveQrBuffer, urlQrBuffer } = require('../qr');
const { getBattleState } = require('../battles');
const { getTipJar, getTipMethods } = require('../tips');
const { WALL_DIR, MAX_PHOTO_BYTES, WALL_FILE_RE, looksLikeJpeg } = require('../wall');
const { cleanReferral, getReferralInfo } = require('../referrals');
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
  const referralCode = cleanReferral(body.referral_code);

  if (!name || !email || !isValidEmail(email)) {
    return res.status(400).render('book', {
      page: 'book',
      submitted: false,
      error: 'Please provide a valid name and email address.',
      values: { name, email, phone, eventDate, eventType, location, guestCount, message, referralCode },
      referral: getReferralInfo(referralCode),
    });
  }

  db.prepare(
    `INSERT INTO inquiries
      (name, email, phone, event_date, event_type, location, guest_count, message, referral_code)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(name, email, phone, eventDate, eventType, location, guestCount, message, referralCode || null);

  sendInquiryNotification({ name, email, phone, eventDate, eventType, location, guestCount, message, referralCode }).catch(
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
                WHERE u.event_id = sr.event_id AND u.normalized_key = sr.normalized_key) AS upvotes,
              (SELECT d.dedication FROM song_requests d
                WHERE d.event_id = sr.event_id AND d.normalized_key = sr.normalized_key
                  AND d.status = 'pending' AND d.dedication IS NOT NULL AND d.dedication != ''
                ORDER BY d.id LIMIT 1) AS dedication,
              (SELECT d.requested_by FROM song_requests d
                WHERE d.event_id = sr.event_id AND d.normalized_key = sr.normalized_key
                  AND d.status = 'pending' AND d.dedication IS NOT NULL AND d.dedication != ''
                ORDER BY d.id LIMIT 1) AS dedication_by
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
              GROUP_CONCAT(DISTINCT requested_by) AS requesters,
              (SELECT d.dedication FROM song_requests d
                WHERE d.event_id = sr.event_id AND d.normalized_key = sr.normalized_key
                  AND d.status = 'played' AND d.played_at = sr.played_at
                  AND d.dedication IS NOT NULL AND d.dedication != ''
                ORDER BY d.id LIMIT 1) AS dedication,
              (SELECT d.requested_by FROM song_requests d
                WHERE d.event_id = sr.event_id AND d.normalized_key = sr.normalized_key
                  AND d.status = 'played' AND d.played_at = sr.played_at
                  AND d.dedication IS NOT NULL AND d.dedication != ''
                ORDER BY d.id LIMIT 1) AS dedication_by
       FROM song_requests sr
       WHERE sr.event_id = ? AND sr.status = 'played'
       GROUP BY sr.normalized_key, sr.played_at
       ORDER BY sr.played_at DESC
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
  const currentEvent = db.prepare('SELECT name, photowall_unlocked FROM events WHERE id = ?').get(eventId);
  const eventName = (currentEvent && currentEvent.name) || '';
  const features = getFeatureFlags();

  const recentlyPlayed = getRecentlyPlayed(eventId);
  const battleState = isLive && features.battles ? getBattleState(eventId) : { active: null, result: null };

  res.json({
    isLive,
    eventName,
    features,
    activeGuests: isLive && features.guestCounter ? presence.getActiveCount(eventId) : null,
    poll: isLive && features.polls ? getActivePoll(eventId) : null,
    nowPlaying: isLive ? recentlyPlayed[0] || null : null,
    energy: isLive && features.energy ? getEnergy() : null,
    countdown: isLive && features.effects ? getCountdown() : null,
    tips: isLive && features.tips ? getTipJar() : null,
    battle: battleState.active,
    battleResult: battleState.result,
    photoWall: { enabled: isLive && features.photoWall && !!(currentEvent && currentEvent.photowall_unlocked) },
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

  // Dedications and names are shown to the whole room (and on the Big
  // Screen), so they get the same language filter as chat and the guestbook.
  if (containsBannedWord(requestedBy) || containsBannedWord(dedication)) {
    return res.status(400).json({ ok: false, error: 'That name or dedication isn’t allowed. Please remove the inappropriate language and try again.' });
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

// --- Song battles ----------------------------------------------------------------

router.post('/battles/:id/vote', (req, res) => {
  const isLive = getSetting('is_live') === '1';
  const features = getFeatureFlags();
  if (!isLive || !features.battles) {
    return res.status(409).json({ ok: false, error: 'Song battles are turned off right now.' });
  }

  const battleId = Number(req.params.id);
  const choice = clean((req.body || {}).choice, 1);
  const clientId = clean((req.body || {}).client_id, 100);
  if (!['a', 'b'].includes(choice) || !clientId) {
    return res.status(400).json({ ok: false, error: 'Missing vote choice.' });
  }

  const eventId = Number(getSetting('current_event_id') || '1');
  const battle = db
    .prepare(`SELECT * FROM battles WHERE id = ? AND event_id = ? AND closed_at IS NULL`)
    .get(battleId, eventId);
  if (!battle || (battle.ends_at && Date.now() >= battle.ends_at)) {
    return res.status(410).json({ ok: false, error: 'This battle has ended.' });
  }

  try {
    db.prepare(`INSERT INTO battle_votes (battle_id, choice, client_id) VALUES (?, ?, ?)`).run(
      battleId,
      choice,
      clientId
    );
  } catch (err) {
    return res.status(409).json({ ok: false, error: 'You already voted in this battle.' });
  }

  res.status(201).json({ ok: true });
});

// --- Live photo wall ---------------------------------------------------------------

// Small photos only: guests' phones shrink pictures before sending (see
// public/js/wall.js) and this is the hard ceiling on the server too.
const wallUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_PHOTO_BYTES, files: 1, fields: 6 },
});

function wallUploadMiddleware(req, res, next) {
  wallUpload.single('photo')(req, res, (err) => {
    if (!err) return next();
    const tooBig = err.code === 'LIMIT_FILE_SIZE';
    res.status(tooBig ? 413 : 400).json({
      ok: false,
      error: tooBig ? 'That photo is too big — please try a smaller one.' : 'Upload failed — please try again.',
    });
  });
}

// The wall only exists when it is live, switched on, AND this event has been
// unlocked by the DJ (the paid add-on).
function getWallAccess() {
  const isLive = getSetting('is_live') === '1';
  const features = getFeatureFlags();
  const eventId = Number(getSetting('current_event_id') || '1');
  const event = db.prepare('SELECT photowall_unlocked FROM events WHERE id = ?').get(eventId);
  const enabled = isLive && features.photoWall && !!(event && event.photowall_unlocked);
  return { enabled, eventId };
}

function wallUrl(filename) {
  return `/api/wall/photo/${filename}`;
}

router.get('/wall', (req, res) => {
  const { enabled, eventId } = getWallAccess();
  if (!enabled) return res.json({ enabled: false, photos: [], mine: { pending: 0 } });

  const photos = db
    .prepare(
      `SELECT id, filename, uploader_name, caption FROM wall_photos
       WHERE event_id = ? AND status = 'approved' ORDER BY id DESC LIMIT 60`
    )
    .all(eventId)
    .map((p) => ({ id: p.id, url: wallUrl(p.filename), name: p.uploader_name || '', caption: p.caption || '' }));

  const clientId = clean(req.query.client_id, 100);
  const pending = clientId
    ? db
        .prepare(`SELECT COUNT(*) AS c FROM wall_photos WHERE event_id = ? AND client_id = ? AND status = 'pending'`)
        .get(eventId, clientId).c
    : 0;

  res.json({ enabled: true, photos, mine: { pending } });
});

router.post('/wall', wallUploadMiddleware, (req, res) => {
  const { enabled, eventId } = getWallAccess();
  if (!enabled) {
    return res.status(409).json({ ok: false, error: 'The photo wall isn’t open right now.' });
  }

  const body = req.body || {};
  if (clean(body.company_website)) return res.status(201).json({ ok: true });

  if (!req.file || !looksLikeJpeg(req.file.buffer)) {
    return res.status(400).json({ ok: false, error: 'Please choose a photo.' });
  }

  const clientId = clean(body.client_id, 100);
  const name = clean(body.name, 60);
  const caption = clean(body.caption, 80);
  if (!clientId) return res.status(400).json({ ok: false, error: 'Please reload the page and try again.' });

  if (containsBannedWord(name) || containsBannedWord(caption)) {
    return res.status(400).json({ ok: false, error: 'That name or caption isn’t allowed. Please remove the inappropriate language and try again.' });
  }

  const counts = db
    .prepare(
      `SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending
       FROM wall_photos WHERE event_id = ? AND client_id = ?`
    )
    .get(eventId, clientId);
  if ((counts.pending || 0) >= 3) {
    return res.status(429).json({ ok: false, error: 'You have photos waiting for the DJ — give them a minute to approve those first.' });
  }
  if (counts.total >= 12) {
    return res.status(429).json({ ok: false, error: 'You’ve shared the max number of photos for tonight — thank you!' });
  }

  const filename = `${crypto.randomUUID()}.jpg`;
  fs.writeFileSync(path.join(WALL_DIR, filename), req.file.buffer);
  db.prepare(
    `INSERT INTO wall_photos (event_id, filename, uploader_name, caption, client_id) VALUES (?, ?, ?, ?, ?)`
  ).run(eventId, filename, name || null, caption || null, clientId);

  res.status(201).json({ ok: true });
});

// Approved photos are public (anyone with the unguessable link can see
// them, which is how the recap page shows them); pending ones are only
// visible to the DJ through /admin/wall/photo/.
router.get('/wall/photo/:file', (req, res) => {
  const file = String(req.params.file || '');
  if (!WALL_FILE_RE.test(file)) return res.status(404).end();
  const row = db.prepare(`SELECT 1 FROM wall_photos WHERE filename = ? AND status = 'approved'`).get(file);
  if (!row) return res.status(404).end();
  res.set('Cache-Control', 'public, max-age=86400');
  res.type('image/jpeg').sendFile(path.join(WALL_DIR, file));
});

// --- Guest reviews (from the shareable recap page) -----------------------------

router.post('/reviews', (req, res) => {
  const body = req.body || {};
  if (clean(body.company_website)) return res.status(201).json({ ok: true });

  const token = clean(body.token, 64);
  const event = token && db.prepare(`SELECT id, name FROM events WHERE share_token = ?`).get(token);
  if (!event) return res.status(404).json({ ok: false, error: 'This recap link is no longer active.' });

  const rating = Math.round(Number(body.rating));
  const name = clean(body.name, 80);
  const quote = clean(body.quote, 600);
  const clientId = clean(body.client_id, 100);

  if (!(rating >= 1 && rating <= 5)) {
    return res.status(400).json({ ok: false, error: 'Please tap a star rating first.' });
  }
  if (!name || quote.length < 3) {
    return res.status(400).json({ ok: false, error: 'Please add your name and a short comment.' });
  }
  if (containsBannedWord(name) || containsBannedWord(quote)) {
    return res.status(400).json({ ok: false, error: 'That review isn’t allowed. Please remove the inappropriate language and try again.' });
  }

  if (clientId) {
    const already = db
      .prepare(`SELECT 1 FROM testimonials WHERE event_id = ? AND client_id = ? LIMIT 1`)
      .get(event.id, clientId);
    if (already) {
      return res.status(409).json({ ok: false, error: 'You already left a review — thank you!' });
    }
  }

  // Saved hidden: nothing shows on the homepage until the DJ approves it.
  db.prepare(
    `INSERT INTO testimonials (client_name, quote, event_type, rating, published, source, event_id, client_id)
     VALUES (?, ?, ?, ?, 0, 'guest', ?, ?)`
  ).run(name, quote, event.name || null, rating, event.id, clientId || null);

  const googleUrl = getSetting('google_review_url') || '';
  res.status(201).json({ ok: true, googleUrl: rating >= 4 && /^https:\/\//.test(googleUrl) ? googleUrl : '' });
});

// --- Tip jar QR codes (for the Big Screen) -----------------------------------------

router.get('/tip-qr/:method.png', async (req, res, next) => {
  try {
    const method = getTipMethods().find((m) => m.id === req.params.method && m.url);
    if (!method) return res.status(404).end();
    const buffer = await urlQrBuffer(method.url, 360);
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'no-cache');
    res.send(buffer);
  } catch (err) {
    next(err);
  }
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
