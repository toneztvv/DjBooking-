require('dotenv').config();

const path = require('path');
const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');

const { initDb } = require('./src/db');
const { getSiteUrl } = require('./src/qr');
const stripe = require('./src/stripe');
const { applyPaidSession, refundDuplicate, revokeByPaymentIntent } = require('./src/payments');

initDb();

const publicRoutes = require('./src/routes/public');
const apiRoutes = require('./src/routes/api');
const adminRoutes = require('./src/routes/admin');

// A bug in one request must never take the whole site down mid-event.
process.on('unhandledRejection', (err) => console.error('Unhandled rejection:', err && err.stack ? err.stack : err));
process.on('uncaughtException', (err) => console.error('Uncaught exception:', err && err.stack ? err.stack : err));

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Set before the body parsers so these are always available to the 500 page
// even if parsing itself throws (e.g. malformed JSON) before reaching them.
app.use((req, res, next) => {
  res.locals.siteName = 'DJXpress';
  res.locals.currentYear = new Date().getFullYear();
  res.locals.siteUrl = getSiteUrl();
  next();
});

app.use(
  helmet({
    contentSecurityPolicy: false,
    // Same-origin: this site's own pages tell it where a form came from (needed
    // by the admin forged-request guard); other sites learn nothing.
    referrerPolicy: { policy: 'same-origin' },
  })
);
app.use(compression());
// Stripe's payment notifications must be read as the untouched raw body (the
// signature is computed over it), so this sits before the JSON parser.
app.post('/api/stripe/webhook', express.raw({ type: 'application/json', limit: '1mb' }), async (req, res) => {
  try {
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) return res.status(503).json({ ok: false, error: 'Webhook secret not set.' });

    const event = stripe.verifyWebhook(req.body, req.headers['stripe-signature'], secret);
    if (!event) return res.status(400).json({ ok: false, error: 'Bad signature.' });

    const obj = event.data && event.data.object;
    if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
      const result = applyPaidSession(obj);
      await refundDuplicate(result.duplicateIntent); // a second payment for the same thing goes straight back
    } else if (event.type === 'charge.refunded' && obj && obj.refunded === true) {
      revokeByPaymentIntent(obj.payment_intent); // fully refunded: switch off what it paid for
    } else if (event.type === 'charge.dispute.created' && obj) {
      revokeByPaymentIntent(obj.payment_intent); // chargeback opened: switch it off
    }
    res.json({ received: true });
  } catch (err) {
    console.error('Stripe webhook handling failed:', err.message);
    res.status(500).json({ ok: false });
  }
});

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
// Short caching keeps repeat visits fast (important on party wifi) while a new
// deploy still reaches everyone within minutes.
app.use(
  express.static(path.join(__dirname, 'public'), {
    maxAge: '5m',
    setHeaders: (res, filePath) => {
      if (/\.(png|jpe?g|svg|ico|webp|woff2?)$/i.test(filePath)) res.setHeader('Cache-Control', 'public, max-age=86400');
    },
  })
);
app.use('/gallery-media', express.static(path.join(__dirname, 'data', 'gallery')));

const formLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
});
// Everyone at a venue shares one wifi address, so live-night actions (requests,
// chat, guestbook, boosts) get roomy limits — they're a flood guard, not a
// per-guest cap. The booking form stays strict.
const partyLimiter = rateLimit({ windowMs: 60 * 1000, max: 300, standardHeaders: true, legacyHeaders: false });
app.use('/api/inquiries', formLimiter);
app.use('/api/requests', partyLimiter);

// Chat is polled via GET every few seconds, so only rate-limit the POSTs
// (sending a message) — otherwise normal polling would trip the limiter.
const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/chat', (req, res, next) => (req.method === 'POST' ? chatLimiter(req, res, next) : next()));

// Reactions are tapped rapidly on purpose (that's the fun of it), so this
// is generous compared to the other limiters — it's just there to stop a
// script from flooding the table, not to slow down a real person tapping.
const reactionLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 90,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/reactions', (req, res, next) => (req.method === 'POST' ? reactionLimiter(req, res, next) : next()));

app.use('/api/guestbook', (req, res, next) => (req.method === 'POST' ? partyLimiter(req, res, next) : next()));

// Photo uploads, reviews, battle votes and planning-page saves are all
// POST-only actions from real people; these just stop a script flooding them.
// Everyone at a venue shares one wifi IP, so battle votes and photo uploads
// get roomy limits — they're just a flood guard, not a per-guest cap.
const uploadLimiter = rateLimit({ windowMs: 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false });
const battleLimiter = rateLimit({ windowMs: 60 * 1000, max: 400, standardHeaders: true, legacyHeaders: false });
const postOnly = (limiter) => (req, res, next) => (req.method === 'POST' ? limiter(req, res, next) : next());
// Guessing Photo Pass codes is slowed right down.
const passCheckLimiter = rateLimit({ windowMs: 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false });
app.use('/api/wall/pass/check', postOnly(passCheckLimiter));
app.use('/api/wall', postOnly(uploadLimiter));
app.use('/api/reviews', postOnly(formLimiter));
app.use('/api/battles', postOnly(battleLimiter));
app.use('/plan', postOnly(formLimiter));

// Private pages are never stored by browsers or shared caches.
app.use(['/admin', '/plan'], (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

// Guessing the admin password: only FAILED attempts count, and after 40 in 15
// minutes that address is locked out for the rest of the window.
const adminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 40,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many failed logins. Try again in 15 minutes.',
});
app.use('/admin', adminLoginLimiter);

app.use('/', publicRoutes);
app.use('/api', apiRoutes);
app.use('/admin', adminRoutes);

app.use((req, res) => {
  res.status(404).render('404');
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render('500');
});

// Every 5 minutes of a live night, note how many guests are on the live page,
// so the night's timeline can show attendance and the peak.
const presence = require('./src/presence');
const { logEvent } = require('./src/eventlog');
const { getSetting } = require('./src/db');
setInterval(() => {
  try {
    if (getSetting('is_live') !== '1') return;
    const eventId = Number(getSetting('current_event_id') || '1');
    const count = presence.getActiveCount(eventId);
    if (count > 0) logEvent('presence', `${count} guest${count === 1 ? '' : 's'} on the live page`, { eventId, detail: { count } });
  } catch (err) {
    console.error('presence sample failed:', err.message);
  }
}, 5 * 60 * 1000).unref();

// Clear out photos that were never reviewed (on start, then hourly).
const { purgeStalePending } = require('./src/wall');
purgeStalePending();
setInterval(purgeStalePending, 60 * 60 * 1000).unref();

if (!process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD === 'changeme123') {
  console.warn('WARNING: ADMIN_PASSWORD is not set (or is the default). Set a strong one before going live.');
}

app.listen(PORT, () => {
  console.log(`DJXpress site running on http://localhost:${PORT}`);
});
