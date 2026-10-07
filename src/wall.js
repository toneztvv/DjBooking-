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

// Reads the picture size out of the JPEG header without decoding it. Used to
// refuse "decompression bombs": a tiny file that claims to be gigantic and
// would freeze the DJ's browser when it tried to draw it. Returns null for
// anything that isn't a well-formed JPEG header.
const MAX_DIMENSION_PX = 4096;
const MAX_PIXELS = 12 * 1000 * 1000;

function jpegDimensions(buf) {
  if (!looksLikeJpeg(buf)) return null;
  let i = 2;
  while (i + 4 <= buf.length) {
    if (buf[i] !== 0xff) return null;
    let marker = buf[i + 1];
    while (marker === 0xff && i + 2 < buf.length) {
      i += 1;
      marker = buf[i + 1];
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null; // end / start of data before any frame header
    const length = buf.readUInt16BE(i + 2);
    if (length < 2) return null;
    const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrame) {
      if (i + 9 > buf.length) return null;
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    }
    i += 2 + length;
  }
  return null;
}

function isAcceptablePhoto(buf) {
  const d = jpegDimensions(buf);
  return !!d && d.width >= 1 && d.height >= 1 && d.width <= MAX_DIMENSION_PX && d.height <= MAX_DIMENSION_PX && d.width * d.height <= MAX_PIXELS;
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

module.exports = { WALL_DIR, MAX_PHOTO_BYTES, WALL_FILE_RE, looksLikeJpeg, jpegDimensions, isAcceptablePhoto, deleteWallFile, purgeStalePending };
