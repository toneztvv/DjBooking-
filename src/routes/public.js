const express = require('express');
const { db, getSetting } = require('../db');
const { getLiveUrl } = require('../qr');

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

router.get('/screen', (req, res) => {
  res.render('screen', { page: 'screen' });
});

module.exports = router;
