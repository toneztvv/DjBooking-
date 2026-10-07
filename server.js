require('dotenv').config();

const path = require('path');
const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');

const { initDb } = require('./src/db');
const { getSiteUrl } = require('./src/qr');

initDb();

const publicRoutes = require('./src/routes/public');
const apiRoutes = require('./src/routes/api');
const adminRoutes = require('./src/routes/admin');

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
  })
);
app.use(compression());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/gallery-media', express.static(path.join(__dirname, 'data', 'gallery')));

const formLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/inquiries', formLimiter);
app.use('/api/requests', formLimiter);

// Chat is polled via GET every few seconds, so only rate-limit the POSTs
// (sending a message) — otherwise normal polling would trip the limiter.
const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
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

app.use('/api/guestbook', (req, res, next) => (req.method === 'POST' ? formLimiter(req, res, next) : next()));
app.use('/api/requests/upvote', formLimiter);

// Photo uploads, reviews, battle votes and planning-page saves are all
// POST-only actions from real people; these just stop a script flooding them.
// Everyone at a venue shares one wifi IP, so battle votes and photo uploads
// get roomy limits — they're just a flood guard, not a per-guest cap.
const uploadLimiter = rateLimit({ windowMs: 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false });
const battleLimiter = rateLimit({ windowMs: 60 * 1000, max: 400, standardHeaders: true, legacyHeaders: false });
const postOnly = (limiter) => (req, res, next) => (req.method === 'POST' ? limiter(req, res, next) : next());
app.use('/api/wall', postOnly(uploadLimiter));
app.use('/api/reviews', postOnly(formLimiter));
app.use('/api/battles', postOnly(battleLimiter));
app.use('/plan', postOnly(formLimiter));

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

app.listen(PORT, () => {
  console.log(`DJXpress site running on http://localhost:${PORT}`);
});
