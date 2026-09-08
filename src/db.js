const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'djxpress.sqlite'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS inquiries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT,
      event_date TEXT,
      event_type TEXT,
      location TEXT,
      guest_count TEXT,
      message TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      status TEXT NOT NULL DEFAULT 'new'
    );

    CREATE TABLE IF NOT EXISTS song_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL,
      song_title TEXT NOT NULL,
      artist TEXT,
      normalized_key TEXT NOT NULL,
      requested_by TEXT NOT NULL,
      dedication TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      played_at TEXT,
      status TEXT NOT NULL DEFAULT 'pending'
    );

    CREATE INDEX IF NOT EXISTS idx_requests_event_status
      ON song_requests (event_id, status);

    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      ended_at TEXT
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL,
      sender_name TEXT NOT NULL,
      message TEXT NOT NULL,
      is_dj INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_chat_event_id
      ON chat_messages (event_id, id);

    CREATE TABLE IF NOT EXISTS reactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL,
      emoji TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_reactions_event_id
      ON reactions (event_id, id);

    CREATE TABLE IF NOT EXISTS polls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL,
      question TEXT NOT NULL,
      option_a TEXT NOT NULL,
      option_b TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      closed_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_polls_event_id
      ON polls (event_id, id);

    CREATE TABLE IF NOT EXISTS poll_votes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      poll_id INTEGER NOT NULL,
      choice TEXT NOT NULL CHECK (choice IN ('a', 'b')),
      client_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (poll_id, client_id)
    );

    CREATE TABLE IF NOT EXISTS guestbook_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_guestbook_event_id
      ON guestbook_entries (event_id, id);
  `);

  const defaults = {
    is_live: '0',
    current_event_id: '1',
    feature_guest_counter: '1',
    feature_reactions: '1',
    feature_polls: '1',
    feature_guestbook: '1',
  };
  const insert = db.prepare(
    'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)'
  );
  const seed = db.transaction((entries) => {
    for (const [k, v] of entries) insert.run(k, v);
  });
  seed(Object.entries(defaults));

  // Backfill: earlier versions tracked only a bare event_id counter with no
  // row in `events`. Make sure the event currently pointed at by settings
  // actually exists, carrying over the old event_name setting if present.
  const currentEventId = Number(getSetting('current_event_id') || '1');
  const existingEvent = db.prepare('SELECT id FROM events WHERE id = ?').get(currentEventId);
  if (!existingEvent) {
    const legacyName = getSetting('event_name') || null;
    const isLive = getSetting('is_live') === '1';
    const endedAtExpr = isLive ? 'NULL' : "datetime('now')";
    db.prepare(
      `INSERT INTO events (id, name, started_at, ended_at)
       VALUES (?, ?, datetime('now'), ${endedAtExpr})`
    ).run(currentEventId, legacyName);
  }

  // Migration: "accepted" lets the DJ flag a pending request as confirmed
  // (visible to guests) without marking it played yet.
  const columns = db.prepare(`PRAGMA table_info(song_requests)`).all();
  if (!columns.some((c) => c.name === 'accepted')) {
    db.exec(`ALTER TABLE song_requests ADD COLUMN accepted INTEGER NOT NULL DEFAULT 0`);
  }
}

function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

function setSetting(key, value) {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(key, String(value));
}

function normalizeKey(title, artist) {
  return `${title}::${artist || ''}`.trim().toLowerCase().replace(/\s+/g, ' ');
}

function getFeatureFlags() {
  return {
    guestCounter: getSetting('feature_guest_counter') !== '0',
    reactions: getSetting('feature_reactions') !== '0',
    polls: getSetting('feature_polls') !== '0',
    guestbook: getSetting('feature_guestbook') !== '0',
  };
}

module.exports = { db, initDb, getSetting, setSetting, normalizeKey, getFeatureFlags };
