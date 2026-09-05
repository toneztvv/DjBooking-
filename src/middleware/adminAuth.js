const crypto = require('crypto');

function timingSafeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) {
    // Still run a comparison of equal length to avoid leaking length via timing.
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

function adminAuth(req, res, next) {
  const user = process.env.ADMIN_USER || 'admin';
  const pass = process.env.ADMIN_PASSWORD || 'changeme123';

  const header = req.headers.authorization || '';
  const [scheme, encoded] = header.split(' ');

  if (scheme === 'Basic' && encoded) {
    const decoded = Buffer.from(encoded, 'base64').toString('utf8');
    const sepIndex = decoded.indexOf(':');
    const reqUser = decoded.slice(0, sepIndex);
    const reqPass = decoded.slice(sepIndex + 1);

    if (timingSafeEqual(reqUser, user) && timingSafeEqual(reqPass, pass)) {
      return next();
    }
  }

  res.set('WWW-Authenticate', 'Basic realm="DJXpress Admin"');
  return res.status(401).send('Authentication required.');
}

module.exports = adminAuth;
