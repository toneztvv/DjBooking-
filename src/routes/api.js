const express = require('express');
const { db, getSetting, normalizeKey } = require('../db');
const { liveQrBuffer } = require('../qr');
const { sendInquiryNotification } = require('../mail');
const { sendSms } = require('../sms');
const { containsBannedWord } = require('../moderation');

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

router.get('/live-state', (req, res) => {
  const isLive = getSetting('is_live') === '1';
  const eventId = Number(getSetting('current_event_id') || '1');
  const currentEvent = db.prepare('SELECT name FROM events WHERE id = ?').get(eventId);
  const eventName = (currentEvent && currentEvent.name) || '';

  res.json({
    isLive,
    eventName,
    pending: getPendingBoard(eventId),
    recentlyPlayed: getRecentlyPlayed(eventId),
  });
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

// --- Live chat ---------------------------------------------------------------

// Full snapshot every poll (not just new messages since afterId) so a
// message the DJ deletes actually disappears for guests who already have
// it rendered, not just stop showing up in future polls.
function getChatMessages(eventId) {
  return db
    .prepare(
      `SELECT id, sender_name, message, is_dj, created_at FROM (
         SELECT id, sender_name, message, is_dj, created_at
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

  if (!message) {
    return res.status(400).json({ ok: false, error: 'Please enter a message.' });
  }

  if (containsBannedWord(message)) {
    return res.status(400).json({ ok: false, error: 'That message isn’t allowed. Please remove the inappropriate language and try again.' });
  }

  const eventId = Number(getSetting('current_event_id') || '1');

  const result = db
    .prepare(
      `INSERT INTO chat_messages (event_id, sender_name, message, is_dj)
       VALUES (?, ?, ?, 0)`
    )
    .run(eventId, senderName, message);

  const saved = db
    .prepare(`SELECT id, sender_name, message, is_dj, created_at FROM chat_messages WHERE id = ?`)
    .get(result.lastInsertRowid);

  res.status(201).json({ ok: true, message: saved });
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
