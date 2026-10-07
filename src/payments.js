const { db, getSetting } = require('./db');

const MIN_CENTS = 100; // $1
const MAX_CENTS = 200000; // $2,000

// The Photo Wall price the DJ typed in Tips & Extras, in cents (0 = not set).
function getPhotoWallPriceCents() {
  const dollars = parseFloat(String(getSetting('photowall_price') || '').replace(/[$,\s]/g, ''));
  if (!Number.isFinite(dollars)) return 0;
  const cents = Math.round(dollars * 100);
  return cents >= MIN_CENTS && cents <= MAX_CENTS ? cents : 0;
}

function formatMoney(cents) {
  const dollars = cents / 100;
  return `$${Number.isInteger(dollars) ? dollars : dollars.toFixed(2)}`;
}

// Records that a booking's Photo Wall add-on is paid (once — repeats are
// ignored) and unlocks any event already linked to that booking.
function recordPhotoWallPayment(inquiryId, { amountCents, ref, method }) {
  return db.transaction(() => {
    const result = db
      .prepare(
        `UPDATE inquiries
         SET photowall_paid_at = datetime('now'), photowall_amount_cents = ?,
             photowall_pay_ref = ?, photowall_pay_method = ?
         WHERE id = ? AND photowall_paid_at IS NULL`
      )
      .run(amountCents || null, ref || null, method, inquiryId);
    db.prepare(`UPDATE events SET photowall_unlocked = 1 WHERE inquiry_id = ?`).run(inquiryId);
    return result.changes > 0;
  })();
}

// Takes a Stripe Checkout Session (from a webhook or fetched directly) and,
// only if it is genuinely paid and matches what we asked for, records it.
// Returns true when the booking is now marked paid.
function applyPaidSession(session) {
  if (!session || session.payment_status !== 'paid') return false;
  const meta = session.metadata || {};
  if (meta.product === 'photopass') return !!applyPaidPassSession(session);
  if (meta.product !== 'photowall') return false;

  const inquiryId = Number(meta.inquiry_id);
  const expected = Number(meta.amount_cents);
  if (!inquiryId || !expected || Number(session.amount_total) !== expected) return false;
  if (!db.prepare(`SELECT 1 FROM inquiries WHERE id = ?`).get(inquiryId)) return false;

  recordPhotoWallPayment(inquiryId, { amountCents: expected, ref: session.id, method: 'stripe' });
  return true;
}

// --- Photo Passes: $5-ish, one guest, unlocks photo uploads forever ---------------

const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O/1/I/L — easy to read aloud
const crypto = require('crypto');

function getPassPriceCents() {
  const dollars = parseFloat(String(getSetting('photopass_price') || '').replace(/[$,\s]/g, ''));
  if (!Number.isFinite(dollars)) return 0;
  const cents = Math.round(dollars * 100);
  return cents >= 100 && cents <= 10000 ? cents : 0;
}

function cleanPassCode(value) {
  if (typeof value !== 'string') return '';
  const code = value.trim().toUpperCase().replace(/\s+/g, '');
  return /^PASS-[A-Z0-9]{6}$/.test(code) ? code : '';
}

function createPassRow({ source, name, email, status, clientId, amountCents, sessionId }) {
  for (let attempt = 0; attempt < 8; attempt++) {
    let tail = '';
    for (let i = 0; i < 6; i++) tail += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
    const code = `PASS-${tail}`;
    try {
      const result = db
        .prepare(
          `INSERT INTO photo_passes (code, name, email, source, status, client_id, amount_cents, stripe_session_id, activated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, CASE WHEN ? = 'active' THEN datetime('now') END)`
        )
        .run(code, name || null, email || null, source, status, clientId || null, amountCents || null, sessionId || null, status);
      return db.prepare(`SELECT * FROM photo_passes WHERE id = ?`).get(result.lastInsertRowid);
    } catch (err) {
      if (!/UNIQUE/.test(err.message)) throw err; // only retry code collisions
    }
  }
  throw new Error('Could not create a unique pass code');
}

function getActivePassByCode(code) {
  const clean = cleanPassCode(code);
  if (!clean) return null;
  return db.prepare(`SELECT * FROM photo_passes WHERE code = ? AND status = 'active'`).get(clean) || null;
}

// A paid Checkout Session for a pass: activates it (once) and records who paid.
function applyPaidPassSession(session) {
  if (!session || session.payment_status !== 'paid') return null;
  const meta = session.metadata || {};
  if (meta.product !== 'photopass') return null;
  const expected = Number(meta.amount_cents);
  if (!expected || Number(session.amount_total) !== expected) return null;

  const pass = db.prepare(`SELECT * FROM photo_passes WHERE code = ?`).get(cleanPassCode(meta.pass_code));
  if (!pass) return null;
  if (pass.status === 'pending') {
    const email = (session.customer_details && session.customer_details.email) || session.customer_email || null;
    db.prepare(
      `UPDATE photo_passes SET status = 'active', activated_at = datetime('now'),
              amount_cents = ?, stripe_session_id = ?, email = COALESCE(?, email)
       WHERE id = ? AND status = 'pending'`
    ).run(expected, session.id, email, pass.id);
  }
  return db.prepare(`SELECT * FROM photo_passes WHERE id = ?`).get(pass.id);
}

module.exports = {
  getPhotoWallPriceCents,
  formatMoney,
  recordPhotoWallPayment,
  applyPaidSession,
  getPassPriceCents,
  cleanPassCode,
  createPassRow,
  getActivePassByCode,
  applyPaidPassSession,
};
