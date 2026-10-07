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
  if (meta.product !== 'photowall') return false;

  const inquiryId = Number(meta.inquiry_id);
  const expected = Number(meta.amount_cents);
  if (!inquiryId || !expected || Number(session.amount_total) !== expected) return false;
  if (!db.prepare(`SELECT 1 FROM inquiries WHERE id = ?`).get(inquiryId)) return false;

  recordPhotoWallPayment(inquiryId, { amountCents: expected, ref: session.id, method: 'stripe' });
  return true;
}

module.exports = { getPhotoWallPriceCents, formatMoney, recordPhotoWallPayment, applyPaidSession };
