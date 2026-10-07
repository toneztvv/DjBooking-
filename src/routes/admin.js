const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { db, getSetting, setSetting, normalizeKey, getFeatureFlags } = require('../db');
const adminAuth = require('../middleware/adminAuth');
const { getLiveUrl, getQrTargetUrl } = require('../qr');
const { recognizeAudio } = require('../audd');
const { getSetupGuideText } = require('../setupGuide');
const { toCsv } = require('../csv');
const { fetchArtworkUrl } = require('../albumArt');
const { closeBattle, getBattleState } = require('../battles');
const { getTipMethods, VENMO_RE, CASHAPP_RE } = require('../tips');
const { WALL_DIR, WALL_FILE_RE, deleteWallFile } = require('../wall');
const { ensureEventReferralCode } = require('../referrals');
const { getSiteUrl } = require('../qr');
const stripe = require('../stripe');
const {
  getPhotoWallPriceCents,
  formatMoney,
  recordPhotoWallPayment,
  getPassPriceCents,
  createPassRow,
} = require('../payments');

const router = express.Router();

// CSRF guard. The browser re-sends the saved admin login to ANY site that asks,
// so without this a malicious web page could submit a hidden form to this
// dashboard (e.g. "End live event", "Approve photo") while the DJ is logged in.
// Every state-changing request must come from this site itself.
function sameOriginOnly(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  const deny = () => res.status(403).send('Blocked: request did not come from this site.');

  // Modern browsers label every request with where it came from, and a web
  // page cannot fake or remove this label.
  const fetchSite = req.headers['sec-fetch-site'];
  if (fetchSite) return fetchSite === 'same-origin' || fetchSite === 'none' ? next() : deny();

  // Older browsers: fall back to the Origin header (must be this very site).
  const origin = req.headers.origin;
  if (!origin) return next(); // non-browser tools (curl) — they have no logged-in browser to abuse
  try {
    return new URL(origin).host === req.headers.host ? next() : deny();
  } catch (err) {
    return deny();
  }
}

router.use(sameOriginOnly);
router.use(adminAuth);

// What the admin navigation bar needs on every page: which page is open and
// the little "new" counters.
router.use((req, res, next) => {
  res.locals.adminPath = req.originalUrl.split('?')[0].replace(/\/+$/, '') || '/admin';
  if (req.method === 'GET' && req.accepts('html') && !/^\/admin\/(wall|battles|chat|export|plans\/\d+\/download)/.test(res.locals.adminPath)) {
    res.locals.adminBadges = {
      inquiries: db.prepare(`SELECT COUNT(*) AS c FROM inquiries WHERE status = 'new'`).get().c,
      reviews: db.prepare(`SELECT COUNT(*) AS c FROM testimonials WHERE source = 'guest' AND published = 0`).get().c,
    };
  }
  next();
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 }, // one short audio clip, generous cap
});

// Gallery photos/videos live on the same persistent disk as the database
// (not in memory) so they survive restarts and deploys.
const GALLERY_DIR = path.join(__dirname, '..', '..', 'data', 'gallery');
if (!fs.existsSync(GALLERY_DIR)) fs.mkdirSync(GALLERY_DIR, { recursive: true });

const galleryUpload = multer({
  storage: multer.diskStorage({
    destination: GALLERY_DIR,
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `${crypto.randomUUID()}${ext}`);
    },
  }),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/^image\/|^video\//.test(file.mimetype)) return cb(null, true);
    cb(new Error('Only image or video files are allowed'));
  },
});

const DJ_PICK_LABEL = 'DJ Pick';

function clean(value, maxLen = 300) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLen);
}

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

function getPlayedSetlist(eventId, order = 'DESC') {
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
       ORDER BY played_at ${order === 'ASC' ? 'ASC' : 'DESC'}`
    )
    .all(eventId);
}

function getEventById(id) {
  return db.prepare('SELECT * FROM events WHERE id = ?').get(id);
}

// Photo Wall mode for an event: 0 = off, 1 = free for everyone (host paid),
// 2 = each guest buys a Photo Pass to upload.
function cleanWallMode(value) {
  const n = Number(value);
  return n === 1 || n === 2 ? n : 0;
}

function startNewEvent(name, wallMode = 0) {
  const result = db
    .prepare(`INSERT INTO events (name, started_at, photowall_unlocked) VALUES (?, datetime('now'), ?)`)
    .run(name || null, cleanWallMode(wallMode));
  return result.lastInsertRowid;
}

function endEvent(id) {
  db.prepare(
    `UPDATE events SET ended_at = datetime('now') WHERE id = ? AND ended_at IS NULL`
  ).run(id);
}

function getActivePollWithCounts(eventId) {
  const poll = db
    .prepare(`SELECT * FROM polls WHERE event_id = ? AND closed_at IS NULL ORDER BY id DESC LIMIT 1`)
    .get(eventId);
  if (!poll) return null;

  const counts = db
    .prepare(`SELECT choice, COUNT(*) AS n FROM poll_votes WHERE poll_id = ? GROUP BY choice`)
    .all(poll.id);
  poll.votesA = counts.find((c) => c.choice === 'a')?.n || 0;
  poll.votesB = counts.find((c) => c.choice === 'b')?.n || 0;
  return poll;
}

// Bookings the DJ can attach an event to, so a paid Photo Wall unlocks itself.
function getBookingsForPicker() {
  return db
    .prepare(
      `SELECT id, name, event_type, event_date, photowall_paid_at FROM inquiries
       WHERE status != 'declined'
       ORDER BY (status = 'booked') DESC, created_at DESC LIMIT 100`
    )
    .all();
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
    features: getFeatureFlags(),
    activePoll: getActivePollWithCounts(eventId),
    energyLevel: Math.min(10, Math.max(0, Number(getSetting('energy_level')) || 0)),
    defaultPassword: !process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD === 'changeme123',
    battle: getBattleState(eventId).active,
    wallMode: currentEvent ? cleanWallMode(currentEvent.photowall_unlocked) : 0,
    passReady: stripe.isConfigured() && getPassPriceCents() > 0,
    passPrice: getPassPriceCents() ? formatMoney(getPassPriceCents()) : '',
    passStats: db
      .prepare(
        `SELECT COUNT(*) AS active, COALESCE(SUM(CASE WHEN source = 'stripe' THEN amount_cents END), 0) AS cents
         FROM photo_passes WHERE status = 'active'`
      )
      .get(),
    bookings: getBookingsForPicker(),
    eventBooking:
      currentEvent && currentEvent.inquiry_id
        ? db.prepare(`SELECT id, name, photowall_paid_at, photowall_pay_method FROM inquiries WHERE id = ?`).get(currentEvent.inquiry_id)
        : null,
    tipMethodCount: getTipMethods().length,
    pendingReviews: db.prepare(`SELECT COUNT(*) AS c FROM testimonials WHERE source = 'guest' AND published = 0`).get().c,
  });
});

// --- Live page feature toggles ------------------------------------------------

const TOGGLEABLE_FEATURES = {
  guest_counter: 'feature_guest_counter',
  reactions: 'feature_reactions',
  polls: 'feature_polls',
  guestbook: 'feature_guestbook',
  effects: 'feature_effects',
  energy: 'feature_energy',
  tips: 'feature_tips',
  battles: 'feature_battles',
  photowall: 'feature_photowall',
};

router.post('/features/:feature/toggle', (req, res) => {
  const settingKey = TOGGLEABLE_FEATURES[req.params.feature];
  if (settingKey) {
    const isOn = getSetting(settingKey) !== '0';
    setSetting(settingKey, isOn ? '0' : '1');
  }
  res.redirect('/admin');
});

router.post('/live/toggle', (req, res) => {
  const isLive = getSetting('is_live') === '1';
  const nextEventName = clean(req.body.event_name, 120);
  const currentEventId = Number(getSetting('current_event_id') || '1');

  if (!isLive) {
    // Going live: close out any dangling unended event left over from a
    // "Clear Board" done while offline, then start a fresh one.
    endEvent(currentEventId);
    // The Photo Wall is a paid add-on: it stays locked unless the DJ ticks
    // the box, which they only do once the client has paid for it.
    const booking = Number(req.body.inquiry_id)
      ? db.prepare(`SELECT id, name, event_type, photowall_paid_at FROM inquiries WHERE id = ?`).get(Number(req.body.inquiry_id))
      : null;
    const eventName = nextEventName || (booking ? `${booking.name}${booking.event_type ? ' — ' + booking.event_type : ''}` : '');
    // A booking whose Photo Wall add-on is paid makes it free for the whole
    // room (mode 1); otherwise use what the DJ picked on the form.
    const wallMode = booking && booking.photowall_paid_at ? 1 : cleanWallMode(req.body.wall_mode);
    const newEventId = startNewEvent(eventName, wallMode);
    if (booking) db.prepare(`UPDATE events SET inquiry_id = ? WHERE id = ?`).run(booking.id, newEventId);
    setSetting('current_event_id', newEventId);
    setSetting('is_live', '1');
    setSetting('energy_level', '0');
    setSetting('countdown_label', '');
    setSetting('countdown_ends_at', '');
  } else {
    endEvent(currentEventId);
    setSetting('is_live', '0');
  }

  res.redirect('/admin');
});

// Fire-and-forget: looks up cover art after a song is marked played and
// backfills it once found. Never blocks the request that triggered it —
// worst case a song just shows without artwork.
function fetchAndSaveArtwork(eventId, key, title, artist) {
  fetchArtworkUrl(title, artist)
    .then((url) => {
      if (!url) return;
      db.prepare(
        `UPDATE song_requests SET artwork_url = ?
         WHERE event_id = ? AND normalized_key = ? AND artwork_url IS NULL`
      ).run(url, eventId, key);
    })
    .catch(() => {});
}

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
    fetchAndSaveArtwork(eventId, key, title, artist);
    return { action: 'matched_request', title, artist };
  }

  // Nobody requested this one — log it anyway so the event history is a
  // complete tracklist of the night, not just fulfilled requests.
  db.prepare(
    `INSERT INTO song_requests
      (event_id, song_title, artist, normalized_key, requested_by, dedication, created_at, played_at, status)
     VALUES (?, ?, ?, ?, ?, NULL, datetime('now'), datetime('now'), 'played')`
  ).run(eventId, title, artist || null, key, DJ_PICK_LABEL);
  fetchAndSaveArtwork(eventId, key, title, artist);

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
    const row = db
      .prepare(`SELECT song_title, artist FROM song_requests WHERE event_id = ? AND normalized_key = ? LIMIT 1`)
      .get(eventId, key);

    db.prepare(
      `UPDATE song_requests
       SET status = 'played', played_at = datetime('now')
       WHERE event_id = ? AND normalized_key = ? AND status = 'pending'`
    ).run(eventId, key);

    if (row) fetchAndSaveArtwork(eventId, key, row.song_title, row.artist);
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
  const newEventId = startNewEvent(
    currentEvent ? currentEvent.name : null,
    currentEvent ? currentEvent.photowall_unlocked : 0
  );
  if (currentEvent && currentEvent.inquiry_id) {
    db.prepare(`UPDATE events SET inquiry_id = ? WHERE id = ?`).run(currentEvent.inquiry_id, newEventId);
  }
  setSetting('current_event_id', newEventId);

  res.redirect('/admin');
});

// --- Live chat ---------------------------------------------------------------

router.get('/chat', (req, res) => {
  const eventId = Number(getSetting('current_event_id') || '1');

  const messages = db
    .prepare(
      `SELECT id, sender_name, message, is_dj, color, created_at FROM (
         SELECT id, sender_name, message, is_dj, color, created_at
         FROM chat_messages WHERE event_id = ?
         ORDER BY id DESC LIMIT 200
       ) sub ORDER BY id ASC`
    )
    .all(eventId);

  res.json({ messages });
});

router.post('/chat/:id/delete', (req, res) => {
  const id = Number(req.params.id);
  if (id) {
    db.prepare(`DELETE FROM chat_messages WHERE id = ?`).run(id);
  }
  res.json({ ok: true });
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

// --- Quick polls ---------------------------------------------------------------

router.post('/polls', (req, res) => {
  const isLive = getSetting('is_live') === '1';
  if (!isLive) {
    return res.redirect('/admin');
  }

  const question = clean(req.body.question, 200);
  const optionA = clean(req.body.option_a, 60);
  const optionB = clean(req.body.option_b, 60);

  if (question && optionA && optionB) {
    const eventId = Number(getSetting('current_event_id') || '1');
    // Only one active poll at a time — starting a new one auto-closes the last.
    db.prepare(`UPDATE polls SET closed_at = datetime('now') WHERE event_id = ? AND closed_at IS NULL`).run(eventId);
    db.prepare(
      `INSERT INTO polls (event_id, question, option_a, option_b) VALUES (?, ?, ?, ?)`
    ).run(eventId, question, optionA, optionB);
  }

  res.redirect('/admin');
});

router.post('/polls/:id/close', (req, res) => {
  const id = Number(req.params.id);
  if (id) {
    db.prepare(`UPDATE polls SET closed_at = datetime('now') WHERE id = ? AND closed_at IS NULL`).run(id);
  }
  res.redirect('/admin');
});

// --- Guestbook / love notes ---------------------------------------------------

router.get('/guestbook', (req, res) => {
  const entries = db
    .prepare(
      `SELECT g.*, e.name AS event_name FROM guestbook_entries g
       LEFT JOIN events e ON e.id = g.event_id
       ORDER BY g.created_at DESC`
    )
    .all();
  res.render('admin/guestbook', { page: 'admin', entries });
});

router.post('/guestbook/:id/delete', (req, res) => {
  const id = Number(req.params.id);
  if (id) {
    db.prepare(`DELETE FROM guestbook_entries WHERE id = ?`).run(id);
  }
  res.redirect('/admin/guestbook');
});

// --- Hype controls: drops, soundboard, energy, countdown --------------------

const VISUAL_DROPS = ['confetti', 'wash', 'fireworks', 'shoutout'];
const SOUND_DROPS = ['airhorn', 'siren', 'cheer', 'scratch', 'drumroll', 'laser'];

router.post('/drops', (req, res) => {
  const isLive = getSetting('is_live') === '1';
  if (!isLive) {
    return res.status(409).json({ ok: false, error: 'Go live first.' });
  }
  if (!getFeatureFlags().effects) {
    return res.status(409).json({ ok: false, error: 'Drops are switched off in Live Page Features.' });
  }

  const kind = clean((req.body || {}).kind, 30);
  const isSound = kind.startsWith('sound:') && SOUND_DROPS.includes(kind.slice(6));
  if (!VISUAL_DROPS.includes(kind) && !isSound) {
    return res.status(400).json({ ok: false, error: 'Unknown effect.' });
  }

  let message = clean((req.body || {}).message, 140);
  if (kind === 'shoutout' && !message) {
    return res.status(400).json({ ok: false, error: 'Type a shoutout first.' });
  }
  if (kind !== 'shoutout') message = '';

  const eventId = Number(getSetting('current_event_id') || '1');
  db.prepare(`INSERT INTO drops (event_id, kind, message) VALUES (?, ?, ?)`).run(
    eventId,
    kind,
    message || null
  );
  res.status(201).json({ ok: true });
});

router.post('/energy', (req, res) => {
  const level = Math.min(10, Math.max(0, Math.round(Number((req.body || {}).level)) || 0));
  setSetting('energy_level', level);
  res.json({ ok: true, level });
});

router.post('/countdown', (req, res) => {
  const label = clean((req.body || {}).label, 60);
  const minutes = Number((req.body || {}).minutes);
  if (!label || !(minutes > 0) || minutes > 180) {
    return res.status(400).json({ ok: false, error: 'Add a label and 1–180 minutes.' });
  }
  setSetting('countdown_label', label);
  setSetting('countdown_ends_at', Date.now() + Math.round(minutes * 60 * 1000));
  res.json({ ok: true });
});

router.post('/countdown/clear', (req, res) => {
  setSetting('countdown_label', '');
  setSetting('countdown_ends_at', '');
  res.json({ ok: true });
});

router.get('/inquiries', (req, res) => {
  const inquiries = db
    .prepare(
      `SELECT i.*,
              p.token AS plan_token,
              p.updated_at AS plan_updated_at,
              p.submitted_at AS plan_submitted_at,
              (SELECT e.name FROM events e WHERE e.referral_code = i.referral_code LIMIT 1) AS referred_by_event,
              (SELECT 1 FROM events e WHERE e.referral_code = i.referral_code LIMIT 1) AS referral_known
       FROM inquiries i
       LEFT JOIN event_plans p ON p.inquiry_id = i.id
       ORDER BY i.created_at DESC`
    )
    .all();
  res.render('admin/inquiries', { page: 'admin', inquiries, baseUrl: getSiteUrl() });
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
    db.prepare(`DELETE FROM event_plans WHERE inquiry_id = ?`).run(id);
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
      `SELECT id, sender_name, message, is_dj, color, created_at
       FROM chat_messages WHERE event_id = ? ORDER BY id ASC`
    )
    .all(id);

  const polls = db.prepare(`SELECT * FROM polls WHERE event_id = ? ORDER BY id ASC`).all(id);
  polls.forEach((poll) => {
    const counts = db
      .prepare(`SELECT choice, COUNT(*) AS n FROM poll_votes WHERE poll_id = ? GROUP BY choice`)
      .all(poll.id);
    poll.votesA = counts.find((c) => c.choice === 'a')?.n || 0;
    poll.votesB = counts.find((c) => c.choice === 'b')?.n || 0;
  });

  const guestbookEntries = db
    .prepare(`SELECT * FROM guestbook_entries WHERE event_id = ? ORDER BY id ASC`)
    .all(id);

  res.render('admin/event-detail', {
    page: 'admin',
    event,
    stats,
    setlist: getPlayedSetlist(id, 'ASC'),
    neverPlayed: getPendingBoard(id),
    chatLog,
    polls,
    guestbookEntries,
    currentEventId: Number(getSetting('current_event_id') || '1'),
  });
});

router.post('/events/:id/share', (req, res) => {
  const id = Number(req.params.id);
  if (id && getEventById(id)) {
    // Unguessable token: the recap is reachable only by people given the link.
    const token = crypto.randomBytes(12).toString('base64url');
    db.prepare(`UPDATE events SET share_token = ? WHERE id = ?`).run(token, id);
    ensureEventReferralCode(id);
  }
  res.redirect(`/admin/events/${id}`);
});

router.post('/events/:id/unshare', (req, res) => {
  const id = Number(req.params.id);
  if (id) db.prepare(`UPDATE events SET share_token = NULL WHERE id = ?`).run(id);
  res.redirect(`/admin/events/${id}`);
});

router.post('/events/:id/delete', (req, res) => {
  const id = Number(req.params.id);
  const currentEventId = Number(getSetting('current_event_id') || '1');

  if (id && id !== currentEventId) {
    const deleteRequests = db.prepare(`DELETE FROM song_requests WHERE event_id = ?`);
    const deleteUpvotes = db.prepare(`DELETE FROM request_upvotes WHERE event_id = ?`);
    const deleteDrops = db.prepare(`DELETE FROM drops WHERE event_id = ?`);
    const deleteChat = db.prepare(`DELETE FROM chat_messages WHERE event_id = ?`);
    const deleteReactions = db.prepare(`DELETE FROM reactions WHERE event_id = ?`);
    const deletePollVotes = db.prepare(`DELETE FROM poll_votes WHERE poll_id IN (SELECT id FROM polls WHERE event_id = ?)`);
    const deletePolls = db.prepare(`DELETE FROM polls WHERE event_id = ?`);
    const deleteGuestbook = db.prepare(`DELETE FROM guestbook_entries WHERE event_id = ?`);
    const deleteBattleVotes = db.prepare(`DELETE FROM battle_votes WHERE battle_id IN (SELECT id FROM battles WHERE event_id = ?)`);
    const deleteBattles = db.prepare(`DELETE FROM battles WHERE event_id = ?`);
    const deleteWall = db.prepare(`DELETE FROM wall_photos WHERE event_id = ?`);
    const wallFiles = db.prepare(`SELECT filename FROM wall_photos WHERE event_id = ?`).all(id);
    const deleteEvent = db.prepare(`DELETE FROM events WHERE id = ?`);
    db.transaction(() => {
      deleteRequests.run(id);
      deleteUpvotes.run(id);
      deleteDrops.run(id);
      deleteChat.run(id);
      deleteReactions.run(id);
      deletePollVotes.run(id);
      deletePolls.run(id);
      deleteGuestbook.run(id);
      deleteBattleVotes.run(id);
      deleteBattles.run(id);
      deleteWall.run(id);
      deleteEvent.run(id);
    })();
    wallFiles.forEach((f) => deleteWallFile(f.filename));
  }

  res.redirect('/admin/events');
});

// --- Song battles -------------------------------------------------------------------

router.get('/battles/state', (req, res) => {
  const eventId = Number(getSetting('current_event_id') || '1');
  res.json(getBattleState(eventId));
});

router.post('/battles', (req, res) => {
  const isLive = getSetting('is_live') === '1';
  if (!isLive || !getFeatureFlags().battles) return res.redirect('/admin');

  const songA = clean(req.body.song_a, 120);
  const artistA = clean(req.body.artist_a, 120);
  const songB = clean(req.body.song_b, 120);
  const artistB = clean(req.body.artist_b, 120);
  const minutes = Number(req.body.minutes);

  if (songA && songB) {
    const eventId = Number(getSetting('current_event_id') || '1');
    // One battle at a time — starting a new one settles the last.
    const open = db.prepare(`SELECT id FROM battles WHERE event_id = ? AND closed_at IS NULL`).all(eventId);
    open.forEach((b) => closeBattle(b.id));

    const endsAt = minutes > 0 && minutes <= 30 ? Date.now() + Math.round(minutes * 60 * 1000) : null;
    db.prepare(
      `INSERT INTO battles (event_id, song_a, artist_a, song_b, artist_b, ends_at) VALUES (?, ?, ?, ?, ?, ?)`
    ).run(eventId, songA, artistA || null, songB, artistB || null, endsAt);
  }
  res.redirect('/admin');
});

router.post('/battles/:id/close', (req, res) => {
  const id = Number(req.params.id);
  if (id) closeBattle(id);
  res.redirect('/admin');
});

// --- Live photo wall (paid add-on, DJ approves every photo) ---------------------

function wallPhotoJson(row) {
  return {
    id: row.id,
    name: row.uploader_name || '',
    caption: row.caption || '',
    url: `/admin/wall/photo/${row.filename}`,
    createdAt: row.created_at,
  };
}

router.get('/wall/state', (req, res) => {
  const eventId = Number(getSetting('current_event_id') || '1');
  const event = getEventById(eventId);
  const pending = db
    .prepare(`SELECT * FROM wall_photos WHERE event_id = ? AND status = 'pending' ORDER BY id ASC`)
    .all(eventId);
  const approved = db
    .prepare(`SELECT * FROM wall_photos WHERE event_id = ? AND status = 'approved' ORDER BY id DESC LIMIT 60`)
    .all(eventId);
  res.json({
    unlocked: !!(event && Number(event.photowall_unlocked) > 0),
    mode: event ? cleanWallMode(event.photowall_unlocked) : 0,
    pending: pending.map(wallPhotoJson),
    approved: approved.map(wallPhotoJson),
  });
});

// The DJ always sees a photo (pending or approved) through this route;
// guests can only ever reach approved ones.
router.get('/wall/photo/:file', (req, res) => {
  const file = String(req.params.file || '');
  if (!WALL_FILE_RE.test(file)) return res.status(404).end();
  const row = db.prepare(`SELECT 1 FROM wall_photos WHERE filename = ?`).get(file);
  if (!row) return res.status(404).end();
  res.set('Cache-Control', 'private, max-age=3600');
  res.type('image/jpeg').sendFile(path.join(WALL_DIR, file));
});

router.post('/wall/mode', (req, res) => {
  const eventId = Number(getSetting('current_event_id') || '1');
  db.prepare(`UPDATE events SET photowall_unlocked = ? WHERE id = ?`).run(cleanWallMode(req.body.mode), eventId);
  res.redirect('/admin');
});

// Older shortcut: 1 = free for everyone, 0 = off.
router.post('/wall/unlock', (req, res) => {
  const eventId = Number(getSetting('current_event_id') || '1');
  db.prepare(`UPDATE events SET photowall_unlocked = ? WHERE id = ?`).run(req.body.unlock === '1' ? 1 : 0, eventId);
  res.redirect('/admin');
});

// "My client already paid" — attach this live event to their booking; if that
// booking's Photo Wall is paid the wall unlocks right away.
router.post('/wall/link', (req, res) => {
  const eventId = Number(getSetting('current_event_id') || '1');
  const booking = db
    .prepare(`SELECT id, photowall_paid_at FROM inquiries WHERE id = ?`)
    .get(Number(req.body.inquiry_id));
  if (booking) {
    db.prepare(`UPDATE events SET inquiry_id = ? WHERE id = ?`).run(booking.id, eventId);
    if (booking.photowall_paid_at) {
      db.prepare(`UPDATE events SET photowall_unlocked = 1 WHERE id = ?`).run(eventId);
    }
  }
  res.redirect('/admin');
});

router.post('/wall/:id/approve', (req, res) => {
  const id = Number(req.params.id);
  const eventId = Number(getSetting('current_event_id') || '1');
  const result = db
    .prepare(
      `UPDATE wall_photos SET status = 'approved', approved_at = datetime('now')
       WHERE id = ? AND event_id = ? AND status = 'pending'`
    )
    .run(id, eventId);
  res.json({ ok: result.changes > 0 });
});

// Used both to turn a pending photo down and to take an approved one off
// the wall — either way the picture is deleted from the disk. With
// `block: true` ("Reject & block") the sender's phone is also barred from
// uploading, their Photo Pass (if any) is turned off, and anything else of
// theirs still waiting for review is deleted too.
router.post('/wall/:id/remove', (req, res) => {
  const id = Number(req.params.id);
  const row = id && db.prepare(`SELECT * FROM wall_photos WHERE id = ?`).get(id);
  if (!row) return res.json({ ok: false });

  const filesToDelete = [row.filename];
  db.transaction(() => {
    if (req.body && req.body.block === true) {
      db.prepare(`INSERT OR IGNORE INTO wall_blocks (client_id, pass_id) VALUES (?, ?)`).run(row.client_id, row.pass_id || null);
      if (row.pass_id) db.prepare(`UPDATE photo_passes SET status = 'revoked' WHERE id = ? AND status = 'active'`).run(row.pass_id);
      const others = db
        .prepare(
          `SELECT id, filename FROM wall_photos
           WHERE status = 'pending' AND id != ? AND (client_id = ? OR (? IS NOT NULL AND pass_id = ?))`
        )
        .all(id, row.client_id, row.pass_id || null, row.pass_id || null);
      others.forEach((o) => {
        db.prepare(`DELETE FROM wall_photos WHERE id = ?`).run(o.id);
        filesToDelete.push(o.filename);
      });
    }
    db.prepare(`DELETE FROM wall_photos WHERE id = ?`).run(id);
  })();
  filesToDelete.forEach(deleteWallFile);
  res.json({ ok: true, blocked: !!(req.body && req.body.block === true) });
});

// --- Tips & extras settings ----------------------------------------------------------

router.get('/extras', (req, res) => {
  res.render('admin/extras', {
    page: 'admin',
    values: {
      venmo: getSetting('tip_venmo') || '',
      cashapp: getSetting('tip_cashapp') || '',
      zelle: getSetting('tip_zelle') || '',
      tipMessage: getSetting('tip_message') || '',
      referralOffer: getSetting('referral_offer') || '',
      googleReviewUrl: getSetting('google_review_url') || '',
      photowallPrice: getSetting('photowall_price') || '',
      photopassPrice: getSetting('photopass_price') || '',
    },
    stripeStatus: {
      configured: stripe.isConfigured(),
      mode: stripe.getMode(),
      webhook: stripe.hasWebhookSecret(),
      priceOk: getPhotoWallPriceCents() > 0 || getPassPriceCents() > 0,
      siteUrl: getSiteUrl(),
      testResult: String(req.query.stripetest || ''),
    },
    saved: req.query.saved === '1',
    error: req.query.error || '',
    features: getFeatureFlags(),
  });
});

router.post('/extras', (req, res) => {
  const venmo = clean(req.body.venmo, 60).replace(/^@+/, '');
  const cashapp = clean(req.body.cashapp, 60).replace(/^\$+/, '');
  const zelle = clean(req.body.zelle, 80);
  const tipMessage = clean(req.body.tip_message, 140);
  const referralOffer = clean(req.body.referral_offer, 140);
  const googleReviewUrl = clean(req.body.google_review_url, 300);
  const photowallPrice = clean(req.body.photowall_price, 12).replace(/^\$/, '');
  const photopassPrice = clean(req.body.photopass_price, 12).replace(/^\$/, '');

  const fail = (msg) => res.redirect(`/admin/extras?error=${encodeURIComponent(msg)}`);
  if (venmo && !VENMO_RE.test(venmo)) return fail('Venmo username can only use letters, numbers, dots, dashes and underscores.');
  if (cashapp && !CASHAPP_RE.test(cashapp)) return fail('Cash App $cashtag can only use letters, numbers and underscores.');
  const zelleOk = /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(zelle) || /^[+()\d\s.-]{7,25}$/.test(zelle);
  if (zelle && !zelleOk) {
    return fail('Zelle should be the email or phone number linked to your Zelle account.');
  }
  if (photowallPrice && !(/^\d{1,4}(\.\d{1,2})?$/.test(photowallPrice) && Number(photowallPrice) >= 1 && Number(photowallPrice) <= 2000)) {
    return fail('The Photo Wall price should be a dollar amount between 1 and 2000, like 75 or 99.50.');
  }
  if (photopassPrice && !(/^\d{1,3}(\.\d{1,2})?$/.test(photopassPrice) && Number(photopassPrice) >= 1 && Number(photopassPrice) <= 100)) {
    return fail('The Photo Pass price should be a dollar amount between 1 and 100, like 5 or 7.50.');
  }
  if (googleReviewUrl && !/^https:\/\/[^\s<>"']+$/.test(googleReviewUrl)) {
    return fail('The Google review link must start with https:// and have no spaces.');
  }

  setSetting('tip_venmo', venmo);
  setSetting('tip_cashapp', cashapp);
  setSetting('tip_zelle', zelle);
  setSetting('tip_message', tipMessage);
  setSetting('referral_offer', referralOffer);
  setSetting('google_review_url', googleReviewUrl);
  setSetting('photowall_price', photowallPrice);
  setSetting('photopass_price', photopassPrice);
  res.redirect('/admin/extras?saved=1');
});

// Quick "is Stripe really connected?" check for the DJ.
router.post('/stripe/test', async (req, res) => {
  let result;
  if (!stripe.isConfigured()) {
    result = 'missing';
  } else {
    try {
      await stripe.checkConnection();
      result = 'ok';
    } catch (err) {
      result = 'fail';
    }
  }
  res.redirect(`/admin/extras?stripetest=${result}#payments`);
});

// --- Client planning pages ---------------------------------------------------------------

function getPlanForInquiry(inquiryId) {
  return db
    .prepare(
      `SELECT p.*, i.name AS client_name, i.email AS client_email, i.event_type, i.event_date, i.location
       FROM event_plans p JOIN inquiries i ON i.id = p.inquiry_id
       WHERE p.inquiry_id = ?`
    )
    .get(inquiryId);
}

function parseTimeline(raw) {
  try {
    const rows = JSON.parse(raw || '[]');
    return Array.isArray(rows) ? rows : [];
  } catch (err) {
    return [];
  }
}

// For money that arrives outside Stripe (Cash App / Venmo / Zelle / cash): the
// DJ taps this once they see the payment, and the add-on counts as paid.
router.post('/inquiries/:id/photowall-paid', (req, res) => {
  const id = Number(req.params.id);
  if (id && db.prepare(`SELECT 1 FROM inquiries WHERE id = ?`).get(id)) {
    if (req.body.paid === '1') {
      recordPhotoWallPayment(id, { amountCents: getPhotoWallPriceCents() || null, ref: null, method: 'manual' });
    } else {
      db.prepare(
        `UPDATE inquiries SET photowall_paid_at = NULL, photowall_amount_cents = NULL,
                photowall_pay_ref = NULL, photowall_pay_method = NULL
         WHERE id = ? AND photowall_pay_method = 'manual'`
      ).run(id);
    }
  }
  res.redirect(`/admin/inquiries#inq-${id}`);
});

router.post('/inquiries/:id/plan', (req, res) => {
  const id = Number(req.params.id);
  const inquiry = id && db.prepare(`SELECT id FROM inquiries WHERE id = ?`).get(id);
  if (inquiry && !db.prepare(`SELECT 1 FROM event_plans WHERE inquiry_id = ?`).get(id)) {
    db.prepare(`INSERT INTO event_plans (inquiry_id, token) VALUES (?, ?)`).run(
      id,
      crypto.randomBytes(16).toString('base64url')
    );
  }
  res.redirect(`/admin/inquiries#inq-${id}`);
});

router.post('/inquiries/:id/plan/delete', (req, res) => {
  const id = Number(req.params.id);
  if (id) db.prepare(`DELETE FROM event_plans WHERE inquiry_id = ?`).run(id);
  res.redirect(`/admin/inquiries#inq-${id}`);
});

router.get('/plans/:inquiryId', (req, res) => {
  const plan = getPlanForInquiry(Number(req.params.inquiryId));
  if (!plan) return res.status(404).render('404');
  res.render('admin/plan-view', { page: 'admin', plan, timeline: parseTimeline(plan.timeline) });
});

router.get('/plans/:inquiryId/download', (req, res) => {
  const plan = getPlanForInquiry(Number(req.params.inquiryId));
  if (!plan) return res.status(404).render('404');
  const timeline = parseTimeline(plan.timeline);
  const out = [
    `EVENT PLAN — ${plan.client_name}`,
    [plan.event_type, plan.event_date, plan.location].filter(Boolean).join(' · '),
    '',
    'MUST-PLAY',
    plan.must_play || '(none yet)',
    '',
    'DO-NOT-PLAY',
    plan.do_not_play || '(none yet)',
    '',
    'TIMELINE',
    ...(timeline.length ? timeline.map((r) => `${r.time || '—'}  ${r.label || ''}`) : ['(none yet)']),
    '',
    'ANNOUNCEMENTS & NAME PRONUNCIATIONS',
    plan.announcements || '(none yet)',
    '',
    'OTHER NOTES',
    plan.notes || '(none yet)',
    '',
  ].join('\n');
  const safeName = plan.client_name.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'client';
  res.set('Content-Type', 'text/plain; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="event-plan-${safeName}.txt"`);
  res.send(out);
});

// --- Photo Passes -----------------------------------------------------------------------

router.get('/passes', (req, res) => {
  const passes = db
    .prepare(
      `SELECT p.*,
              (SELECT COUNT(*) FROM wall_photos w WHERE w.pass_id = p.id) AS photo_count
       FROM photo_passes p
       WHERE p.status != 'pending' OR p.created_at >= datetime('now', '-1 day')
       ORDER BY p.created_at DESC`
    )
    .all();
  const totals = db
    .prepare(
      `SELECT COUNT(*) AS active, COALESCE(SUM(CASE WHEN source = 'stripe' THEN amount_cents END), 0) AS cents
       FROM photo_passes WHERE status = 'active'`
    )
    .get();
  const blocks = db
    .prepare(
      `SELECT b.id, b.client_id, b.created_at, p.code, p.name
       FROM wall_blocks b LEFT JOIN photo_passes p ON p.id = b.pass_id
       ORDER BY b.created_at DESC`
    )
    .all();
  res.render('admin/passes', {
    page: 'admin',
    passes,
    blocks,
    totals,
    created: String(req.query.created || ''),
    price: getPassPriceCents() ? formatMoney(getPassPriceCents()) : '',
    passReady: stripe.isConfigured() && getPassPriceCents() > 0,
  });
});

// Give someone a free pass (a friend, the host, a guest who paid you in cash).
router.post('/passes', (req, res) => {
  const name = clean(req.body.name, 80);
  const email = clean(req.body.email, 200);
  const pass = createPassRow({ source: 'comp', status: 'active', name, email });
  res.redirect(`/admin/passes?created=${encodeURIComponent(pass.code)}`);
});

router.post('/passes/:id/revoke', (req, res) => {
  db.prepare(`UPDATE photo_passes SET status = 'revoked' WHERE id = ? AND status = 'active'`).run(Number(req.params.id));
  res.redirect('/admin/passes');
});

router.post('/passes/blocks/:id/unblock', (req, res) => {
  db.prepare(`DELETE FROM wall_blocks WHERE id = ?`).run(Number(req.params.id));
  res.redirect('/admin/passes');
});

router.post('/passes/:id/restore', (req, res) => {
  db.prepare(`UPDATE photo_passes SET status = 'active' WHERE id = ? AND status = 'revoked'`).run(Number(req.params.id));
  res.redirect('/admin/passes');
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
    name: 'Stripe',
    purpose: 'Takes the small online payments for Photo Passes (and the optional host-pays Photo Wall) and unlocks them automatically.',
    cost: 'No monthly fee — 2.9% + 30¢ per card payment',
    url: 'https://dashboard.stripe.com',
    status: 'Optional — set up on the Tips & Extras page',
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

// --- Testimonials ------------------------------------------------------------

router.get('/testimonials', (req, res) => {
  const testimonials = db
    .prepare(`SELECT * FROM testimonials ORDER BY (source = 'guest' AND published = 0) DESC, created_at DESC`)
    .all();
  res.render('admin/testimonials', { page: 'admin', testimonials });
});

router.post('/testimonials', (req, res) => {
  const clientName = clean(req.body.client_name, 120);
  const quote = clean(req.body.quote, 1000);
  const eventType = clean(req.body.event_type, 60);
  const rating = Math.min(5, Math.max(1, Number(req.body.rating) || 5));

  if (clientName && quote) {
    db.prepare(
      `INSERT INTO testimonials (client_name, quote, event_type, rating) VALUES (?, ?, ?, ?)`
    ).run(clientName, quote, eventType || null, rating);
  }

  res.redirect('/admin/testimonials');
});

router.post('/testimonials/:id/toggle', (req, res) => {
  const id = Number(req.params.id);
  if (id) {
    const t = db.prepare(`SELECT published FROM testimonials WHERE id = ?`).get(id);
    if (t) db.prepare(`UPDATE testimonials SET published = ? WHERE id = ?`).run(t.published ? 0 : 1, id);
  }
  res.redirect('/admin/testimonials');
});

router.post('/testimonials/:id/delete', (req, res) => {
  const id = Number(req.params.id);
  if (id) db.prepare(`DELETE FROM testimonials WHERE id = ?`).run(id);
  res.redirect('/admin/testimonials');
});

// --- Photo/video gallery -------------------------------------------------------

router.get('/gallery', (req, res) => {
  const items = db.prepare(`SELECT * FROM gallery_items ORDER BY created_at DESC`).all();
  res.render('admin/gallery', { page: 'admin', items });
});

router.post('/gallery', galleryUpload.single('media'), (req, res) => {
  if (!req.file) {
    return res.redirect('/admin/gallery');
  }
  const type = req.file.mimetype.startsWith('video/') ? 'video' : 'photo';
  const caption = clean(req.body.caption, 200);
  db.prepare(`INSERT INTO gallery_items (type, filename, caption) VALUES (?, ?, ?)`).run(
    type,
    req.file.filename,
    caption || null
  );
  res.redirect('/admin/gallery');
});

router.post('/gallery/:id/delete', (req, res) => {
  const id = Number(req.params.id);
  const item = id && db.prepare(`SELECT * FROM gallery_items WHERE id = ?`).get(id);
  if (item) {
    db.prepare(`DELETE FROM gallery_items WHERE id = ?`).run(id);
    const filePath = path.join(GALLERY_DIR, item.filename);
    fs.unlink(filePath, () => {});
  }
  res.redirect('/admin/gallery');
});

// --- Lifetime analytics --------------------------------------------------------

router.get('/analytics', (req, res) => {
  const totalEvents = db.prepare(`SELECT COUNT(*) AS c FROM events`).get().c;

  const totalSongsPlayed = db
    .prepare(
      `SELECT COUNT(*) AS c FROM (
         SELECT DISTINCT event_id, normalized_key, played_at
         FROM song_requests WHERE status = 'played'
       )`
    )
    .get().c;

  const totalRequests = db.prepare(`SELECT COUNT(*) AS c FROM song_requests`).get().c;
  const uniqueSongs = db.prepare(`SELECT COUNT(DISTINCT normalized_key) AS c FROM song_requests`).get().c;

  const inquiryStats = db
    .prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN status = 'booked' THEN 1 ELSE 0 END) AS booked
       FROM inquiries`
    )
    .get();

  const totalGuestbook = db.prepare(`SELECT COUNT(*) AS c FROM guestbook_entries`).get().c;
  const totalChatMessages = db.prepare(`SELECT COUNT(*) AS c FROM chat_messages`).get().c;

  const reactionTotals = db
    .prepare(`SELECT emoji, COUNT(*) AS n FROM reactions GROUP BY emoji ORDER BY n DESC`)
    .all();

  const topSongs = db
    .prepare(
      `SELECT song_title, artist, COUNT(*) AS total
       FROM song_requests
       GROUP BY normalized_key
       ORDER BY total DESC
       LIMIT 10`
    )
    .all();

  res.render('admin/analytics', {
    page: 'admin',
    totalEvents,
    totalSongsPlayed,
    totalRequests,
    uniqueSongs,
    inquiryStats,
    totalGuestbook,
    totalChatMessages,
    reactionTotals,
    topSongs,
  });
});

// --- CSV exports ---------------------------------------------------------------

router.get('/export/requests.csv', (req, res) => {
  const rows = db
    .prepare(
      `SELECT sr.song_title, sr.artist, sr.requested_by, sr.dedication, sr.status,
              sr.created_at, sr.played_at, e.name AS event_name
       FROM song_requests sr
       LEFT JOIN events e ON e.id = sr.event_id
       ORDER BY sr.created_at DESC`
    )
    .all();

  const csv = toCsv(rows, [
    { key: 'event_name', label: 'Event' },
    { key: 'song_title', label: 'Song' },
    { key: 'artist', label: 'Artist' },
    { key: 'requested_by', label: 'Requested By' },
    { key: 'dedication', label: 'Dedication' },
    { key: 'status', label: 'Status' },
    { key: 'created_at', label: 'Requested At' },
    { key: 'played_at', label: 'Played At' },
  ]);

  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', 'attachment; filename="djxpress-song-requests.csv"');
  res.send(csv);
});

router.get('/export/inquiries.csv', (req, res) => {
  const rows = db.prepare(`SELECT * FROM inquiries ORDER BY created_at DESC`).all();

  const csv = toCsv(rows, [
    { key: 'created_at', label: 'Received' },
    { key: 'name', label: 'Name' },
    { key: 'email', label: 'Email' },
    { key: 'phone', label: 'Phone' },
    { key: 'event_date', label: 'Event Date' },
    { key: 'event_type', label: 'Event Type' },
    { key: 'location', label: 'Location' },
    { key: 'guest_count', label: 'Guest Count' },
    { key: 'message', label: 'Message' },
    { key: 'referral_code', label: 'Referral Code' },
    { key: 'status', label: 'Status' },
  ]);

  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', 'attachment; filename="djxpress-inquiries.csv"');
  res.send(csv);
});

router.get('/export/guestbook.csv', (req, res) => {
  const rows = db
    .prepare(
      `SELECT g.name, g.message, g.created_at, e.name AS event_name
       FROM guestbook_entries g
       LEFT JOIN events e ON e.id = g.event_id
       ORDER BY g.created_at DESC`
    )
    .all();

  const csv = toCsv(rows, [
    { key: 'event_name', label: 'Event' },
    { key: 'name', label: 'Name' },
    { key: 'message', label: 'Message' },
    { key: 'created_at', label: 'Left At' },
  ]);

  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', 'attachment; filename="djxpress-guestbook.csv"');
  res.send(csv);
});

module.exports = router;
