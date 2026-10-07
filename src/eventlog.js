const { db, getSetting } = require('./db');

// The "diary" of a night: things that would otherwise leave no trace (a photo
// the DJ rejected, a chat message they deleted, a button they pressed, a
// payment). Everything else on the timeline is read from the normal tables.
// Logging must never break the thing being logged, so it swallows its errors.

function currentEventId() {
  return Number(getSetting('current_event_id') || '1');
}

function logEvent(kind, summary, opts = {}) {
  try {
    db.prepare(`INSERT INTO event_log (event_id, kind, actor, summary, detail) VALUES (?, ?, ?, ?, ?)`).run(
      opts.eventId || currentEventId(),
      kind,
      opts.actor || 'system',
      String(summary).slice(0, 500),
      opts.detail ? JSON.stringify(opts.detail).slice(0, 2000) : null
    );
  } catch (err) {
    console.error('event log failed:', err.message);
  }
}

// For things that fire in a stream (dragging the energy slider): within the
// window, update the latest entry instead of adding a new one each time.
function logCoalesced(kind, summary, windowSeconds, opts = {}) {
  try {
    const eventId = opts.eventId || currentEventId();
    const last = db
      .prepare(
        `SELECT id FROM event_log
         WHERE event_id = ? AND kind = ? AND created_at >= datetime('now', ?)
         ORDER BY id DESC LIMIT 1`
      )
      .get(eventId, kind, `-${Number(windowSeconds) || 20} seconds`);
    if (last) {
      db.prepare(`UPDATE event_log SET summary = ?, created_at = datetime('now') WHERE id = ?`).run(String(summary).slice(0, 500), last.id);
    } else {
      logEvent(kind, summary, { ...opts, eventId });
    }
  } catch (err) {
    console.error('event log failed:', err.message);
  }
}

// A short, stable tag for a phone ("#a3f9c1") so the DJ can tell that two
// entries came from the same device without storing anything revealing.
function phoneTag(clientId) {
  return clientId ? `#${String(clientId).replace(/[^a-zA-Z0-9]/g, '').slice(0, 6)}` : '';
}

module.exports = { logEvent, logCoalesced, phoneTag, currentEventId };
