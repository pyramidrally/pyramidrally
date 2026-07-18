# 🍏 PYRAMID RALLY

A daily rally stage where the healthy food pyramid fights back. Everyone in the
world races the same procedurally generated stage each day — eat GO foods to
shrink and boost, dodge WHOA foods that puff you up, drift through hairpins,
jump the ramps, mind the rocks, and don't fall off the bridges.

**art of rally × wordle × WRC — but make it nutrition.**

## Features
- 🌍 Daily seeded stage — identical for every player, every run (items included)
- 🍜 20 rotating cuisines (Korean, Vietnamese, Polish, Mexican, Turkish, Caribbean…), each with its own GO/WHOA foods and one-line nutrition facts
- 🏁 Real service-park start queue: the server marshal releases the next driver 3 s after the previous one crosses the line — no bots, only real people
- 🚗 Momentum + grip physics: brake into corners and the tail drifts out
- 💧 Water shields, 🪨 rocks, jump ramps, bridges, one-lane narrows
- 👥 Live positions of every racer, world-record ghost, personal ghosts
- 🗣 Co-driver mode: scan the crew QR (or open `/codriver`, enter the 4-letter code) to read live pace notes to your driver
- 🎻 Public-domain classical menu music, synthesized in-browser (Für Elise, Ode to Joy, an original Bach-style minuet)
- 📻 Proximity crowd noise from the veggie fans

## Run locally
```
npm install
npm start          # → http://localhost:3000
```

## Deploy (Render.com free tier)
- Runtime **Node** · Build `npm install` · Start `npm start`
- Free tier sleeps after ~15 min idle; first visitor waits ~30–50 s

### Keep the leaderboard through restarts (free)
Render's free disk is wiped on every sleep/redeploy. To persist the boards:
1. Create a free Redis database at **upstash.com** (no card needed)
2. In the database page, copy the **REST URL** and **REST TOKEN**
3. In Render → your service → **Environment**, add:
   - `UPSTASH_REDIS_REST_URL` = the REST URL
   - `UPSTASH_REDIS_REST_TOKEN` = the REST token
4. Redeploy. Boot log should say `Leaderboard storage: Upstash Redis (persistent)`

Without these vars the game still works — boards just reset when the free
instance restarts.

## Files
- `server.js` — Express + WebSocket: live positions, global daily leaderboard, start-queue marshal, crew codes, QR endpoint
- `public/index.html` — the whole game
- `public/codriver.html` — live pace-notes page for co-drivers

Nutrition framing is based on NIH "We Can!" GO/SLOW/WHOA, WHO healthy-diet
guidance, USDA MyPlate and Harvard's Nutrition Source. It's a game, not
dietary advice — WHOA foods are "sometimes" foods, not forbidden ones.
