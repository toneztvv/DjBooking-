const { getSetting } = require('./db');

// Contact details the DJ chose to show customers (all optional). Re-validated
// when read so nothing odd can ever end up inside a link.
const PHONE_RE = /^[+()\d\s.-]{7,25}$/;
const EMAIL_RE = /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/;
const INSTAGRAM_RE = /^[A-Za-z0-9._]{1,30}$/;

function getContact() {
  const phone = getSetting('contact_phone') || '';
  const email = getSetting('contact_email') || '';
  const instagram = getSetting('contact_instagram') || '';
  const c = {
    phone: PHONE_RE.test(phone) ? phone : '',
    email: EMAIL_RE.test(email) ? email : '',
    instagram: INSTAGRAM_RE.test(instagram) ? instagram : '',
  };
  c.phoneHref = c.phone ? `tel:${c.phone.replace(/[^+\d]/g, '')}` : '';
  c.smsHref = c.phone ? `sms:${c.phone.replace(/[^+\d]/g, '')}` : '';
  c.any = !!(c.phone || c.email || c.instagram);
  return c;
}

module.exports = { getContact, PHONE_RE, EMAIL_RE, INSTAGRAM_RE };
