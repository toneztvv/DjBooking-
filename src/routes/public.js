const express = require('express');
const { db, getSetting } = require('../db');
const { getLiveUrl, getSiteUrl } = require('../qr');
const { cleanReferral, ensureEventReferralCode, getReferralInfo } = require('../referrals');
const stripe = require('../stripe');
const { getPhotoWallPriceCents, formatMoney, applyPaidSession } = require('../payments');

const router = express.Router();

router.get('/', (req, res) => {
  const testimonials = db
    .prepare(`SELECT * FROM testimonials WHERE published = 1 ORDER BY created_at DESC`)
    .all();
  const galleryItems = db
    .prepare(`SELECT * FROM gallery_items ORDER BY created_at DESC`)
    .all();

  const stats = {
    eventsHosted: db.prepare(`SELECT COUNT(DISTINCT event_id) AS c FROM song_requests WHERE status = 'played'`).get().c,
    songsPlayed: db
      .prepare(
        `SELECT COUNT(*) AS c FROM (
           SELECT DISTINCT event_id, normalized_key, played_at
           FROM song_requests WHERE status = 'played'
         )`
      )
      .get().c,
    songsRequested: db.prepare(`SELECT COUNT(*) AS c FROM song_requests`).get().c,
  };

  res.render('index', { page: 'home', testimonials, galleryItems, stats });
});

router.get('/book', (req, res) => {
  // A friend's recap link arrives here as /book?ref=DJX-XXXXX.
  const referralCode = cleanReferral(String(req.query.ref || ''));
  res.render('book', {
    page: 'book',
    submitted: req.query.submitted === '1',
    referral: getReferralInfo(referralCode),
    values: { name: '', email: '', phone: '', eventDate: '', eventType: '', location: '', guestCount: '', message: '', referralCode },
  });
});

router.get('/live', (req, res) => {
  const isLive = getSetting('is_live') === '1';
  const eventId = Number(getSetting('current_event_id') || '1');
  const currentEvent = db.prepare('SELECT name FROM events WHERE id = ?').get(eventId);
  const eventName = (currentEvent && currentEvent.name) || '';
  res.render('live', {
    page: 'live',
    isLive,
    eventName,
    liveUrl: getLiveUrl(),
  });
});

// Unlisted shareable recap. Only reachable with the event's random token, and
// deliberately excludes chat — it shows the night's music and highlights.
router.get('/recap/:token', (req, res) => {
  const token = String(req.params.token || '').slice(0, 64);
  const event = token && db.prepare(`SELECT * FROM events WHERE share_token = ?`).get(token);
  if (!event) return res.status(404).render('404');

  const id = event.id;

  const setlist = db
    .prepare(
      `SELECT song_title, artist, played_at, MAX(artwork_url) AS artwork_url
       FROM song_requests
       WHERE event_id = ? AND status = 'played'
       GROUP BY normalized_key, played_at
       ORDER BY played_at ASC`
    )
    .all(id);

  const topSongs = db
    .prepare(
      `SELECT song_title, artist, COUNT(*) AS total, MAX(artwork_url) AS artwork_url
       FROM song_requests
       WHERE event_id = ? AND requested_by NOT IN ('DJ Pick', 'Song Battle')
       GROUP BY normalized_key
       ORDER BY total DESC, MIN(created_at) ASC
       LIMIT 5`
    )
    .all(id);

  const totals = db
    .prepare(
      `SELECT COUNT(*) AS requests,
              COUNT(DISTINCT CASE WHEN requested_by NOT IN ('DJ Pick', 'Song Battle') THEN requested_by END) AS requesters
       FROM song_requests WHERE event_id = ?`
    )
    .get(id);

  const reactions = db
    .prepare(`SELECT emoji, COUNT(*) AS n FROM reactions WHERE event_id = ? GROUP BY emoji ORDER BY n DESC`)
    .all(id);

  const polls = db.prepare(`SELECT * FROM polls WHERE event_id = ? ORDER BY id ASC`).all(id);
  polls.forEach((poll) => {
    const counts = db
      .prepare(`SELECT choice, COUNT(*) AS n FROM poll_votes WHERE poll_id = ? GROUP BY choice`)
      .all(poll.id);
    poll.votesA = counts.find((c) => c.choice === 'a')?.n || 0;
    poll.votesB = counts.find((c) => c.choice === 'b')?.n || 0;
  });

  const notes = db
    .prepare(`SELECT name, message, color FROM guestbook_entries WHERE event_id = ? ORDER BY id ASC LIMIT 12`)
    .all(id);

  const photos = db
    .prepare(
      `SELECT filename, uploader_name FROM wall_photos
       WHERE event_id = ? AND status = 'approved' ORDER BY id ASC LIMIT 24`
    )
    .all(id)
    .map((p) => ({ url: `/api/wall/photo/${p.filename}`, name: p.uploader_name || '' }));

  const referralCode = ensureEventReferralCode(id);
  const referralOffer = getSetting('referral_offer') || '';

  const title = event.name || 'The Night';
  res.render('recap', {
    page: 'recap',
    title: `${title} — Night Recap | DJXpress`,
    ogTitle: `${title} — Night Recap`,
    ogDescription: `${setlist.length} songs, ${totals.requests} requests. Relive the night with DJXpress.`,
    noindex: true,
    event,
    setlist,
    topSongs,
    totals,
    reactions,
    totalReactions: reactions.reduce((sum, r) => sum + r.n, 0),
    polls,
    notes,
    photos,
    referralCode,
    referralOffer,
    referralUrl: referralCode ? `${getSiteUrl()}/book?ref=${referralCode}` : '',
  });
});

// --- Client planning page ---------------------------------------------------------
// A private link the DJ sends a booked client so they can fill in their
// must-play / do-not-play songs and the night's timeline.

const PLAN_LIMITS = { songs: 4000, announcements: 1500, notes: 2000, timelineRows: 25 };

function cleanText(value, max) {
  return typeof value === 'string' ? value.replace(/\r\n/g, '\n').trim().slice(0, max) : '';
}

function getPlanByToken(token) {
  const safe = String(token || '').slice(0, 64);
  if (!safe) return null;
  return db
    .prepare(
      `SELECT p.*, i.name AS client_name, i.email AS client_email, i.event_type, i.event_date, i.location,
              i.photowall_paid_at
       FROM event_plans p JOIN inquiries i ON i.id = p.inquiry_id
       WHERE p.token = ?`
    )
    .get(safe);
}

function parseTimeline(raw) {
  try {
    const rows = JSON.parse(raw || '[]');
    return Array.isArray(rows) ? rows : [];
  } catch (err) {
    return [];
  }
}

router.get('/plan/:token', async (req, res, next) => {
  try {
    let plan = getPlanByToken(req.params.token);
    if (!plan) return res.status(404).render('404');

    // Coming back from Stripe: confirm the payment directly with Stripe so the
    // page shows "paid" right away, even before the notification arrives.
    const sessionId = String(req.query.session_id || '');
    let paymentNote = '';
    if (stripe.isConfigured() && /^cs_(test|live)_[A-Za-z0-9]+$/.test(sessionId) && !plan.photowall_paid_at) {
      try {
        const session = await stripe.retrieveSession(sessionId);
        if (String((session.metadata || {}).inquiry_id) === String(plan.inquiry_id) && applyPaidSession(session)) {
          plan = getPlanByToken(req.params.token);
        } else if (session.payment_status !== 'paid') {
          paymentNote = 'We haven’t received your payment yet — if you paid, give it a minute and refresh.';
        }
      } catch (err) {
        console.error('Could not confirm Stripe session:', err.message);
      }
    }

    const priceCents = getPhotoWallPriceCents();
    res.render('plan', {
      page: 'plan',
      title: 'Plan Your Night | DJXpress',
      noindex: true,
      plan,
      timeline: parseTimeline(plan.timeline),
      payment: {
        paid: !!plan.photowall_paid_at,
        canPay: stripe.isConfigured() && priceCents > 0 && !plan.photowall_paid_at,
        price: priceCents ? formatMoney(priceCents) : '',
        cancelled: req.query.cancelled === '1',
        note: paymentNote,
      },
    });
  } catch (err) {
    next(err);
  }
});

// Starts a Stripe checkout for the Photo Wall add-on. The price comes from the
// server's settings — nothing in the request can change it.
router.post('/plan/:token/checkout', async (req, res) => {
  const plan = getPlanByToken(req.params.token);
  if (!plan) return res.status(404).json({ ok: false, error: 'This planning link is no longer active.' });
  if (plan.photowall_paid_at) return res.json({ ok: false, error: 'The Photo Wall add-on is already paid — thank you!' });

  const priceCents = getPhotoWallPriceCents();
  if (!stripe.isConfigured() || !priceCents) {
    return res.status(503).json({ ok: false, error: 'Online payment isn’t available right now — please ask your DJ.' });
  }

  try {
    const base = getSiteUrl();
    const session = await stripe.createCheckoutSession({
      amountCents: priceCents,
      productName: 'DJXpress Live Photo Wall add-on',
      email: plan.client_email,
      clientReferenceId: plan.inquiry_id,
      metadata: { product: 'photowall', inquiry_id: String(plan.inquiry_id) },
      description: `DJXpress Live Photo Wall add-on (booking #${plan.inquiry_id})`,
      successUrl: `${base}/plan/${encodeURIComponent(plan.token)}?session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${base}/plan/${encodeURIComponent(plan.token)}?cancelled=1`,
    });
    res.json({ ok: true, url: session.url });
  } catch (err) {
    console.error('Stripe checkout failed:', err.message);
    res.status(502).json({ ok: false, error: 'Couldn’t start checkout. Please try again in a moment.' });
  }
});

router.post('/plan/:token', (req, res) => {
  const plan = getPlanByToken(req.params.token);
  if (!plan) return res.status(404).json({ ok: false, error: 'This planning link is no longer active.' });

  const body = req.body || {};
  const timeline = (Array.isArray(body.timeline) ? body.timeline : [])
    .slice(0, PLAN_LIMITS.timelineRows)
    .map((row) => ({ time: cleanText(row && row.time, 20), label: cleanText(row && row.label, 100) }))
    .filter((row) => row.time || row.label);

  db.prepare(
    `UPDATE event_plans
     SET must_play = ?, do_not_play = ?, timeline = ?, announcements = ?, notes = ?,
         updated_at = datetime('now'),
         submitted_at = CASE WHEN ? = 1 THEN datetime('now') ELSE submitted_at END
     WHERE id = ?`
  ).run(
    cleanText(body.must_play, PLAN_LIMITS.songs),
    cleanText(body.do_not_play, PLAN_LIMITS.songs),
    JSON.stringify(timeline),
    cleanText(body.announcements, PLAN_LIMITS.announcements),
    cleanText(body.notes, PLAN_LIMITS.notes),
    body.submit ? 1 : 0,
    plan.id
  );

  res.json({ ok: true, submitted: !!body.submit });
});

router.get('/screen', (req, res) => {
  res.render('screen', { page: 'screen' });
});

module.exports = router;
