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

    CREATE TABLE IF NOT EXISTS request_upvotes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL,
      normalized_key TEXT NOT NULL,
      client_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (event_id, normalized_key, client_id)
    );

    CREATE TABLE IF NOT EXISTS testimonials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_name TEXT NOT NULL,
      quote TEXT NOT NULL,
      event_type TEXT,
      rating INTEGER NOT NULL DEFAULT 5,
      published INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS drops (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL,
      kind TEXT NOT NULL,
      message TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_drops_event_id
      ON drops (event_id, id);

    CREATE TABLE IF NOT EXISTS gallery_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL CHECK (type IN ('photo', 'video')),
      filename TEXT NOT NULL,
      caption TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS wall_photos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL,
      filename TEXT NOT NULL,
      uploader_name TEXT,
      caption TEXT,
      client_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      approved_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_wall_photos_event
      ON wall_photos (event_id, status, id);

    CREATE TABLE IF NOT EXISTS battles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL,
      song_a TEXT NOT NULL,
      artist_a TEXT,
      song_b TEXT NOT NULL,
      artist_b TEXT,
      ends_at INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      closed_at TEXT,
      closed_ms INTEGER,
      winner TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_battles_event
      ON battles (event_id, id);

    CREATE TABLE IF NOT EXISTS battle_votes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      battle_id INTEGER NOT NULL,
      choice TEXT NOT NULL CHECK (choice IN ('a', 'b')),
      client_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (battle_id, client_id)
    );

    CREATE TABLE IF NOT EXISTS photo_passes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      name TEXT,
      email TEXT,
      source TEXT NOT NULL DEFAULT 'stripe',
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'revoked')),
      amount_cents INTEGER,
      stripe_session_id TEXT UNIQUE,
      client_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      activated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS wall_blocks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id TEXT NOT NULL UNIQUE,
      pass_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS event_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL,
      kind TEXT NOT NULL,
      actor TEXT NOT NULL DEFAULT 'system',
      summary TEXT NOT NULL,
      detail TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_event_log_event
      ON event_log (event_id, id);

    CREATE TABLE IF NOT EXISTS event_plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      inquiry_id INTEGER NOT NULL UNIQUE,
      token TEXT NOT NULL UNIQUE,
      must_play TEXT,
      do_not_play TEXT,
      timeline TEXT,
      announcements TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT,
      submitted_at TEXT
    );
  `);

  const defaults = {
    is_live: '0',
    current_event_id: '1',
    feature_guest_counter: '1',
    feature_reactions: '1',
    feature_polls: '1',
    feature_guestbook: '1',
    feature_effects: '1',
    feature_energy: '1',
    energy_level: '0',
    feature_tips: '1',
    feature_battles: '1',
    feature_photowall: '1',
    tip_venmo: '',
    tip_cashapp: '',
    tip_zelle: '',
    tip_message: 'Loving the music? Tips are never expected, always appreciated. \u{1F49C}',
    referral_offer: '',
    google_review_url: '',
    photowall_price: '',
    photopass_price: '5',
    contact_phone: '',
    contact_email: '',
    contact_instagram: '',
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
  if (!columns.some((c) => c.name === 'artwork_url')) {
    db.exec(`ALTER TABLE song_requests ADD COLUMN artwork_url TEXT`);
  }

  // Migration: a random token turns an event into a shareable (but
  // unlisted) public recap page; NULL means sharing is off.
  const eventColumns = db.prepare(`PRAGMA table_info(events)`).all();
  if (!eventColumns.some((c) => c.name === 'share_token')) {
    db.exec(`ALTER TABLE events ADD COLUMN share_token TEXT`);
  }

  if (!eventColumns.some((c) => c.name === 'photowall_unlocked')) {
    db.exec(`ALTER TABLE events ADD COLUMN photowall_unlocked INTEGER NOT NULL DEFAULT 0`);
  }
  if (!eventColumns.some((c) => c.name === 'referral_code')) {
    db.exec(`ALTER TABLE events ADD COLUMN referral_code TEXT`);
  }

  // Migration: guest reviews from the recap page land in `testimonials`
  // unpublished (published = 0) until the DJ approves them.
  const testimonialColumns = db.prepare(`PRAGMA table_info(testimonials)`).all();
  if (!testimonialColumns.some((c) => c.name === 'source')) {
    db.exec(`ALTER TABLE testimonials ADD COLUMN source TEXT NOT NULL DEFAULT 'admin'`);
  }
  if (!testimonialColumns.some((c) => c.name === 'event_id')) {
    db.exec(`ALTER TABLE testimonials ADD COLUMN event_id INTEGER`);
  }
  if (!testimonialColumns.some((c) => c.name === 'client_id')) {
    db.exec(`ALTER TABLE testimonials ADD COLUMN client_id TEXT`);
  }

  // Migration: which recap/referral code (if any) a booking inquiry came from.
  const inquiryColumns = db.prepare(`PRAGMA table_info(inquiries)`).all();
  if (!inquiryColumns.some((c) => c.name === 'referral_code')) {
    db.exec(`ALTER TABLE inquiries ADD COLUMN referral_code TEXT`);
  }
  // Photo Wall add-on payment (automatic via Stripe, or marked by hand).
  if (!inquiryColumns.some((c) => c.name === 'photowall_paid_at')) {
    db.exec(`ALTER TABLE inquiries ADD COLUMN photowall_paid_at TEXT`);
    db.exec(`ALTER TABLE inquiries ADD COLUMN photowall_amount_cents INTEGER`);
    db.exec(`ALTER TABLE inquiries ADD COLUMN photowall_pay_ref TEXT`);
    db.exec(`ALTER TABLE inquiries ADD COLUMN photowall_pay_method TEXT`);
  }
  // Which booking a live event is for, so a paid add-on unlocks it by itself.
  if (!eventColumns.some((c) => c.name === 'inquiry_id')) {
    db.exec(`ALTER TABLE events ADD COLUMN inquiry_id INTEGER`);
  }

  // One "night" can span several event rows (Clear Board starts a new row mid-gig);
  // night_id ties them together so the timeline shows the whole night.
  const eventCols3 = db.prepare(`PRAGMA table_info(events)`).all();
  if (!eventCols3.some((c) => c.name === 'night_id')) {
    db.exec(`ALTER TABLE events ADD COLUMN night_id INTEGER`);
  }

  // Payment bookkeeping: which Stripe payment a pass came from (so a refund or
  // dispute can switch it off) and, for duplicate payments, which pass it duplicated.
  const passColumns = db.prepare(`PRAGMA table_info(photo_passes)`).all();
  if (!passColumns.some((c) => c.name === 'payment_intent')) {
    db.exec(`ALTER TABLE photo_passes ADD COLUMN payment_intent TEXT`);
  }
  if (!passColumns.some((c) => c.name === 'duplicate_of')) {
    db.exec(`ALTER TABLE photo_passes ADD COLUMN duplicate_of INTEGER`);
  }
  const inqCols2 = db.prepare(`PRAGMA table_info(inquiries)`).all();
  if (!inqCols2.some((c) => c.name === 'photowall_pay_intent')) {
    db.exec(`ALTER TABLE inquiries ADD COLUMN photowall_pay_intent TEXT`);
    db.exec(`ALTER TABLE inquiries ADD COLUMN photowall_pending_session TEXT`);
    db.exec(`ALTER TABLE inquiries ADD COLUMN photowall_pending_at TEXT`);
  }

  // Which Photo Pass (if any) a guest used to upload a photo.
  const wallColumns = db.prepare(`PRAGMA table_info(wall_photos)`).all();
  if (!wallColumns.some((c) => c.name === 'pass_id')) {
    db.exec(`ALTER TABLE wall_photos ADD COLUMN pass_id INTEGER`);
  }

  // Migration: "color" lets each guest's browser pick a display color for
  // their chat bubble / guestbook name — cosmetic only, not an identity.
  const chatColumns = db.prepare(`PRAGMA table_info(chat_messages)`).all();
  if (!chatColumns.some((c) => c.name === 'color')) {
    db.exec(`ALTER TABLE chat_messages ADD COLUMN color TEXT`);
  }
  const guestbookColumns = db.prepare(`PRAGMA table_info(guestbook_entries)`).all();
  if (!guestbookColumns.some((c) => c.name === 'color')) {
    db.exec(`ALTER TABLE guestbook_entries ADD COLUMN color TEXT`);
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
    effects: getSetting('feature_effects') !== '0',
    energy: getSetting('feature_energy') !== '0',
    tips: getSetting('feature_tips') !== '0',
    battles: getSetting('feature_battles') !== '0',
    photoWall: getSetting('feature_photowall') !== '0',
  };
}

module.exports = { db, initDb, getSetting, setSetting, normalizeKey, getFeatureFlags };
