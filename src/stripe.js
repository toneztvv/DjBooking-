const crypto = require('crypto');

// Talks to Stripe's plain HTTPS API (no SDK needed) using the secret key set
// in the host's environment variables. STRIPE_API_BASE only exists so tests
// can point at a fake Stripe.
const API_BASE = () => (process.env.STRIPE_API_BASE || 'https://api.stripe.com').replace(/\/+$/, '');

function secretKey() {
  return process.env.STRIPE_SECRET_KEY || '';
}

function isConfigured() {
  return /^(sk|rk)_(live|test)_[A-Za-z0-9]+$/.test(secretKey());
}

function getMode() {
  if (!isConfigured()) return null;
  return secretKey().includes('_test_') ? 'test' : 'live';
}

function hasWebhookSecret() {
  return /^whsec_/.test(process.env.STRIPE_WEBHOOK_SECRET || '');
}

// Stripe wants nested objects as a[b][c]=value form fields.
function flatten(obj, prefix, out = []) {
  Object.entries(obj).forEach(([k, v]) => {
    const key = prefix ? `${prefix}[${k}]` : k;
    if (v && typeof v === 'object') flatten(v, key, out);
    else if (v !== undefined && v !== null) out.push([key, String(v)]);
  });
  return out;
}

async function stripeRequest(method, path, params, extraHeaders) {
  const headers = { Authorization: `Bearer ${secretKey()}`, ...(extraHeaders || {}) };
  let body;
  if (params) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    body = new URLSearchParams(flatten(params)).toString();
  }
  const res = await fetch(`${API_BASE()}${path}`, { method, headers, body });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data && data.error && data.error.message) || `Stripe error ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return data;
}

// A hosted Stripe checkout page. The amount is always set here on the
// server — nothing the browser sends can change the price. Payment methods
// (card, Apple Pay, Cash App Pay...) come from what's switched on in the
// Stripe dashboard.
function createCheckoutSession({ amountCents, productName, email, clientReferenceId, metadata, description, successUrl, cancelUrl, idempotencyKey }) {
  return stripeRequest('POST', '/v1/checkout/sessions', {
    mode: 'payment',
    // Stripe's minimum is 30 minutes; an unpaid checkout then closes itself, so
    // an old link can't be paid long after the price or situation changed.
    expires_at: Math.floor(Date.now() / 1000) + 31 * 60,
    success_url: successUrl,
    cancel_url: cancelUrl,
    customer_email: email || undefined,
    client_reference_id: clientReferenceId ? String(clientReferenceId) : undefined,
    line_items: [
      {
        quantity: 1,
        price_data: { currency: 'usd', unit_amount: amountCents, product_data: { name: productName } },
      },
    ],
    metadata: { ...metadata, amount_cents: String(amountCents) },
    payment_intent_data: { description: description || productName },
  }, idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined);
}

// Sends a customer's money back (used automatically when someone pays twice).
// The idempotency key makes it safe to ask more than once.
function refundPaymentIntent(paymentIntentId) {
  return stripeRequest('POST', '/v1/refunds', { payment_intent: paymentIntentId, reason: 'duplicate' }, { 'Idempotency-Key': `refund-${paymentIntentId}` });
}

function retrieveSession(id) {
  return stripeRequest('GET', `/v1/checkout/sessions/${encodeURIComponent(id)}`);
}

function checkConnection() {
  return stripeRequest('GET', '/v1/balance');
}

// Verifies the "Stripe-Signature" header so only real Stripe notifications
// are believed. `raw` must be the untouched request body.
function verifyWebhook(raw, header, secret, toleranceSeconds = 300) {
  if (!Buffer.isBuffer(raw) || !header || !secret) return null;
  const parts = Object.create(null);
  const sigs = [];
  String(header)
    .split(',')
    .forEach((piece) => {
      const [k, v] = piece.split('=');
      if (k === 'v1') sigs.push(v);
      else parts[k] = v;
    });
  const t = Number(parts.t);
  if (!t || !sigs.length) return null;
  if (Math.abs(Date.now() / 1000 - t) > toleranceSeconds) return null;

  const expected = crypto.createHmac('sha256', secret).update(`${t}.`).update(raw).digest('hex');
  const ok = sigs.some((sig) => {
    const a = Buffer.from(sig || '', 'hex');
    const b = Buffer.from(expected, 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  });
  if (!ok) return null;
  try {
    return JSON.parse(raw.toString('utf8'));
  } catch (err) {
    return null;
  }
}

module.exports = {
  isConfigured,
  getMode,
  hasWebhookSecret,
  createCheckoutSession,
  refundPaymentIntent,
  retrieveSession,
  checkConnection,
  verifyWebhook,
};
