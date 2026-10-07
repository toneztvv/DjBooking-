const path = require('path');
const fs = require('fs');
const { db } = require('./db');

// Guest photos live on the same persistent disk as the database so they
// survive restarts and deploys. They are only ever served through routes
// that check the DJ approved them first.
const WALL_DIR = path.join(__dirname, '..', 'data', 'photowall');
if (!fs.existsSync(WALL_DIR)) fs.mkdirSync(WALL_DIR, { recursive: true });

// Guests' phones shrink photos before uploading (see wall.js on the live
// page); this is the server-side ceiling so nothing big ever gets stored.
const MAX_PHOTO_BYTES = 350 * 1024;

const WALL_FILE_RE = /^[0-9a-f-]{36}\.jpg$/;

// Every JPEG starts FF D8 FF — checked so only a real photo can be saved,
// no matter what the upload claims to be.
function looksLikeJpeg(buf) {
  return Buffer.isBuffer(buf) && buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
}

function deleteWallFile(filename) {
  if (!WALL_FILE_RE.test(filename)) return;
  fs.unlink(path.join(WALL_DIR, filename), () => {});
}

// Photos nobody reviewed within two days are deleted — unreviewed pictures
// shouldn't sit on the disk indefinitely.
const STALE_PENDING_SQL = `status = 'pending' AND created_at < datetime('now', '-2 days')`;

function purgeStalePending() {
  const rows = db.prepare(`SELECT id, filename FROM wall_photos WHERE ${STALE_PENDING_SQL}`).all();
  rows.forEach((r) => {
    db.prepare(`DELETE FROM wall_photos WHERE id = ?`).run(r.id);
    deleteWallFile(r.filename);
  });
  return rows.length;
}

module.exports = { WALL_DIR, MAX_PHOTO_BYTES, WALL_FILE_RE, looksLikeJpeg, deleteWallFile, purgeStalePending };
