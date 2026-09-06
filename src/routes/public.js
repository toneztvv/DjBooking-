const express = require('express');
const { db, getSetting } = require('../db');
const { getLiveUrl } = require('../qr');

const router = express.Router();

router.get('/', (req, res) => {
  res.render('index', { page: 'home' });
});

router.get('/book', (req, res) => {
  res.render('book', {
    page: 'book',
    submitted: req.query.submitted === '1',
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

module.exports = router;
