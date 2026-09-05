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
  `);

  const defaults = {
    is_live: '0',
    current_event_id: '1',
    event_name: '',
  };
  const insert = db.prepare(
    'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)'
  );
  const seed = db.transaction((entries) => {
    for (const [k, v] of entries) insert.run(k, v);
  });
  seed(Object.entries(defaults));
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

module.exports = { db, initDb, getSetting, setSetting, normalizeKey };
