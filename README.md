# DJXpress

A booking + live song-request website for DJXpress.

**Just want to click around right now?** This repo includes a static demo at `docs/index.html` you can view on GitHub Pages with zero setup — see [Static demo on GitHub Pages](#static-demo-on-github-pages) below. It's a demo only: each visitor's browser keeps its own private copy of the data. For a real event where every guest's phone shares the same live board, deploy the real app described in the rest of this README.

- **Home page** — intro, services, genres, calls to action.
- **Book Now** — booking inquiry form (name, contact info, event details) saved to a database you can review.
- **Live Requests** (`/live`) — reachable from the homepage's nav, or directly when the DJ is live. Guests request songs here. It shows:
  - **Up Next**: every pending song, who requested it, when it was first requested, and how many times.
  - **Recently Played**: the same, once the DJ marks a song as played, with the time it was played.
  - The page auto-refreshes every 5 seconds for everyone watching — no login needed.
  - **Live Chat**: while the DJ is live, guests and the DJ can type back and forth in a shared chat everyone at the event sees, updating every few seconds.
- **Admin dashboard** (`/admin`) — password protected. Go live / end the event, clear the board for a new event, mark songs as played, reply in the live chat, view/download the QR code, and manage booking inquiries.
- **Event History** (`/admin/events`) — every event the DJ has ever gone live for, permanently kept: full setlist in the order songs were actually played (with timestamps and who requested them), which requested songs never got played, and the full live chat log. Clicking "Clear Board" mid-event splits it into a new chapter in the history rather than losing the first half.

## Tech stack

Plain Node.js + Express + EJS templates + SQLite (via `better-sqlite3`) — no build step, no frontend framework required. Easy to run anywhere Node runs.

## Local setup

```bash
npm install
cp .env.example .env
# edit .env: set ADMIN_USER / ADMIN_PASSWORD, and SITE_URL once you have a domain
npm start
```

Visit `http://localhost:3000`. The admin dashboard is at `http://localhost:3000/admin` (browser will prompt for the username/password from `.env`).

For auto-reload during development: `npm run dev` (uses nodemon).

## Using it at an event

1. In `/admin`, click **Go Live** (optionally name the event, e.g. "Smith Wedding").
2. Guests scan the QR code shown on the dashboard (or printed ahead of time — see below), which opens the homepage on their phone. From there they can tap **Book Now** or **Live Requests**.
3. Guests submit song requests; the board updates for everyone in real time.
4. As you play a song, click **Mark Played** next to it on the dashboard — it moves to "Recently Played" with a timestamp, and a fresh request for the same song later starts a new entry.
5. Click **End Live Event** when you're done. Click **Clear Board** any time you want to reset the request list without ending the event.

## Email notifications for new bookings

When someone submits the booking form, `/admin` always shows it — but you can also have it email you the moment it comes in.

This uses [Resend](https://resend.com) (a transactional email API, free for up to 3,000 emails/month, no credit card needed) rather than sending directly through Gmail's own servers — most hosts, Render included, block or time out direct SMTP connections, so a plain HTTPS API call is the reliable option.

1. Create a free account at [resend.com](https://resend.com).
2. Go to [resend.com/api-keys](https://resend.com/api-keys) → **Create API Key** → copy it (you won't be able to see it again after leaving the page).
3. Set two environment variables:
   - `RESEND_API_KEY` → the key from step 2
   - `GMAIL_USER` → the email address that should *receive* the notifications (any address works despite the name — it doesn't have to be Gmail)
   - Locally: add them to `.env`. On Render: service → **Environment** tab → add both (or use **Add from .env** to paste several at once) → save (this restarts the service automatically).

Once set, every new booking inquiry emails that address with all the details, and hitting **Reply** goes straight to the customer, not back to yourself. Leave these two variables unset and the site works exactly the same — inquiries just won't trigger an email, only show up in `/admin`.

## Automatic song detection

Manually tapping "Mark Played" for every song works fine, but if you'd rather it happen on its own, the admin dashboard has a **Start Listening** button (visible while live) that samples audio from the DJ laptop's built-in mic every 30–90 seconds and identifies what's playing via [AudD](https://audd.io) — a music recognition API. There's no way to ask djay Pro (or any DJ software) directly what it's playing, so this works by listening to the room instead, same idea as Shazam.

- A match against a **pending request** auto-marks it played, live, without anyone touching the dashboard.
- Anything else played gets logged too (labeled "DJ Pick"), so the event history ends up a complete tracklist of the night — not just fulfilled requests.
- To avoid burning through recognition quota on a song that plays for several minutes, the check backs off (up to 90s between checks) as long as the same song keeps matching, and resets to 30s the moment it changes.

**Setup:**
1. Create a free account at [audd.io](https://audd.io) — 300 free recognitions, no credit card needed. Past that it's pay-as-you-go, roughly $5 per 1,000 recognitions (a 4-hour set checked every 30s is a few dollars at most).
2. Grab an API key from your AudD account page.
3. Set `AUDD_API_KEY` to that key (same place as the other env vars — `.env` locally, Render's Environment tab in production).

Leave it unset and the dashboard just won't show the Start Listening button — manually tapping "Mark Played" keeps working exactly as before.

**Worth knowing before relying on it at a real event:**
- It needs the device's mic actually picking up the music, so the browser tab has to stay **open and visible** near the speakers all night. This matters most on phones: iOS and Android both suspend microphone access the instant you switch apps or lock the screen — that's a platform restriction, not something a website can override. The page requests a screen wake lock (where supported) to help prevent auto-lock, and pauses itself cleanly with a clear "Paused" message rather than silently failing when it does get backgrounded, but there's no way to make it survive being backgrounded on mobile.
- Practically: this works best left running on the laptop you're already DJing from (djaying keeps working fine either way, this only affects auto-tracking). If you'd rather use a phone, dedicate one just to this — screen unlocked, propped up near the speakers, not used for anything else during the set.
- Crowd noise and talking can reduce accuracy versus a quiet room.
- It's a real, if small, ongoing cost tied to your AudD account — check usage anytime at your AudD dashboard.

## Text message notifications

On top of email, you can get a text the moment someone submits a booking, or requests a song nobody's already asked for this event (no repeat text if three more guests request the same popular song). Carrier email-to-text gateways (the free way this used to be possible) have been shut down industry-wide — AT&T/Cricket in mid-2025, T-Mobile/Metro in late 2024 — so this uses [Twilio](https://twilio.com) instead, a real SMS service. Unlike Resend/AudD, Twilio does require a card: roughly $1/month for the sending number plus about a cent per text.

**Setup:**
1. Create a Twilio account at [twilio.com](https://twilio.com).
2. From the [Twilio Console](https://console.twilio.com), copy your **Account SID** and **Auth Token** (shown right on the main dashboard).
3. Buy a phone number to send from (Console → Phone Numbers → Buy a number) — this becomes `TWILIO_FROM_NUMBER`.
4. Set four environment variables:
   - `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` — from step 2
   - `TWILIO_FROM_NUMBER` — the number from step 3, as `+1XXXXXXXXXX`
   - `NOTIFY_PHONE_NUMBER` — your real cell number to receive texts, also as `+1XXXXXXXXXX`

Leave any of these unset and the site works exactly the same — no texts sent, email notifications and the live dashboard are unaffected.

## Printing the QR code ahead of time

Once `SITE_URL` in `.env` is set to your real domain, generate a high-resolution QR code for print:

```bash
npm run generate-qr
# or: node scripts/generate-qr.js output.png 1500
```

This saves `djxpress-qr.png` in the project root, pointing at `<SITE_URL>/live`. You can also grab it any time from the admin dashboard ("Download High-Res PNG").

## Deploying to dj-xpress.com (Render, free tier)

This repo includes `render.yaml`, so Render can build and configure the whole app automatically — you just need to create the account and add DNS records at your registrar (things only you can do, since they need your own logins).

**1. Create the service**

1. Go to [render.com](https://render.com) and sign up (the "Sign up with GitHub" option is fastest, and lets Render see your repos without a separate password).
2. Click **New → Blueprint**.
3. Select the `toneztvv/DjBooking-` repository and the branch you want live (e.g. `claude/djxpress-booking-live-requests-a569sk`, or `main` if you've merged it there). Render reads `render.yaml` and sets up the build/start commands and free plan automatically.
4. When prompted for environment variables, enter:
   - `SITE_URL` → `https://dj-xpress.com`
   - `ADMIN_USER` → a username of your choice for the DJ dashboard
   - `ADMIN_PASSWORD` → a strong password — this protects `/admin`, don't skip it
5. Click **Apply** / **Deploy**. First build takes a few minutes. When it's done, Render gives you a working URL like `djxpress.onrender.com` — check that it loads before moving on.

**2. Point dj-xpress.com at it**

1. In the Render dashboard, open the `djxpress` service → **Settings → Custom Domains → Add Custom Domain**.
2. Enter `dj-xpress.com` (add `www.dj-xpress.com` too if you want both to work).
3. At your domain registrar (wherever you bought `dj-xpress.com`), open its DNS settings and add:

   | Type  | Name/Host | Value                       |
   |-------|-----------|------------------------------|
   | `A`   | `@` (root)| `216.24.57.1`                |
   | `CNAME` | `www`   | `djxpress.onrender.com` (use the exact `.onrender.com` hostname Render shows you) |

   Remove any existing `AAAA` record on the root domain — Render doesn't use IPv6, and a leftover `AAAA` record will break this.
4. DNS changes typically take a few minutes to a few hours to propagate. Render auto-issues an SSL certificate once it sees the domain pointing correctly — no extra step needed.
5. Once it's live, visit `https://dj-xpress.com` to confirm, then regenerate the QR code (`npm run generate-qr`, or grab it from `/admin`) so it's pointing at the real domain.

**One thing to know about the free tier:** Render's free web services spin down after 15 minutes of no traffic (about a 1-minute wake-up on the next visit) and don't keep a persistent disk — so the SQLite database resets whenever the service restarts or redeploys. That's fine for getting the real site live and testing it now. When you're ready to keep bookings and requests permanently (worth doing before relying on this for a real event), the fix is either upgrading the Render plan to Starter (~$7/mo) and attaching a small persistent disk, or pointing the app at a free hosted Postgres database (e.g. Neon) instead of the local SQLite file — either is a small, contained change whenever you want to make it.

### Other hosting options

If you'd rather not use Render:

- **Railway / Fly.io** — similar Node + persistent-disk setup, usage-based pricing (no meaningful free tier anymore on either).
- **A basic VPS** (DigitalOcean, Hetzner) — `git clone`, `npm install --production`, run with `pm2 start server.js --name djxpress` behind Nginx/Caddy for HTTPS. Cheapest ongoing cost, most manual setup.
- **Docker** — build your own image (`node:20-slim` base, `npm ci --production`, `CMD ["node", "server.js"]`) and mount a volume at `/app/data`.

### Environment variables

| Variable         | Purpose                                                            |
|------------------|---------------------------------------------------------------------|
| `PORT`           | Port to listen on (default `3000`)                                 |
| `SITE_URL`       | Public URL of the site — used to build the QR code and links       |
| `ADMIN_USER`     | Username for `/admin` (HTTP Basic Auth)                            |
| `ADMIN_PASSWORD` | Password for `/admin` — **change this before going live publicly** |

## Data

All data lives in `data/djxpress.sqlite` (created automatically on first run). Back this file up periodically if you want to keep a permanent history of bookings and requests — it is not committed to git.

## Static demo on GitHub Pages

`docs/index.html` is a **self-contained, no-backend copy** of the same site — same pages, same look, same forms and buttons. It's there so anyone can see and click through the whole experience straight from GitHub Pages with no setup at all.

**The tradeoff:** it has no server, so it can't share data between visitors. Everything (song requests, the live board, booking inquiries) is saved with `localStorage` inside each visitor's own browser. Open it on two different phones and you'll see two different boards — a guest's request never reaches the DJ's screen. It's good for showing someone what the site looks like and how it behaves; it is **not** what you'd actually run at an event (use the real app above for that).

### Enable it

1. Push this repo to GitHub (already done if you're reading this from GitHub).
2. Go to **Settings → Pages** in the repository.
3. Under **Build and deployment**, set **Source** to "Deploy from a branch".
4. Pick your branch (e.g. `main`) and folder **`/docs`**, then **Save**.
5. GitHub gives you a URL like `https://<your-username>.github.io/<repo-name>/` within a minute or two.

Everything on that page — Home, Live Requests, Book Now, and the DJ Panel (open here, no password, since there's nothing sensitive behind it) — works immediately, seeded with example data so it doesn't look empty on first load.

## Project structure

```
server.js                 App entry point
src/db.js                 SQLite schema + helpers
src/qr.js                 QR code generation helpers
src/middleware/adminAuth.js  HTTP Basic Auth for /admin
src/routes/public.js      Home / Book / Live pages
src/routes/api.js         Public JSON API (inquiries, requests, live-state, QR image)
src/routes/admin.js       Admin dashboard + actions (protected)
views/                    EJS templates
public/                   CSS, client-side JS, static assets
scripts/generate-qr.js    CLI to generate a printable QR code PNG
docs/index.html           Static, no-backend demo for GitHub Pages (see above)
```
