/*  FOOD PYRAMID RALLY — live server
    Everyone races the same daily stage on their own device.
    The server: broadcasts live racer positions, runs the shared service-park
    start queue, keeps the global daily leaderboard, awards monthly
    championship points to signed-in drivers, and relays pace notes to
    co-drivers. */

const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const QRCode = require('qrcode');
const auth = require('./auth');
const ai = require('./ai');
const clipEngine = require('./public/clip.js');
const stageGen = require('./public/stage.js');

const PORT = process.env.PORT || 3000;
const LB_FILE = path.join(__dirname, 'leaderboard.json');

// ---------- accounts (optional: set GOOGLE_CLIENT_ID to switch on) ----------
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const SESSION_SECRET = process.env.SESSION_SECRET ||
  (GOOGLE_CLIENT_ID
    ? crypto.createHash('sha256')
        .update(GOOGLE_CLIENT_ID + '|' + (process.env.GIST_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || 'pyramid'))
        .digest('hex')
    : crypto.randomBytes(32).toString('hex'));
auth.configure({ clientId: GOOGLE_CLIENT_ID, sessionSecret: SESSION_SECRET });

// public, non-reversible id so a client can spot itself on a board without
// the Google subject id ever leaving the server
function pubId(sub) {
  return crypto.createHmac('sha256', SESSION_SECRET).update('pub:' + sub).digest('hex').slice(0, 10);
}

// ---------- stage identity ----------
// The browser seeds each day from SHA-256('pyramid-' + date) and picks the
// CUISINE_NAMES must stay in the same order as CUISINES in public/index.html
// (a test compares the two).
const CUISINE_NAMES = ['AMERICAN 🍔','INDIAN 🍛','ITALIAN 🍝','FRENCH 🥐','JAPANESE 🍱','CHINESE 🥡',
  'KOREAN 🍲','THAI 🌶️','VIETNAMESE 🍜','MEXICAN 🌮','GREEK 🥙','SPANISH 🥘','GERMAN 🥨','POLISH 🥟',
  'TURKISH 🧆','LEBANESE 🫓','MOROCCAN 🍲','CARIBBEAN 🥥','BRAZILIAN 🍖','BRITISH 🫖'];
const STAGE_EPOCH = Date.UTC(2026, 0, 1);
function seedWords(date) {
  const h = crypto.createHash('sha256').update('pyramid-' + date, 'utf8').digest();
  const w = [];
  for (let i = 0; i < 8; i++) w.push(h.readUInt32BE(i * 4));
  return w;
}
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
// The fastest a stage can physically be driven: its length at top speed with
// the boost held down the whole way. Anything quicker did not go round the
// track. Derived per stage rather than hardcoded, so it follows the generator.
const MAX_SPD = 430, BOOST = 1.5;
// must match STRICT_FROM in public/index.html
const STRICT_FROM = '2026-07-22';
const floorCache = new Map();
// The shortest line a car could legally drive — not the centreline, which
// nobody drives. Start on the centreline and repeatedly pull each point toward
// the straight line between its neighbours, clamped to stay on the road: the
// string goes taut through the corridor. On a twisty stage that is 10-17%
// shorter than the centreline, and a floor built on the centreline would have
// rejected a genuinely brilliant run.
function shortestLegalLine(t) {
  const a = t.START_I, b = t.FINISH_I;
  const p = [];
  for (let i = a; i <= b; i++) p.push([t.pts[i][0], t.pts[i][1]]);
  for (let k = 0; k < 400; k++) {
    for (let i = 1; i < p.length - 1; i++) {
      const tx = (p[i - 1][0] + p[i + 1][0]) / 2, ty = (p[i - 1][1] + p[i + 1][1]) / 2;
      let nx = p[i][0] + (tx - p[i][0]) * 0.5, ny = p[i][1] + (ty - p[i][1]) * 0.5;
      const ci = a + i, cx = t.pts[ci][0], cy = t.pts[ci][1], lim = t.widths[ci] * 0.92;
      const dx = nx - cx, dy = ny - cy, d = Math.hypot(dx, dy);
      if (d > lim) { nx = cx + dx / d * lim; ny = cy + dy / d * lim; }
      p[i][0] = nx; p[i][1] = ny;
    }
  }
  let len = 0;
  for (let i = 0; i < p.length - 1; i++) len += Math.hypot(p[i + 1][0] - p[i][0], p[i + 1][1] - p[i][1]);
  return len;
}

// Before strict rules, the GAME let you skip sections: driving off course put
// you back on the nearest centreline point, which could be ahead of where you
// left. Times set that way are the game's doing, not the driver's, and they
// count. Only obvious nonsense is refused on those days.
const LEGACY_FLOOR_MS = 5000;
function minPlausibleMs(date) {
  let v = floorCache.get(date);
  if (v !== undefined) return v;
  if (date < STRICT_FROM) {
    v = LEGACY_FLOOR_MS;
  } else {
    try {
      v = Math.round((shortestLegalLine(stageGen.buildStage(date)) / (MAX_SPD * BOOST)) * 1000 * 0.95);
    } catch (e) {
      v = 15000;
    }
  }
  if (floorCache.size > 60) floorCache.clear();
  floorCache.set(date, v);
  return v;
}

function stageInfo(date) {
  const sw = seedWords(date);
  const no = Math.floor((Date.parse(date + 'T00:00:00Z') - STAGE_EPOCH) / 86400000) + 1;
  const cuisine = CUISINE_NAMES[Math.floor(mulberry32(sw[1])() * CUISINE_NAMES.length)];
  return { date, no, cuisine, label: `SS #${no} · ${cuisine}` };
}

// ---------- persistent storage ----------
// The board is just a small JSON blob — the problem is that Render's free tier
// wipes local disk on every sleep/redeploy, so we mirror it somewhere durable.
//   1. GitHub Gist  — GIST_ID + GIST_TOKEN   (simplest: it IS a text file)
//   2. Upstash Redis — UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN
//   3. Local file only (default) — resets whenever the instance restarts
const KV_URL = process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const GIST_ID = process.env.GIST_ID;
const GIST_TOKEN = process.env.GIST_TOKEN;
const storageMode = (GIST_ID && GIST_TOKEN) ? 'gist'
                  : (KV_URL && KV_TOKEN) ? 'upstash' : 'file';

async function loadRemote() {
  try {
    if (storageMode === 'upstash') {
      const r = await fetch(`${KV_URL}/get/pr-boards`, {
        headers: { Authorization: `Bearer ${KV_TOKEN}` } });
      const j = await r.json();
      return j && j.result ? JSON.parse(j.result) : null;
    }
    if (storageMode === 'gist') {
      const r = await fetch(`https://api.github.com/gists/${GIST_ID}`, {
        headers: { Authorization: `Bearer ${GIST_TOKEN}`, 'User-Agent': 'pyramid-rally' } });
      const j = await r.json();
      const f = j.files && j.files['leaderboard.json'];
      if (!f) return null;
      const txt = f.truncated ? await (await fetch(f.raw_url)).text() : f.content;
      return JSON.parse(txt);
    }
  } catch {}
  return null;
}
let saveRemoteBusy = false, saveRemoteAgain = false;
async function saveRemote() {
  if (storageMode === 'file') return;
  if (saveRemoteBusy) { saveRemoteAgain = true; return; } // never overlap writes
  saveRemoteBusy = true;
  try {
    const body = JSON.stringify(store);
    if (storageMode === 'upstash') {
      await fetch(`${KV_URL}/set/pr-boards`, { method: 'POST',
        headers: { Authorization: `Bearer ${KV_TOKEN}` }, body: JSON.stringify(body) });
    } else {
      await fetch(`https://api.github.com/gists/${GIST_ID}`, { method: 'PATCH',
        headers: { Authorization: `Bearer ${GIST_TOKEN}`, 'User-Agent': 'pyramid-rally',
          'Content-Type': 'application/json' },
        body: JSON.stringify({ files: { 'leaderboard.json': { content: body } } }) });
    }
  } catch {}
  saveRemoteBusy = false;
  if (saveRemoteAgain) { saveRemoteAgain = false; saveRemote(); }
}

// store = { boards: {date: [entry]}, users: {sub: {name, joined}}, months: {'YYYY-MM': [standing]} }
// entry = { n: name, t: ms, p?: ghost path, f?: face, u?: google sub }
let store = { boards: {}, users: {}, months: {}, ai: {} };
function adoptStore(raw) {
  if (!raw || typeof raw !== 'object') return;
  if (raw.boards && typeof raw.boards === 'object') {
    store.boards = raw.boards;
    store.users = raw.users || {};
    store.months = raw.months || {};
    store.ai = raw.ai || {};
  } else {
    store.boards = raw; // migrate the old shape (bare date → entries map)
  }
}
try { adoptStore(JSON.parse(fs.readFileSync(LB_FILE, 'utf8'))); } catch {}

function today() { return new Date().toISOString().slice(0, 10); }
function thisMonth() { return today().slice(0, 7); }
function board() { return (store.boards[today()] = store.boards[today()] || []); }

const KEEP_DAYS = 40; // enough to always recompute the current month from source
const CLIP_KEEP = 14;  // recorded lines kept per stage, so the reel can be cast
const CLIP_DAYS = 7;   // ...but only for recent stages: lines are the bulk of the store

let saveTimer = null;
function saveBoards() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const keys = Object.keys(store.boards).sort().slice(-KEEP_DAYS);
    const slim = {};
    for (const k of keys) slim[k] = store.boards[k];
    store.boards = slim;
    // recorded lines dominate the size of the store, so only recent stages keep
    // them; older days still have their full results, just no reel
    const clipCutoff = keys.slice(-CLIP_DAYS)[0];
    for (const k of keys) {
      if (clipCutoff && k < clipCutoff) {
        for (const e of store.boards[k]) if (e.p) delete e.p;
      }
    }
    for (const ym of monthsInBoards()) store.months[ym] = computeMonth(ym);
    fs.writeFile(LB_FILE, JSON.stringify(store), () => {});
    saveRemote();
  }, 500);
}

// ---------- monthly championship ----------
// Points by OVERALL finishing position on each daily stage. The curve is
// deliberately steep at the sharp end — a flat 100..1 ladder made winning
// worth barely more than second, and on a quiet day everyone went home with
// ~100. A hand-set top ten (rally/F1 shaped) decays geometrically to a single
// point at 100th, so a win is worth roughly four top-ten finishes.
// Only signed-in drivers bank points; anonymous racers still occupy their
// position, and so consume that position's points.
const POINTS = (() => {
  const head = [100, 80, 65, 55, 47, 40, 34, 29, 25, 22];
  const table = [];
  for (let r = 1; r <= 100; r++) {
    table.push(r <= head.length
      ? head[r - 1]
      : Math.max(1, Math.round(22 * Math.pow(1 / 22, (r - 10) / 90))));
  }
  return table;
})();
function monthsInBoards() {
  const s = new Set();
  for (const d of Object.keys(store.boards)) s.add(d.slice(0, 7));
  return [...s];
}
function computeMonth(ym) {
  const totals = new Map();
  const lastSeenName = new Map(); // uid -> name from their most recent entry
  for (const date of Object.keys(store.boards).sort()) {
    if (!date.startsWith(ym)) continue;
    const entries = store.boards[date];
    if (!Array.isArray(entries)) continue;
    const n = Math.min(entries.length, 100);
    for (let i = 0; i < n; i++) {
      const e = entries[i];
      if (!e || !e.u) continue; // anonymous: position burned, no points
      const rec = totals.get(e.u) || { pts: 0, days: 0, best: 999, wins: 0 };
      rec.pts += POINTS[i];
      rec.days++;
      rec.best = Math.min(rec.best, i + 1);
      if (i === 0) rec.wins++;
      totals.set(e.u, rec);
      if (e.n) lastSeenName.set(e.u, e.n);
    }
  }
  return [...totals.entries()]
    .map(([sub, r]) => ({
      id: pubId(sub),
      n: (store.users[sub] && store.users[sub].name) || lastSeenName.get(sub) || 'RACER',
      pts: r.pts, days: r.days, best: r.best, wins: r.wins,
    }))
    .sort((a, b) => b.pts - a.pts || a.best - b.best || b.days - a.days)
    .slice(0, 100);
}
function monthStandings(ym) {
  // recompute from daily boards when we still have them, else the archive
  return monthsInBoards().includes(ym) ? computeMonth(ym) : (store.months[ym] || []);
}
function availableMonths() {
  const s = new Set([...monthsInBoards(), ...Object.keys(store.months || {})]);
  return [...s].sort().reverse();
}
// what a given position on today's board is worth
function pointsForRank(rank) { return rank >= 1 && rank <= POINTS.length ? POINTS[rank - 1] : 0; }

function publicBoard() {
  return board().slice(0, 100).map(e => ({
    n: e.n, t: e.t, f: e.f,
    a: e.u ? 1 : 0,              // signed-in? (earns points) — never expose the sub
    id: e.u ? pubId(e.u) : undefined,
  }));
}
function worldGhost() {
  const b = board();
  return b.length && b[0].p ? { n: b[0].n, t: b[0].t, p: b[0].p } : null;
}

// on boot, restore from remote storage in case the local disk was wiped
(async () => {
  const remote = await loadRemote();
  if (remote) {
    const before = Object.keys(store.boards).length;
    const incoming = remote.boards || remote;
    for (const day of Object.keys(incoming)) {
      if (!store.boards[day] || store.boards[day].length < incoming[day].length) {
        store.boards[day] = incoming[day];
      }
    }
    if (remote.users) store.users = Object.assign(remote.users, store.users);
    if (remote.months) store.months = Object.assign({}, remote.months, store.months);
    console.log(`  Restored ${Object.keys(store.boards).length - before} day(s) from ${storageMode}`);
  }
})();



const SITE_URL = (process.env.SITE_URL || '').replace(/\/$/, '');

const app = express();
app.use(express.json({ limit: '16kb' }));

// Pages carry %SITE_URL% placeholders for their link-preview tags. Crawlers
// don't run scripts, so these have to be absolute and correct in the HTML —
// resolve them per request from the host actually being used, which means a
// custom domain works the moment it is pointed here, with nothing to update.
const pageCache = new Map();
function servePage(file) {
  return (req, res) => {
    const origin = SITE_URL || (req.protocol + '://' + req.get('host'));
    const key = file + '|' + origin;
    let body = pageCache.get(key);
    if (!body) {
      body = fs.readFileSync(path.join(__dirname, 'public', file), 'utf8')
               .split('%SITE_URL%').join(origin);
      pageCache.set(key, body);
    }
    res.type('html').send(body);
  };
}
app.get('/', servePage('index.html'));
app.get('/index.html', servePage('index.html'));
app.get('/codriver', servePage('codriver.html'));
app.get('/day', (req, res) => {
  const d = String(req.query.d || '');
  const label = /^\d{4}-\d{2}-\d{2}$/.test(d) ? stageInfo(d).label + ' · ' + d : 'stage results';
  const origin = SITE_URL || (req.protocol + '://' + req.get('host'));
  const body = fs.readFileSync(path.join(__dirname, 'public', 'day.html'), 'utf8')
                 .split('%SITE_URL%').join(origin)
                 .split('%STAGE%').join(label);
  res.type('html').send(body);
});
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/config', (req, res) => {
  // commentary reports WHETHER a key is set, never the key itself, so a
  // deploy can be checked from a browser
  res.json({ google: GOOGLE_CLIENT_ID || null, storage: storageMode, points: POINTS,
             commentary: ai.enabled() ? 'ai' : 'built-in',
             commentaryModel: ai.enabled() ? ai.MODEL : null });
});

// exchange a Google ID token for one of our sessions
const loginHits = new Map();
app.post('/api/login', async (req, res) => {
  if (!auth.enabled()) return res.status(503).json({ error: 'accounts are not enabled on this server' });
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '?';
  const now = Date.now();
  const hits = (loginHits.get(ip) || []).filter(t => now - t < 60e3);
  if (hits.length >= 20) return res.status(429).json({ error: 'too many attempts, wait a minute' });
  hits.push(now); loginHits.set(ip, hits);

  try {
    const { sub, name } = await auth.verifyIdToken(req.body && req.body.credential);
    const u = store.users[sub] || (store.users[sub] = { name: '', joined: today() });
    if (!u.name) { u.name = sanitizeName(name || 'RACER'); saveBoards(); }
    res.json({ session: auth.makeSession(sub), name: u.name, id: pubId(sub) });
  } catch (e) {
    res.status(401).json({ error: 'sign-in could not be verified' });
  }
});

app.get('/api/day', (req, res) => {
  const d = String(req.query.d || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return res.status(400).json({ error: 'bad date' });
  const withClips = req.query.clips === '1';
  if (withClips) ensureCommentary(d);
  const raw = store.boards[d] || [];
  const entries = raw.map((e, i) => ({
    n: e.n, t: e.t, f: e.f,
    a: e.u ? 1 : 0,
    pts: e.u ? (POINTS[i] || 0) : 0,
    would: POINTS[i] || 0,
    p: withClips && e.p ? e.p : undefined,   // only when a reel is being built
  }));
  const days = Object.keys(store.boards).filter(k => (store.boards[k] || []).length).sort();
  res.json({ date: d, today: today(), entries, total: entries.length, days,
             reel: withClips ? reelPayload(d) : undefined });
});

app.get('/api/monthly', (req, res) => {
  const ym = /^\d{4}-\d{2}$/.test(String(req.query.m || '')) ? req.query.m : thisMonth();
  res.json({ month: ym, months: availableMonths(), standings: monthStandings(ym) });
});

// last 5 daily leaderboards (top 3 each)
app.get('/api/history', (req, res) => {
  const days = [];
  for (let d = 1; d <= 5; d++) {
    const ds = new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);
    const e = store.boards[ds] || [];
    days.push({ date: ds, top: e.slice(0, 3).map(x => ({ n: x.n, t: x.t })), total: e.length });
  }
  res.json({ days, storage: storageMode });
});

app.get('/api/qr', async (req, res) => {
  try {
    const data = String(req.query.data || '').slice(0, 500);
    const url = await QRCode.toDataURL(data, { margin: 1, width: 440,
      color: { dark: '#1c7a35', light: '#ffffff' } });
    res.json({ url });
  } catch (e) { res.status(400).json({ error: 'bad qr data' }); }
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// ---------- clients & live positions ----------
let nextId = 1;
const clients = new Map();
const crewIndex = new Map();
function makeCrewCode() {
  const A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let c;
  do { c = Array.from({ length: 4 }, () => A[Math.floor(Math.random() * A.length)]).join(''); }
  while (crewIndex.has(c));
  return c;
}

function send(ws, obj) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); }
function broadcast(obj, exceptId) {
  const raw = JSON.stringify(obj);
  for (const [id, c] of clients) {
    if (id !== exceptId && c.ws.readyState === 1) c.ws.send(raw);
  }
}

function sanitizeName(n) {
  return String(n || 'RACER').toUpperCase().replace(/[^A-Z0-9 !?.-]/g, '').slice(0, 20) || 'RACER';
}
function sanitizeFace(f) {
  const COLORS = ['#ffd23f', '#ff8c2e', '#7ddb6a', '#5bd1ff', '#ff7bac', '#c9a2ff', '#f5f2e8', '#ffb35c'];
  f = f || {};
  const paint = typeof f.paint === 'string' && /^[0-8]{0,324}$/.test(f.paint) ? f.paint : '';
  return { color: COLORS.includes(f.color) ? f.color : COLORS[0], paint };
}

// ---------- the daily highlight reel ----------
// Cast on the SERVER so every viewer sees the same reel, and so the commentary
// can be written once for the day rather than once per viewer. The casting and
// scoring in public/clip.js are plain functions with no DOM, so they run here
// unchanged — browser and server cannot disagree about the reel.
const REEL_CAST = 6, REEL_SECONDS = 4.6;

function castFor(date) {
  const board = store.boards[date] || [];
  if (!board.length) return null;
  let stage;
  try { stage = stageGen.buildStage(date); } catch (e) { return null; }
  const entries = board.map((e, i) => ({
    name: e.n, time: (e.t / 1000).toFixed(2) + 's', face: e.f, path: e.p,
    rank: i + 1, isLast: i === board.length - 1,
  }));
  const cast = clipEngine.buildCast(entries, stage, { dtMs: 150, seconds: REEL_SECONDS, cast: REEL_CAST });
  if (!cast || !cast.length) return null;
  return { stage, cast };
}

function reelPayload(date) {
  const built = castFor(date);
  if (!built) return null;
  const cached = store.ai[date];
  return {
    cast: built.cast.map(c => ({
      rank: c.entry.rank, start: c.start, end: c.end, badge: c.badge, kind: c.kind,
    })),
    lines: (cached && cached.lines) || null,
    ai: !!(cached && cached.lines),
  };
}

// Written once, for a stage that has closed and can no longer change. Runs in
// the background: a reel must never wait on an API call, and must still appear
// if the call never succeeds.
const aiPending = new Set();
function ensureCommentary(date) {
  if (!ai.enabled() || date >= today() || store.ai[date] || aiPending.has(date)) return;
  const built = castFor(date);
  if (!built) return;
  aiPending.add(date);
  const info = stageInfo(date);
  const segments = built.cast.map(c => ({
    name: c.entry.name, rank: c.entry.rank, time: c.entry.time,
    isLast: c.entry.isLast, kind: c.kind, start: c.start, end: c.end, dtMs: 150,
  }));
  ai.writeCommentary(info.label, info.cuisine, segments)
    .then(lines => {
      aiPending.delete(date);
      if (!lines) return;
      store.ai[date] = { lines, at: Date.now() };
      const keys = Object.keys(store.ai).sort();
      while (keys.length > 20) delete store.ai[keys.shift()];
      saveBoards();
      console.log('  AI commentary written for ' + date);
    })
    .catch(() => aiPending.delete(date));
}

// ---------- the service-park start queue ----------
const marshal = { queue: [], pending: null, lastCrossT: 0 };
function queueSnapshot() {
  return { t: 'queue', order: marshal.queue.map(c => c.id), pending: marshal.pending ? marshal.pending.id : null };
}
function broadcastQueue() { broadcast(queueSnapshot()); }

// Who is watching rather than driving. Sent on change rather than with every
// live tick — it changes rarely and the live packet runs seven times a second.
function watcherSnapshot() {
  const l = [];
  for (const [id, c] of clients) if (c.spectating) l.push({ id, n: c.name });
  return { t: 'watchers', l };
}
function broadcastWatchers() { broadcast(watcherSnapshot()); }
function removeFromQueue(c) {
  const before = marshal.queue.length;
  marshal.queue = marshal.queue.filter(e => e !== c);
  if (marshal.pending === c) marshal.pending = null;
  return before !== marshal.queue.length;
}
setInterval(() => {
  if (!marshal.pending && marshal.queue.length && Date.now() - marshal.lastCrossT >= 3000) {
    const c = marshal.queue[0];
    if (Date.now() - (c.queueJoinT || 0) < 900) return;
    marshal.queue.shift();
    marshal.pending = c;
    send(c.ws, { t: 'release' });
    broadcastQueue();
  }
}, 250);

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  let myId = null;

  ws.on('message', (raw) => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (typeof m !== 'object' || !m) return;

    if (m.t === 'hello') {
      myId = nextId++;
      const sess = m.session ? auth.readSession(m.session) : null;
      const uid = sess ? sess.sub : null;
      if (uid && !store.users[uid]) store.users[uid] = { name: sanitizeName(m.name), joined: today() };
      const c = {
        ws, id: myId, uid,
        name: uid ? store.users[uid].name : sanitizeName(m.name),
        face: sanitizeFace(m.face), live: null,
        crewCode: makeCrewCode(), watchers: new Set(), queueJoinT: 0, spectating: false,
      };
      clients.set(myId, c);
      crewIndex.set(c.crewCode, c);
      send(ws, {
        t: 'welcome', id: myId, date: today(),
        lb: publicBoard(), ghost: worldGhost(),
        racing: liveCount(), crew: c.crewCode,
        storage: storageMode,
        auth: auth.enabled(),
        signedIn: !!uid, name: c.name, myPubId: uid ? pubId(uid) : null,
        month: thisMonth(), standings: monthStandings(thisMonth()).slice(0, 20),
      });
      broadcast({ t: 'roster', id: myId, n: c.name, face: c.face }, myId);
      for (const [id, o] of clients) if (id !== myId) send(ws, { t: 'roster', id, n: o.name, face: o.face });
      send(ws, queueSnapshot());
      send(ws, watcherSnapshot());
      return;
    }
    if (m.t === 'watch') {
      const target = crewIndex.get(String(m.code || '').toUpperCase().trim());
      if (!target) { send(ws, { t: 'watch_error', reason: 'Crew code not found — is the driver online?' }); return; }
      ws.role = 'watcher';
      if (ws.watching) ws.watching.watchers.delete(ws);
      ws.watching = target;
      target.watchers.add(ws);
      send(ws, { t: 'drv_info', n: target.name, face: target.face });
      return;
    }

    const c = clients.get(myId);
    if (!c) return;

    if (m.t === 'rename') {
      c.name = sanitizeName(m.name);
      c.face = sanitizeFace(m.face);
      if (c.uid && store.users[c.uid]) { store.users[c.uid].name = c.name; saveBoards(); }
      broadcast({ t: 'roster', id: myId, n: c.name, face: c.face }, myId);
      for (const w of c.watchers) send(w, { t: 'drv_info', n: c.name, face: c.face });
      return;
    }
    if (m.t === 'spectate') {
      const c = clients.get(myId);
      if (!c) return;
      const on = !!m.on;
      if (c.spectating !== on) { c.spectating = on; broadcastWatchers(); }
      return;
    }

    if (m.t === 'queue_join') {
      if (!marshal.queue.includes(c) && marshal.pending !== c) {
        c.queueJoinT = Date.now();
        marshal.queue.push(c);
        broadcastQueue();
      }
      return;
    }
    if (m.t === 'queue_leave') { if (removeFromQueue(c)) broadcastQueue(); return; }
    if (m.t === 'crossed') {
      if (marshal.pending === c) { marshal.pending = null; marshal.lastCrossT = Date.now(); broadcastQueue(); }
      return;
    }
    if (m.t === 'pos') {
      const x = Number(m.x), y = Number(m.y), sz = Number(m.sz);
      if (Number.isFinite(x) && Number.isFinite(y)) {
        c.live = { x: Math.round(x), y: Math.round(y), sz: Math.min(4, Math.max(0, sz | 0)) };
        for (const w of c.watchers) send(w, { t: 'drv', x: c.live.x, y: c.live.y, sz: c.live.sz });
      }
      return;
    }
    if (m.t === 'run_end') {
      c.live = null;
      if (removeFromQueue(c)) broadcastQueue();
      for (const w of c.watchers) send(w, { t: 'drv_end' });
      return;
    }

    if (m.t === 'finish') {
      c.live = null;
      if (removeFromQueue(c)) broadcastQueue();
      for (const w of c.watchers) send(w, { t: 'drv_end' });
      // A run counts only for the stage it was actually driven on. Someone who
      // starts before midnight UTC and crosses the line after it has finished
      // yesterday's stage, which must not land on today's board.
      if (m.date && m.date !== today()) {
        send(ws, { t: 'finish_stale', stage: m.date, today: today() });
        return;
      }
      // Reject the impossible — but SAY SO. Dropping it silently made the
      // leaderboard look broken to the one person it happened to.
      const t = Math.round(Number(m.time));
      const floorMs = minPlausibleMs(today());
      if (!Number.isFinite(t)) {
        send(ws, { t: 'finish_rejected', why: 'That time could not be read.' });
        return;
      }
      if (t < floorMs) {
        send(ws, { t: 'finish_rejected',
                   why: `${(t / 1000).toFixed(2)}s is faster than this stage can physically be driven ` +
                        `(${(floorMs / 1000).toFixed(1)}s flat out with boost). Time not recorded.` });
        return;
      }
      if (t > 120000) {
        send(ws, { t: 'finish_rejected', why: 'Over two minutes — time not recorded.' });
        return;
      }
      const p = Array.isArray(m.path) && m.path.length <= 3000 ? m.path.map(v => Math.round(Number(v)) || 0) : null;
      const b = board();
      // signed-in drivers are keyed by account, anonymous ones by name — so
      // nobody can overwrite an account holder's time by typing their name
      const mine = c.uid ? b.find(e => e.u === c.uid) : b.find(e => !e.u && e.n === c.name);
      let improved = false;
      if (!mine) {
        b.push({ n: c.name, t, p, f: { color: c.face.color, paint: c.face.paint }, u: c.uid || undefined });
        improved = true;
      } else if (t < mine.t) {
        mine.t = t; mine.p = p; mine.n = c.name;
        mine.f = { color: c.face.color, paint: c.face.paint };
        improved = true;
      }
      b.sort((a, x) => a.t - x.t);
      b.splice(100);
      b.forEach((e, i) => { if (i >= CLIP_KEEP && i !== b.length - 1) delete e.p; });
      saveBoards();
      const rank = (c.uid ? b.findIndex(e => e.u === c.uid) : b.findIndex(e => !e.u && e.n === c.name)) + 1;
      send(ws, {
        t: 'finish_ack', rank, total: b.length, lb: publicBoard(), ghost: worldGhost(),
        points: c.uid ? pointsForRank(rank) : 0,
        signedIn: !!c.uid,
        month: thisMonth(),
        standings: monthStandings(thisMonth()).slice(0, 20),
      });
      if (improved) {
        broadcast({ t: 'event', msg: `🏁 ${c.name} — ${(t / 1000).toFixed(2)}s (#${rank})` }, myId);
        broadcast({ t: 'lb', lb: publicBoard() }, myId);
      }
      return;
    }
  });

  ws.on('close', () => {
    if (ws.role === 'watcher' && ws.watching) ws.watching.watchers.delete(ws);
    if (myId != null) {
      const c = clients.get(myId);
      if (c) {
        if (removeFromQueue(c)) broadcastQueue();
        for (const w of c.watchers) send(w, { t: 'drv_gone' });
        crewIndex.delete(c.crewCode);
      }
      const wasSpectating = c && c.spectating;
      clients.delete(myId);
      broadcast({ t: 'bye', id: myId });
      if (wasSpectating) broadcastWatchers();
    }
  });
});

function liveCount() {
  let n = 0;
  for (const c of clients.values()) if (c.live) n++;
  return n;
}

setInterval(() => {
  const list = [];
  for (const [id, c] of clients) if (c.live) list.push([id, c.live.x, c.live.y, c.live.sz]);
  // s: when this snapshot was taken. Clients place positions on THIS timeline
  // rather than on arrival time, so network jitter doesn't become visible
  // wobble in how the cars move.
  if (clients.size) broadcast({ t: 'live', l: list, racing: list.length, s: Date.now() });
}, 140);

setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false; ws.ping();
  });
}, 15000);

server.listen(PORT, () => {
  console.log('');
  console.log('  🍏 FOOD PYRAMID RALLY server running!');
  console.log(`  Play at:  http://localhost:${PORT}`);
  console.log(`  Leaderboard storage: ${storageMode === 'file' ? 'local file (resets on redeploy — see README)' : storageMode + ' (persistent)'}`);
  console.log(`  Accounts: ${auth.enabled() ? 'Google Sign-In enabled' : 'disabled (set GOOGLE_CLIENT_ID to enable)'}`);
  console.log(`  Commentary: ${ai.enabled() ? 'AI (' + ai.MODEL + ')' : 'built-in (set ANTHROPIC_API_KEY for AI)'}`);
  console.log('');
});

module.exports = { computeMonth, pointsForRank, store, adoptStore, POINTS, stageInfo, CUISINE_NAMES };
