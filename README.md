# 🍏 PYRAMID RALLY — eat smart, race fast

A daily food-pyramid racing game. One new stage and cuisine per day (same for the whole world, like Wordle). Grab **GO foods** 🥗 to shrink down and boost; dodge **WHOA foods** 🍟 or your face puffs up and squeezing through gaps gets hard. Race against your own ghosts, the world-record ghost, and everyone playing **live right now**.

## Quick start

1. Install Node.js (v18+) from https://nodejs.org
2. In this folder:
   ```
   npm install
   npm start
   ```
3. Open `http://localhost:3000` — everyone who opens the same URL races today's stage together, live.

To let the whole world play, deploy this folder to any Node host (Railway, Render, Fly.io, a VPS). It listens on `process.env.PORT`, so most platforms need zero config. The daily leaderboard persists in `leaderboard.json` (last 7 days kept).

## How it works

- **Daily stage**: track layout, food placement and cuisine (Asian 🥢 / American 🍔 / Indian 🍛 / Italian 🍝 / French 🥐) are generated from the UTC date — identical for every player, everywhere.
- **Rolling start**: no countdown. Drive over the START line and the clock begins.
- **The pyramid mechanic**: every WHOA food you touch makes your face one size bigger — slower turning, slightly slower top speed, bigger hitbox. GO foods shrink you back one size and give a speed boost. Every food shows a real one-line nutrition fact when eaten.
- **Live racers**: other players currently on the stage appear on your track and minimap in real time (positions relayed ~7×/sec — a few bytes each, so hundreds of players are fine).
- **Ghosts**: your PB + last attempts (saved on your device) and the world-record ghost (from the server), toggleable.
- **Leaderboard**: one global board per day, best time per name, live finish ticker.
- Extras: paint-your-own face editor (pixel paint, 8 colors), split-time deltas at checkpoints, medals (🥇 64s / 🥈 74s / 🥉 90s), Wordle-style share button, daily streak, next-stage countdown.

## Controls

Hold the left/right sides of the screen (or arrow keys / A–D). Your face rolls forward automatically.

## Project layout

```
server.js           live position relay + daily leaderboard (persisted to leaderboard.json)
public/index.html   the whole game: track generator, physics, ghosts, minimap, UI
```

## Notes

- The anti-cheat is basic (impossible times are rejected server-side); for a public competitive deployment you'd want stronger validation.
- Tracks are stress-tested: the generator guarantees no overlapping roads and a finishable stage every day.

## Food fact sources

The GO/WHOA framing and in-game nutrition facts are simplified from: NIH "We Can!" GO-SLOW-WHOA foods (nhlbi.nih.gov/health/educational/wecan), the WHO healthy diet fact sheet (who.int), USDA MyPlate (myplate.gov), and Harvard's Nutrition Source (nutritionsource.hsph.harvard.edu). The game is for fun and learning, not medical or dietary advice — WHOA foods are "sometimes" foods, not forbidden ones.
