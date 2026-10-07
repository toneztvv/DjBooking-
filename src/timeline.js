const { db, getSetting } = require('./db');

// Builds "everything that happened" for one night by reading the normal tables
// (requests, chat, guestbook, reactions, drops, polls, battles) plus the event
// log (the things that leave no other trace). A night can span several event
// rows because "Clear Board" starts a new one mid-gig.

const CATEGORIES = {
  requests: 'Requests',
  chat: 'Chat',
  photos: 'Photos',
  money: 'Money',
  dj: 'DJ actions',
  guests: 'Guests',
};

const LOG_KINDS = {
  feature_toggle: ['dj', '\u{1F39B}️'],
  wall_mode: ['photos', '\u{1F4F8}'],
  energy: ['dj', '\u{1F525}'],
  countdown: ['dj', '⏱️'],
  share: ['dj', '\u{1F517}'],
  request_accepted: ['requests', '\u{1F44D}'],
  chat_deleted: ['chat', '\u{1F5D1}️'],
  photo_uploaded: ['photos', '\u{1F4F7}'],
  photo_approved: ['photos', '✅'],
  photo_rejected: ['photos', '❌'],
  photo_removed: ['photos', '\u{1F5D1}️'],
  photo_blocked: ['photos', '⛔'],
  pass_checkout: ['money', '\u{1F6D2}'],
  pass_bought: ['money', '\u{1F39F}️'],
  pass_comp: ['money', '\u{1F381}'],
  pass_admin: ['money', '\u{1F39F}️'],
  pass_refunded: ['money', '↩️'],
  pass_restored: ['guests', '\u{1F511}'],
  host_paid: ['money', '\u{1F4B3}'],
  payment_reversed: ['money', '⚠️'],
  presence: ['guests', '\u{1F465}'],
  live_note: ['dj', '\u{1F4CC}'],
};

const DROP_LABELS = {
  confetti: ['\u{1F389}', 'Confetti'],
  fireworks: ['\u{1F386}', 'Fireworks'],
  wash: ['✨', 'Color wash'],
};

function placeholders(ids) {
  return ids.map(() => '?').join(',');
}

function getNight(eventId) {
  const ev = db.prepare(`SELECT * FROM events WHERE id = ?`).get(eventId);
  if (!ev) return null;
  const nightId = ev.night_id || ev.id;
  const segments = db
    .prepare(`SELECT * FROM events WHERE COALESCE(night_id, id) = ? ORDER BY started_at ASC, id ASC`)
    .all(nightId);
  return { nightId, segments, ids: segments.map((s) => s.id) };
}

function fmtSong(title, artist) {
  return artist ? `“${title}” by ${artist}` : `“${title}”`;
}

function buildTimeline(eventId) {
  const night = getNight(eventId);
  if (!night) return null;
  const { ids, segments } = night;
  const ph = placeholders(ids);
  const items = [];
  // `rank` only breaks ties inside the same second: "went live" first, "event ended" last.
  const add = (at, cat, icon, text, sub, rank = 0) => {
    if (at) items.push({ at, cat, icon, text, sub: sub || '', rank });
  };

  // --- When the night started / was cleared / ended
  segments.forEach((seg, i) => {
    if (i === 0) add(seg.started_at, 'dj', '▶️', `Went live${seg.name ? ` — ${seg.name}` : ''}`, '', -1);
    else add(seg.started_at, 'dj', '\u{1F9F9}', 'Request board cleared (fresh board started)', '', -1);
  });
  const last = segments[segments.length - 1];
  if (last.ended_at) add(last.ended_at, 'dj', '⏹️', 'Event ended', '', 1);

  // --- Song requests, boosts, plays
  db.prepare(
    `SELECT song_title, artist, requested_by, dedication, created_at FROM song_requests
     WHERE event_id IN (${ph}) AND requested_by NOT IN ('DJ Pick', 'Song Battle')`
  )
    .all(...ids)
    .forEach((r) =>
      add(
        r.created_at,
        'requests',
        '\u{1F3B5}',
        `${r.requested_by} requested ${fmtSong(r.song_title, r.artist)}`,
        r.dedication ? `\u{1F48C} Dedication: ${r.dedication}` : ''
      )
    );

  db.prepare(
    `SELECT u.created_at,
            (SELECT song_title FROM song_requests s WHERE s.event_id = u.event_id AND s.normalized_key = u.normalized_key LIMIT 1) AS title
     FROM request_upvotes u WHERE u.event_id IN (${ph})`
  )
    .all(...ids)
    .forEach((u) => add(u.created_at, 'requests', '\u{1F44D}', `A guest boosted “${u.title || 'a song'}”`));

  db.prepare(
    `SELECT song_title, artist, played_at, GROUP_CONCAT(DISTINCT requested_by) AS who
     FROM song_requests WHERE event_id IN (${ph}) AND status = 'played'
     GROUP BY normalized_key, played_at`
  )
    .all(...ids)
    .forEach((r) => {
      const requesters = String(r.who || '').split(',').filter((w) => w && w !== 'DJ Pick' && w !== 'Song Battle');
      const sub = requesters.length ? `Requested by ${requesters.join(', ')}` : r.who === 'Song Battle' ? 'Won the song battle' : 'DJ pick — nobody requested it';
      add(r.played_at, 'requests', '✅', `Played ${fmtSong(r.song_title, r.artist)}`, sub);
    });

  db.prepare(
    `SELECT song_title, artist, created_at FROM song_requests
     WHERE event_id IN (${ph}) AND requested_by = 'Song Battle'`
  )
    .all(...ids)
    .forEach((r) => add(r.created_at, 'requests', '⚔️', `Song battle queued ${fmtSong(r.song_title, r.artist)} (Accepted)`));

  // --- Chat (kept messages; deleted ones come from the log)
  db.prepare(`SELECT sender_name, message, is_dj, created_at FROM chat_messages WHERE event_id IN (${ph})`)
    .all(...ids)
    .forEach((m) => add(m.created_at, 'chat', m.is_dj ? '\u{1F3A7}' : '\u{1F4AC}', `${m.is_dj ? 'DJ' : m.sender_name}: ${m.message}`));

  // --- Guestbook
  db.prepare(`SELECT name, message, created_at FROM guestbook_entries WHERE event_id IN (${ph})`)
    .all(...ids)
    .forEach((g) => add(g.created_at, 'guests', '\u{1F4D5}', `${g.name} signed the guestbook`, g.message));

  // --- Reactions, bundled into 5-minute chunks so they don't flood the feed
  // (each chunk is stamped with its LAST reaction, so it never appears before
  // the night began).
  const reactionBuckets = db
    .prepare(
      `SELECT strftime('%Y-%m-%d %H:', created_at) || printf('%02d', (CAST(strftime('%M', created_at) AS INTEGER) / 5) * 5) AS bucket,
              emoji, COUNT(*) AS n, MAX(created_at) AS last_at
       FROM reactions WHERE event_id IN (${ph}) GROUP BY bucket, emoji ORDER BY bucket`
    )
    .all(...ids)
    .reduce((acc, r) => {
      const entry = (acc[r.bucket] = acc[r.bucket] || { parts: [], last: '' });
      entry.parts.push(`${r.emoji} \u00D7${r.n}`);
      if (r.last_at > entry.last) entry.last = r.last_at;
      return acc;
    }, {});
  Object.values(reactionBuckets).forEach((e) => add(e.last, 'guests', '\u{1F525}', `Reactions: ${e.parts.join('  ')}`));

  // --- DJ drops / shoutouts / sounds
  db.prepare(`SELECT kind, message, created_at FROM drops WHERE event_id IN (${ph})`)
    .all(...ids)
    .forEach((d) => {
      if (d.kind === 'shoutout') add(d.created_at, 'dj', '\u{1F4E3}', 'Shoutout banner sent', d.message);
      else if (d.kind.startsWith('sound:')) add(d.created_at, 'dj', '\u{1F50A}', `Soundboard: ${d.kind.slice(6)}`);
      else {
        const [icon, label] = DROP_LABELS[d.kind] || ['⚡', d.kind];
        add(d.created_at, 'dj', icon, `Fired ${label}`);
      }
    });

  // --- Polls and battles
  db.prepare(`SELECT * FROM polls WHERE event_id IN (${ph})`)
    .all(...ids)
    .forEach((p) => {
      const votes = db.prepare(`SELECT choice, COUNT(*) AS n FROM poll_votes WHERE poll_id = ? GROUP BY choice`).all(p.id);
      const a = votes.find((v) => v.choice === 'a')?.n || 0;
      const b = votes.find((v) => v.choice === 'b')?.n || 0;
      add(p.created_at, 'dj', '\u{1F4CA}', `Poll started: ${p.question}`, `${p.option_a} vs ${p.option_b}`);
      if (p.closed_at) add(p.closed_at, 'dj', '\u{1F4CA}', `Poll closed: ${p.option_a} ${a} – ${b} ${p.option_b}`);
    });

  db.prepare(`SELECT * FROM battles WHERE event_id IN (${ph})`)
    .all(...ids)
    .forEach((bt) => {
      const votes = db.prepare(`SELECT choice, COUNT(*) AS n FROM battle_votes WHERE battle_id = ? GROUP BY choice`).all(bt.id);
      const a = votes.find((v) => v.choice === 'a')?.n || 0;
      const b = votes.find((v) => v.choice === 'b')?.n || 0;
      add(bt.created_at, 'dj', '⚔️', `Song battle started: ${bt.song_a} vs ${bt.song_b}`);
      if (bt.closed_at) {
        const result =
          bt.winner === 'a' ? `${bt.song_a} won` : bt.winner === 'b' ? `${bt.song_b} won` : bt.winner === 'tie' ? 'a tie — both queued' : 'no votes';
        add(bt.closed_at, 'dj', '\u{1F3C6}', `Song battle result: ${result}`, `${bt.song_a} ${a} – ${b} ${bt.song_b}`);
      }
    });

  // --- The diary: moderation, payments, DJ switches, guest counts
  db.prepare(`SELECT kind, actor, summary, detail, created_at FROM event_log WHERE event_id IN (${ph})`)
    .all(...ids)
    .forEach((l) => {
      const [cat, icon] = LOG_KINDS[l.kind] || ['dj', '•'];
      let sub = '';
      try {
        sub = (l.detail && JSON.parse(l.detail).note) || '';
      } catch (err) {
        sub = '';
      }
      add(l.created_at, cat, icon, l.summary, sub);
    });

  items.sort((x, y) => (x.at < y.at ? -1 : x.at > y.at ? 1 : x.rank - y.rank));
  items.forEach((i) => delete i.rank);

  // --- Summary numbers for the top of the page
  const one = (sql, ...args) => db.prepare(sql).get(...args);
  const logCount = (kind) => one(`SELECT COUNT(*) AS c FROM event_log WHERE event_id IN (${ph}) AND kind = ?`, ...ids, kind).c;
  const presence = db
    .prepare(`SELECT detail FROM event_log WHERE event_id IN (${ph}) AND kind = 'presence'`)
    .all(...ids)
    .map((r) => {
      try {
        return Number(JSON.parse(r.detail).count) || 0;
      } catch (err) {
        return 0;
      }
    });
  const passRows = db
    .prepare(`SELECT detail FROM event_log WHERE event_id IN (${ph}) AND kind IN ('pass_bought', 'host_paid')`)
    .all(...ids);
  const revenueCents = passRows.reduce((sum, r) => {
    try {
      return sum + (Number(JSON.parse(r.detail).amountCents) || 0);
    } catch (err) {
      return sum;
    }
  }, 0);

  const stats = {
    peakGuests: presence.length ? Math.max(...presence) : null,
    requests: one(`SELECT COUNT(*) AS c FROM song_requests WHERE event_id IN (${ph}) AND requested_by NOT IN ('DJ Pick', 'Song Battle')`, ...ids).c,
    played: one(
      `SELECT COUNT(*) AS c FROM (SELECT DISTINCT normalized_key, played_at FROM song_requests WHERE event_id IN (${ph}) AND status = 'played')`,
      ...ids
    ).c,
    chatGuest: one(`SELECT COUNT(*) AS c FROM chat_messages WHERE event_id IN (${ph}) AND is_dj = 0`, ...ids).c,
    chatDeleted: logCount('chat_deleted'),
    reactions: one(`SELECT COUNT(*) AS c FROM reactions WHERE event_id IN (${ph})`, ...ids).c,
    guestbook: one(`SELECT COUNT(*) AS c FROM guestbook_entries WHERE event_id IN (${ph})`, ...ids).c,
    photosSent: logCount('photo_uploaded'),
    photosApproved: logCount('photo_approved'),
    photosRejected: logCount('photo_rejected') + logCount('photo_blocked'),
    passesSold: logCount('pass_bought'),
    revenueCents,
    drops: one(`SELECT COUNT(*) AS c FROM drops WHERE event_id IN (${ph})`, ...ids).c,
  };

  const live = getLiveFlag(ids);
  return {
    night: {
      id: night.nightId,
      name: segments[0].name || 'Untitled event',
      startedAt: segments[0].started_at,
      endedAt: last.ended_at,
      segments: segments.length,
      live,
    },
    stats,
    categories: CATEGORIES,
    items,
  };
}

function getLiveFlag(ids) {
  return getSetting('is_live') === '1' && ids.includes(Number(getSetting('current_event_id')));
}

module.exports = { buildTimeline, getNight, CATEGORIES };
