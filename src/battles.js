const { db, normalizeKey, getFeatureFlags } = require('./db');

// How long the "winner" card lingers on guests' phones and the Big Screen.
const RESULT_LINGER_MS = 45 * 1000;

function countVotes(battleId) {
  const rows = db
    .prepare(`SELECT choice, COUNT(*) AS n FROM battle_votes WHERE battle_id = ? GROUP BY choice`)
    .all(battleId);
  return {
    votesA: rows.find((r) => r.choice === 'a')?.n || 0,
    votesB: rows.find((r) => r.choice === 'b')?.n || 0,
  };
}

// Puts a battle's winning song at the top of the "Up Next" board, already
// marked Accepted so guests see the DJ has it coming. If someone had already
// requested that song we just accept their request instead of adding a
// duplicate row.
function queueSong(eventId, title, artist) {
  const key = normalizeKey(title, artist);
  const existing = db
    .prepare(`SELECT 1 FROM song_requests WHERE event_id = ? AND normalized_key = ? AND status = 'pending' LIMIT 1`)
    .get(eventId, key);
  if (existing) {
    db.prepare(
      `UPDATE song_requests SET accepted = 1
       WHERE event_id = ? AND normalized_key = ? AND status = 'pending'`
    ).run(eventId, key);
    return;
  }
  db.prepare(
    `INSERT INTO song_requests
       (event_id, song_title, artist, normalized_key, requested_by, accepted)
     VALUES (?, ?, ?, ?, 'Song Battle', 1)`
  ).run(eventId, title, artist || null, key);
}

// Celebrates the result on every screen (confetti plus a banner) when the
// DJ has Drops switched on.
function announceResult(closed) {
  if (!getFeatureFlags().effects) return;
  let text;
  if (closed.winner === 'a') text = `\u{1F3C6} ${closed.song_a} wins the battle!`;
  else if (closed.winner === 'b') text = `\u{1F3C6} ${closed.song_b} wins the battle!`;
  else if (closed.winner === 'tie') text = `\u{1F91D} It's a tie — both songs are coming up!`;
  else return;
  const insert = db.prepare(`INSERT INTO drops (event_id, kind, message) VALUES (?, ?, ?)`);
  insert.run(closed.event_id, 'confetti', null);
  insert.run(closed.event_id, 'shoutout', text.slice(0, 140));
}

// Closes a battle (idempotent) and queues the winner. A tie queues both; no
// votes queues neither. Returns the closed battle row, or null if it was
// already closed / doesn't exist.
function closeBattle(battleId) {
  const closed = db.transaction(() => {
    const battle = db.prepare(`SELECT * FROM battles WHERE id = ? AND closed_at IS NULL`).get(battleId);
    if (!battle) return null;

    const { votesA, votesB } = countVotes(battleId);
    let winner = 'none';
    if (votesA || votesB) winner = votesA > votesB ? 'a' : votesB > votesA ? 'b' : 'tie';

    db.prepare(`UPDATE battles SET closed_at = datetime('now'), closed_ms = ?, winner = ? WHERE id = ?`).run(
      Date.now(),
      winner,
      battleId
    );

    if (winner === 'a' || winner === 'tie') queueSong(battle.event_id, battle.song_a, battle.artist_a);
    if (winner === 'b' || winner === 'tie') queueSong(battle.event_id, battle.song_b, battle.artist_b);

    return { ...battle, winner, votesA, votesB };
  })();
  if (closed) announceResult(closed);
  return closed;
}

// Timed battles close themselves the next time anyone asks about them —
// no background timer needed, and the result is the same either way.
function closeIfExpired(battle) {
  if (battle && battle.ends_at && Date.now() >= battle.ends_at) {
    closeBattle(battle.id);
    return true;
  }
  return false;
}

function shape(battle, votes) {
  return {
    id: battle.id,
    songA: battle.song_a,
    artistA: battle.artist_a || '',
    songB: battle.song_b,
    artistB: battle.artist_b || '',
    votesA: votes.votesA,
    votesB: votes.votesB,
  };
}

// { active, result } for an event. `active` is the open battle (if any);
// `result` is the most recently closed one for a short while afterwards.
function getBattleState(eventId) {
  let open = db
    .prepare(`SELECT * FROM battles WHERE event_id = ? AND closed_at IS NULL ORDER BY id DESC LIMIT 1`)
    .get(eventId);
  if (open && closeIfExpired(open)) open = null;

  let active = null;
  if (open) {
    active = shape(open, countVotes(open.id));
    active.endsInSeconds = open.ends_at ? Math.max(0, Math.round((open.ends_at - Date.now()) / 1000)) : null;
  }

  let result = null;
  if (!open) {
    const last = db
      .prepare(`SELECT * FROM battles WHERE event_id = ? AND closed_at IS NOT NULL ORDER BY id DESC LIMIT 1`)
      .get(eventId);
    if (last && last.closed_ms && Date.now() - last.closed_ms < RESULT_LINGER_MS) {
      result = shape(last, countVotes(last.id));
      result.winner = last.winner;
    }
  }

  return { active, result };
}

module.exports = { closeBattle, getBattleState };
