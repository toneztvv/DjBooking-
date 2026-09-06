require('dotenv').config();

const path = require('path');
const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');

const { initDb } = require('./src/db');

initDb();

const publicRoutes = require('./src/routes/public');
const apiRoutes = require('./src/routes/api');
const adminRoutes = require('./src/routes/admin');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(
  helmet({
    contentSecurityPolicy: false,
  })
);
app.use(compression());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use((req, res, next) => {
  res.locals.siteName = 'DJXpress';
  res.locals.currentYear = new Date().getFullYear();
  next();
});

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
