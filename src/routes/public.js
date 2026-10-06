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
       WHERE event_id = ? AND requested_by != 'DJ Pick'
       GROUP BY normalized_key
       ORDER BY total DESC, MIN(created_at) ASC
       LIMIT 5`
    )
    .all(id);

  const totals = db
    .prepare(
      `SELECT COUNT(*) AS requests,
              COUNT(DISTINCT CASE WHEN requested_by != 'DJ Pick' THEN requested_by END) AS requesters
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
  });
});

router.get('/screen', (req, res) => {
  res.render('screen', { page: 'screen' });
});

module.exports = router;
