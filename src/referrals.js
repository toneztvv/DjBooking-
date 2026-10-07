const crypto = require('crypto');
const { db, getSetting } = require('./db');

// Easy to read aloud: no 0/O or 1/I/L.
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_RE = /^[A-Z0-9-]{3,20}$/;

function newCode() {
  let tail = '';
  for (let i = 0; i < 5; i++) tail += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
  return `DJX-${tail}`;
}

// A code is only ever stored or shown after passing this, so nothing a
// visitor types in a link can end up as HTML or odd characters.
function cleanReferral(value) {
  if (typeof value !== 'string') return '';
  const code = value.trim().toUpperCase();
  return CODE_RE.test(code) ? code : '';
}

// Gives an event its own referral code the first time it needs one.
function ensureEventReferralCode(eventId) {
  const row = db.prepare(`SELECT referral_code FROM events WHERE id = ?`).get(eventId);
  if (!row) return null;
  if (row.referral_code) return row.referral_code;
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = newCode();
    if (!db.prepare(`SELECT 1 FROM events WHERE referral_code = ?`).get(code)) {
      db.prepare(`UPDATE events SET referral_code = ? WHERE id = ?`).run(code, eventId);
      return code;
    }
  }
  return null;
}

// What the booking page shows when someone arrives with a code.
function getReferralInfo(code) {
  if (!code) return null;
  const event = db.prepare(`SELECT name FROM events WHERE referral_code = ?`).get(code);
  return {
    code,
    offer: getSetting('referral_offer') || '',
    known: !!event,
  };
}

module.exports = { cleanReferral, ensureEventReferralCode, getReferralInfo };
