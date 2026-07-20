# 🍏 FOOD PYRAMID RALLY

A daily rally stage where the healthy food pyramid fights back. Everyone in the
world races the same procedurally generated stage each day — eat GO foods to
shrink and boost, dodge WHOA foods that puff you up, drift through hairpins,
jump the ramps, mind the rocks, and don't fall off the bridges.

**art of rally × wordle × WRC — but make it nutrition.**

## Features
- 🌍 Daily seeded stage — identical for every player, every run (items included)
- 🏆 Monthly championship: points for every daily, for signed-in drivers
- 🎬 Highlights: the game finds the best few seconds of your run and plays it back with commentary; sharing encodes a GIF on the spot
- 👀 Spectator mode: watch anyone currently on the stage, cycling between them
- ⌨️ Backspace restarts a run for keyboard players
- 🏁 FPRC daily reel: the leader, the pack and the last finisher, cut together with rally commentary
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

### Highlight clips
Runs are already recorded for ghosts, so the same data can be replayed. The
game scores every moment of a run — speed, how hard you were turning *while*
fast, food eaten, jumps — slides a window over it and keeps the best few
seconds. That window is replayed onto an offscreen canvas and encoded as a GIF
in the browser; nothing is uploaded and no library is used.

Clips carry **commentary written from the telemetry** — speed, curvature (so a
hairpin is called a hairpin whatever speed you crawl through it at), bridges,
going off the road, jumps and what you ate. Because every line is derived from
what the car actually did, the commentary can never describe something that
did not happen. Lines are burned into the clip as captions; the results page
can also speak them aloud with the browser voice while the reel plays, though
browsers will not let that voice be captured into the saved file.

Clips draw the real world, not a sketch of it: the food stickers, the trees and
grass, the rocks, and each driver's own painted car on its chassis — the same
renderer the game uses, so a clip looks like the stage you drove.

The results page builds the **FPRC reel** by casting for incident rather than
for lap time — finishing order makes a dull reel, because the quick drivers are
the tidy ones. Every recorded line on the stage is scanned for its best moment
of each kind (a splash off a bridge, big air off a ramp, running out of road,
hanging it sideways, an outright charge), and roughly half a minute is cut from
about six drivers, chosen so the reel keeps changing shape. The leader opens at
their wildest moment and whoever came home last signs off. The server keeps
recorded lines for the top fourteen plus the last finisher, for seven days.

### Link previews
Pages carry `%SITE_URL%` placeholders which the server fills in per request
from the host actually being used. Point a custom domain at the service and
previews follow automatically, with nothing to edit. `SITE_URL` overrides it.

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
- `public/day.html` — full leaderboard for any past stage, plus the FPRC reel
- `public/clip.js` — highlight scoring, replay renderer and a dependency-free GIF89a encoder
- `public/stage.js` — stage, foods, rocks and scenery, GENERATED from index.html by make_stage_js.py
- `public/og.png` — link-preview image (regenerate with make_og.py)
- `auth.js` — Google ID token verification + stateless sessions

Nutrition framing is based on NIH "We Can!" GO/SLOW/WHOA, WHO healthy-diet
guidance, USDA MyPlate and Harvard's Nutrition Source. It's a game, not
dietary advice — WHOA foods are "sometimes" foods, not forbidden ones.
