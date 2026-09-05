# DJXpress

A booking + live song-request website for DJXpress.

- **Home page** — intro, services, genres, calls to action.
- **Book Now** — booking inquiry form (name, contact info, event details) saved to a database you can review.
- **Live Requests** (`/live`) — when the DJ is live, guests scan a QR code to open this page on their phone and request songs. It shows:
  - **Up Next**: every pending song, who requested it, when it was first requested, and how many times.
  - **Recently Played**: the same, once the DJ marks a song as played, with the time it was played.
  - The page auto-refreshes every 5 seconds for everyone watching — no login needed.
- **Admin dashboard** (`/admin`) — password protected. Go live / end the event, clear the board for a new event, mark songs as played, view/download the QR code, and manage booking inquiries.

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
2. Guests scan the QR code shown on the dashboard (or printed ahead of time — see below) which opens `/live` on their phone.
3. Guests submit song requests; the board updates for everyone in real time.
4. As you play a song, click **Mark Played** next to it on the dashboard — it moves to "Recently Played" with a timestamp, and a fresh request for the same song later starts a new entry.
5. Click **End Live Event** when you're done. Click **Clear Board** any time you want to reset the request list without ending the event.

## Printing the QR code ahead of time

Once `SITE_URL` in `.env` is set to your real domain, generate a high-resolution QR code for print:

```bash
npm run generate-qr
# or: node scripts/generate-qr.js output.png 1500
```

This saves `djxpress-qr.png` in the project root, pointing at `<SITE_URL>/live`. You can also grab it any time from the admin dashboard ("Download High-Res PNG").

## Deploying

This app needs a persistent Node process (not a serverless/static host) because the live request board is shared, real-time state backed by a SQLite file on disk. Good options:

- **Render / Railway / Fly.io** — deploy as a Node web service, attach a small persistent disk mounted at `./data` (or set `DATA_DIR` — see below), set the env vars from `.env.example` in the dashboard.
- **A basic VPS** — `git clone`, `npm install --production`, run with a process manager like `pm2` (`pm2 start server.js --name djxpress`) behind Nginx/Caddy for HTTPS.
- **Docker** — build your own image (`node:20-slim` base, `npm ci --production`, `CMD ["node", "server.js"]`) and mount a volume at `/app/data`.

After deploying, update `SITE_URL` in your environment to the real `https://` domain so the QR code and share links point to the right place, then regenerate the QR code for print.

### Environment variables

| Variable         | Purpose                                                            |
|------------------|---------------------------------------------------------------------|
| `PORT`           | Port to listen on (default `3000`)                                 |
| `SITE_URL`       | Public URL of the site — used to build the QR code and links       |
| `ADMIN_USER`     | Username for `/admin` (HTTP Basic Auth)                            |
| `ADMIN_PASSWORD` | Password for `/admin` — **change this before going live publicly** |

## Data

All data lives in `data/djxpress.sqlite` (created automatically on first run). Back this file up periodically if you want to keep a permanent history of bookings and requests — it is not committed to git.

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
```
