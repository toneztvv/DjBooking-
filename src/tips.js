const { getSetting } = require('./db');

// Handles are validated when saved (see /admin/extras), but we re-check here
// too so a bad value can never end up inside a link.
const VENMO_RE = /^[A-Za-z0-9_.-]{1,40}$/;
const CASHAPP_RE = /^[A-Za-z0-9_]{1,30}$/;

function getTipMethods() {
  const methods = [];

  const venmo = getSetting('tip_venmo') || '';
  if (VENMO_RE.test(venmo)) {
    methods.push({ id: 'venmo', label: 'Venmo', display: `@${venmo}`, url: `https://venmo.com/u/${venmo}` });
  }

  const cashapp = getSetting('tip_cashapp') || '';
  if (CASHAPP_RE.test(cashapp)) {
    methods.push({ id: 'cashapp', label: 'Cash App', display: `$${cashapp}`, url: `https://cash.app/$${cashapp}` });
  }

  const zelle = getSetting('tip_zelle') || '';
  if (zelle) {
    // Zelle has no payment link, so guests copy this into their bank app.
    methods.push({ id: 'zelle', label: 'Zelle', display: zelle, url: null });
  }

  return methods;
}

// What guests see, or null when nothing's been set up yet.
function getTipJar() {
  const methods = getTipMethods();
  if (!methods.length) return null;
  return { message: getSetting('tip_message') || '', methods };
}

module.exports = { getTipMethods, getTipJar, VENMO_RE, CASHAPP_RE };
