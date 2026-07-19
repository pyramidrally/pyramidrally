# 🍏 FOOD PYRAMID RALLY

A daily rally stage where the healthy food pyramid fights back. Everyone in the
world races the same procedurally generated stage each day — eat GO foods to
shrink and boost, dodge WHOA foods that puff you up, drift through hairpins,
jump the ramps, mind the rocks, and don't fall off the bridges.

**art of rally × wordle × WRC — but make it nutrition.**

## Features
- 🌍 Daily seeded stage — identical for every player, every run (items included)
- 🏆 Monthly championship: points (100…1) for every daily, for signed-in drivers
- 💬 Optional Discord webhook: a live scoreboard that edits itself, plus final results each day
- 🍜 20 rotating cuisines (Korean, Vietnamese, Polish, Mexican, Turkish, Caribbean…), each with its own GO/WHOA foods and one-line nutrition facts
- 🏁 Real service-park start queue: the server marshal releases the next driver 3 s after the previous one crosses the line — no bots, only real people
- 🚗 Momentum + grip physics: brake into corners and the tail drifts out
- 💧 Water shields, 🪨 rocks, jump ramps, bridges, one-lane narrows
- 👥 Live positions of every racer, world-record ghost, personal ghosts
- 📅 Past stages get their own results page at /day?d=YYYY-MM-DD, linked from the menu
- ⏱ Stages close at midnight UTC: a run driven on yesterday's stage can never land on today's board, and open tabs pick up the new stage automatically
- 🗣 Co-driver mode: scan the crew QR (or open `/codriver`, enter the 4-letter code) to read live pace notes to your driver
- 📻 Proximity crowd noise + vuvuzela horns from the fan zones

## Run locally
```
npm install
npm start          # → http://localhost:3000
```

## Deploy (Render.com free tier)
- Runtime **Node** · Build `npm install` · Start `npm start`
- Free tier sleeps after ~15 min idle; first visitor waits ~30–50 s

### Accounts & the monthly championship (optional)
Signed-in drivers bank championship points from every daily stage. The curve is
steep at the sharp end so winning actually means something:

| P1 | P2 | P3 | P4 | P5 | P10 | P25 | P50 | P100 |
|----|----|----|----|----|-----|-----|-----|------|
| 100| 80 | 65 | 55 | 47 | 22  | 13  | 6   | 1    |

A win is worth roughly four top-ten finishes, and two mid-pack days never
outweigh one victory. Anonymous racers still appear on the daily board and
still occupy their finishing position (so they consume that position's
points) — they just don't bank anything. Standings are recomputed
from the stored daily boards, so a correction to any day fixes the month.

To switch accounts on:
1. **console.cloud.google.com** → create a project
2. **APIs & Services → OAuth consent screen** → External → fill in the basics
3. **Credentials → Create credentials → OAuth client ID → Web application**
4. Under *Authorized JavaScript origins* add your site, e.g.
   `https://pyramidrally.onrender.com` (add `http://localhost:3000` for local dev)
5. Copy the **Client ID** and set it on Render as `GOOGLE_CLIENT_ID`

Optionally set `SESSION_SECRET` to any long random string; if you don't, one is
derived from your client id + storage token so sessions still survive restarts.

Without `GOOGLE_CLIENT_ID` the sign-in card and championship simply stay
hidden and everything else works exactly as before.

### Discord leaderboard (optional)
Posts to a Discord channel through a webhook — no bot process, no token, and
nothing to keep online. That matters here: a gateway bot would spend its life
reconnecting on a free instance that sleeps, whereas a webhook is just an
outbound POST whenever the server happens to be awake.

Two messages per stage:
- a **live scoreboard** for the day in progress, edited in place as times come
  in, so the channel gets one self-updating post instead of a stream of spam
- a **final results** post when the stage closes at midnight UTC, with the
  podium, the driver count and the current championship top five

Setup:
1. In Discord: **Server Settings → Integrations → Webhooks → New Webhook**,
   pick the channel, then **Copy Webhook URL**
2. On Render, add `DISCORD_WEBHOOK_URL` = that URL
3. Also add `SITE_URL` = `https://your-site.onrender.com` so the posts can link
   back to the stage results page

Notes:
- Updates are debounced (one edit per ~20s at most) and skipped entirely when
  the top ten hasn't changed, so Discord's rate limits are never a concern.
- Adding the webhook to a server that already has history does **not** dump a
  backlog into the channel: existing days are marked as history and posting
  begins with the next stage that closes.
- If the instance is asleep at midnight, the final post is made the next time
  it wakes up rather than being skipped.
- Driver names are stripped of markdown and `@everyone`/`@here` before posting.

### Keep the leaderboard through restarts
The board is just a small JSON file — but Render's free tier wipes the local
disk on every sleep/redeploy. Pick ONE of these to make it survive:

**Option A — GitHub Gist (simplest: it's literally your txt file in the cloud)**
1. Go to **gist.github.com** → paste `{}` → filename `leaderboard.json` → *Create secret gist*
2. Copy the gist's ID from its URL (`gist.github.com/you/`**`THIS_LONG_ID`**)
3. Go to github.com → Settings → Developer settings → **Tokens (classic)** →
   Generate new token → tick ONLY the **gist** scope → generate & copy
4. In Render → your service → **Environment**, add:
   - `GIST_ID` = the gist ID
   - `GIST_TOKEN` = the token
5. Save (auto-redeploys). Boot log: `Leaderboard storage: gist (persistent)`
   Bonus: you can watch your leaderboard live at the gist page.

**Option B — Upstash Redis (free, more "proper")**
1. **upstash.com** → sign up → Create Database (Redis, free plan)
2. Copy the REST URL + REST TOKEN from the database page
3. Render env vars: `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`

**Option C — Render persistent disk** — zero setup, zero code, but needs a
paid instance (attach a 1 GB disk; the existing `leaderboard.json` just works).

Without any of these the game still works — boards simply reset whenever the
free instance restarts.

## Files
- `server.js` — Express + WebSocket: live positions, global daily leaderboard, start-queue marshal, crew codes, QR endpoint
- `public/index.html` — the whole game
- `public/codriver.html` — live pace-notes page for co-drivers
- `public/day.html` — full leaderboard for any past stage
- `auth.js` — Google ID token verification + stateless sessions
- `discord.js` — webhook posting (live scoreboard + daily finals)

Nutrition framing is based on NIH "We Can!" GO/SLOW/WHOA, WHO healthy-diet
guidance, USDA MyPlate and Harvard's Nutrition Source. It's a game, not
dietary advice — WHOA foods are "sometimes" foods, not forbidden ones.
