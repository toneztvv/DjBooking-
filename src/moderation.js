// Chat is anonymous and open to anyone with the link, so this is a blunt
// first line of defense: a fixed list of slurs that, if used, auto-remove
// the sender from chat. Matches whole words only (not substrings), so it
// won't catch a slur hidden inside an unrelated word. Edit this list any
// time — no redeploy steps beyond a normal code push.
const BANNED_WORDS = ['nigger', 'nigga', 'faggot', 'fag', 'pussy', 'gay'];

function containsBannedWord(text) {
  const tokens = String(text || '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  return tokens.some((word) => BANNED_WORDS.includes(word));
}

module.exports = { containsBannedWord, BANNED_WORDS };
