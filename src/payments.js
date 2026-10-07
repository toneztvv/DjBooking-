const { db, getSetting } = require('./db');
const stripe = require('./stripe');

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

function paymentIntentOf(session) {
  const pi = session && session.payment_intent;
  return typeof pi === 'string' ? pi : (pi && pi.id) || null;
}

// Records that a booking's Photo Wall add-on is paid (once — repeats are
// ignored) and unlocks any event already linked to that booking.
function recordPhotoWallPayment(inquiryId, { amountCents, ref, method, intent }) {
  return db.transaction(() => {
    const result = db
      .prepare(
        `UPDATE inquiries
         SET photowall_paid_at = datetime('now'), photowall_amount_cents = ?,
             photowall_pay_ref = ?, photowall_pay_method = ?, photowall_pay_intent = ?,
             photowall_pending_session = NULL, photowall_pending_at = NULL
         WHERE id = ? AND photowall_paid_at IS NULL`
      )
      .run(amountCents || null, ref || null, method, intent || null, inquiryId);
    db.prepare(`UPDATE events SET photowall_unlocked = 1 WHERE inquiry_id = ?`).run(inquiryId);
    return result.changes > 0;
  })();
}

// Takes a Stripe Checkout Session (from a webhook or fetched directly) and,
// only if it is genuinely paid and matches what we asked for, records it.
// Returns { paid, duplicateIntent }: `paid` is true when the thing is now paid
// for; `duplicateIntent` is set when this payment was a SECOND payment for
// something already paid — the caller should refund it.
function applyPaidSession(session) {
  const none = { paid: false, duplicateIntent: null };
  if (!session || session.payment_status !== 'paid') return none;
  const meta = session.metadata || {};

  if (meta.product === 'photopass') {
    const pass = applyPaidPassSession(session);
    if (!pass) return none;
    return { paid: !pass.duplicateOf, duplicateIntent: pass.duplicateOf ? paymentIntentOf(session) : null };
  }
  if (meta.product !== 'photowall') return none;

  const inquiryId = Number(meta.inquiry_id);
  const expected = Number(meta.amount_cents);
  if (!inquiryId || !expected || Number(session.amount_total) !== expected) return none;
  const row = db.prepare(`SELECT photowall_paid_at, photowall_pay_ref FROM inquiries WHERE id = ?`).get(inquiryId);
  if (!row) return none;

  // Already paid by a different payment: this one is a double payment.
  if (row.photowall_paid_at && row.photowall_pay_ref !== session.id) {
    return { paid: true, duplicateIntent: paymentIntentOf(session) };
  }
  recordPhotoWallPayment(inquiryId, { amountCents: expected, ref: session.id, method: 'stripe', intent: paymentIntentOf(session) });
  return { paid: true, duplicateIntent: null };
}

// Sends a double payment back. Never throws — a failed refund is logged so the
// DJ can refund it by hand in Stripe, but must not break the page.
async function refundDuplicate(intent) {
  if (!intent || !stripe.isConfigured()) return;
  try {
    await stripe.refundPaymentIntent(intent);
    console.warn(`Refunded duplicate payment ${intent}`);
  } catch (err) {
    console.error(`Could not auto-refund duplicate payment ${intent}: ${err.message}`);
  }
}

// A refund or a dispute (chargeback) on a payment switches off whatever it
// paid for, so a pass can't be kept after the money was taken back.
function revokeByPaymentIntent(intent) {
  if (!intent) return;
  db.transaction(() => {
    db.prepare(`UPDATE photo_passes SET status = 'revoked' WHERE payment_intent = ? AND status = 'active'`).run(intent);
    const bookings = db.prepare(`SELECT id FROM inquiries WHERE photowall_pay_intent = ?`).all(intent);
    bookings.forEach((b) => {
      db.prepare(
        `UPDATE inquiries SET photowall_paid_at = NULL, photowall_amount_cents = NULL, photowall_pay_ref = NULL,
                photowall_pay_method = NULL, photowall_pay_intent = NULL
         WHERE id = ?`
      ).run(b.id);
      db.prepare(`UPDATE events SET photowall_unlocked = 0 WHERE inquiry_id = ? AND ended_at IS NULL`).run(b.id);
    });
  })();
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
// If the same email already holds an active paid pass, this one is a duplicate
// payment: it is not activated (the guest keeps their existing pass) and the
// returned row carries `duplicateOf` so the caller can refund the money.
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
    const intent = paymentIntentOf(session);
    const original = email
      ? db
          .prepare(
            `SELECT id FROM photo_passes
             WHERE status = 'active' AND source = 'stripe' AND lower(email) = lower(?) AND id != ?
             ORDER BY id LIMIT 1`
          )
          .get(email, pass.id)
      : null;
    if (original) {
      db.prepare(
        `UPDATE photo_passes SET status = 'revoked', duplicate_of = ?, amount_cents = ?, stripe_session_id = ?,
                email = ?, payment_intent = ?
         WHERE id = ? AND status = 'pending'`
      ).run(original.id, expected, session.id, email, intent, pass.id);
    } else {
      db.prepare(
        `UPDATE photo_passes SET status = 'active', activated_at = datetime('now'),
                amount_cents = ?, stripe_session_id = ?, email = COALESCE(?, email), payment_intent = ?
         WHERE id = ? AND status = 'pending'`
      ).run(expected, session.id, email, intent, pass.id);
    }
  }

  const row = db.prepare(`SELECT * FROM photo_passes WHERE id = ?`).get(pass.id);
  row.duplicateOf = row.duplicate_of ? db.prepare(`SELECT * FROM photo_passes WHERE id = ?`).get(row.duplicate_of) : null;
  return row;
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
  paymentIntentOf,
  refundDuplicate,
  revokeByPaymentIntent,
};
