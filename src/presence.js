// Tracks "who's actively on the live page right now" purely in memory —
// no DB table needed, and it doesn't need to survive a restart. Each guest
// browser pings every ~20s; anyone not heard from in ACTIVE_WINDOW_MS is
// considered gone.
const ACTIVE_WINDOW_MS = 45 * 1000;
const MAX_AGE_MS = 5 * 60 * 1000; // opportunistic cleanup so the map can't grow forever

const lastSeen = new Map(); // `${eventId}:${clientId}` -> timestamp

function recordPing(eventId, clientId) {
  const now = Date.now();
  lastSeen.set(`${eventId}:${clientId}`, now);

  if (lastSeen.size > 500) {
    for (const [key, ts] of lastSeen) {
      if (now - ts > MAX_AGE_MS) lastSeen.delete(key);
    }
  }
}

function getActiveCount(eventId) {
  const now = Date.now();
  const prefix = `${eventId}:`;
  let count = 0;
  for (const [key, ts] of lastSeen) {
    if (key.startsWith(prefix) && now - ts < ACTIVE_WINDOW_MS) count++;
  }
  return count;
}

module.exports = { recordPing, getActiveCount };
