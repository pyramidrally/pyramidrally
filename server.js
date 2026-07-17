/*  PYRAMID RALLY — live server
    Everyone races the same daily stage on their own device.
    The server: broadcasts live racer positions, keeps the global daily
    leaderboard (persisted to disk), and shares the world-record ghost. */

const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { WebSocketServer } = require('ws');
const QRCode = require('qrcode');

const PORT = process.env.PORT || 3000;
const LB_FILE = path.join(__dirname, 'leaderboard.json');

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/codriver', (req, res) => res.sendFile(path.join(__dirname, 'public', 'codriver.html')));

app.get('/api/qr', async (req, res) => {
  try {
    const data = String(req.query.data || '').slice(0, 500);
    const url = await QRCode.toDataURL(data, { margin: 1, width: 440,
      color: { dark: '#1c7a35', light: '#ffffff' } });
    res.json({ url });
  } catch (e) { res.status(400).json({ error: 'bad qr data' }); }
});

// last 5 daily leaderboards (top 3 each)
app.get('/api/history', (req, res) => {
  const days = [];
  for (let d = 1; d <= 5; d++) {
    const ds = new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);
    const e = boards[ds] || [];
    days.push({ date: ds, top: e.slice(0, 3).map(x => ({ n: x.n, t: x.t })), total: e.length });
  }
  res.json({ days });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// ---------- daily leaderboard (persisted) ----------
let boards = {}; // { 'YYYY-MM-DD': [{n, t, p?}] }  p = ghost path for top 3 only
try { boards = JSON.parse(fs.readFileSync(LB_FILE, 'utf8')); } catch {}
let saveTimer = null;
function saveBoards() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    // keep only the last 7 days on disk
    const keys = Object.keys(boards).sort().slice(-7);
    const slim = {};
    for (const k of keys) slim[k] = boards[k];
    boards = slim;
    fs.writeFile(LB_FILE, JSON.stringify(boards), () => {});
  }, 500);
}
function today() { return new Date().toISOString().slice(0, 10); }
function board() { return (boards[today()] = boards[today()] || []); }

function publicBoard() {
  return board().slice(0, 100).map(e => ({ n: e.n, t: e.t }));
}
function worldGhost() {
  const b = board();
  return b.length && b[0].p ? { n: b[0].n, t: b[0].t, p: b[0].p } : null;
}

// ---------- clients & live positions ----------
let nextId = 1;
const clients = new Map(); // id -> {ws, name, face, live, crewCode, watchers:Set}
const crewIndex = new Map(); // crewCode -> client
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
  return {
    color: COLORS.includes(f.color) ? f.color : COLORS[0],
    paint,
  };
}

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  let myId = null;

  ws.on('message', (raw) => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (typeof m !== 'object' || !m) return;

    if (m.t === 'hello') {
      myId = nextId++;
      const c = { ws, name: sanitizeName(m.name), face: sanitizeFace(m.face), live: null,
        crewCode: makeCrewCode(), watchers: new Set() };
      clients.set(myId, c);
      crewIndex.set(c.crewCode, c);
      send(ws, {
        t: 'welcome', id: myId, date: today(),
        lb: publicBoard(), ghost: worldGhost(),
        racing: liveCount(), crew: c.crewCode,
      });
      broadcast({ t: 'roster', id: myId, n: c.name, face: c.face }, myId);
      // send the newcomer everyone else's roster info
      for (const [id, o] of clients) if (id !== myId) send(ws, { t: 'roster', id, n: o.name, face: o.face });
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
      broadcast({ t: 'roster', id: myId, n: c.name, face: c.face }, myId);
      for (const w of c.watchers) send(w, { t: 'drv_info', n: c.name, face: c.face });
      return;
    }
    if (m.t === 'pos') { // during a run, ~8x/sec
      const x = Number(m.x), y = Number(m.y), sz = Number(m.sz);
      if (Number.isFinite(x) && Number.isFinite(y)) {
        c.live = { x: Math.round(x), y: Math.round(y), sz: Math.min(4, Math.max(0, sz | 0)) };
        for (const w of c.watchers) send(w, { t: 'drv', x: c.live.x, y: c.live.y, sz: c.live.sz });
      }
      return;
    }
    if (m.t === 'run_end') { c.live = null; for (const w of c.watchers) send(w, { t: 'drv_end' }); return; }

    if (m.t === 'finish') {
      c.live = null;
      const t = Math.round(Number(m.time));
      if (!Number.isFinite(t) || t < 25000 || t > 120000) return; // basic sanity: 25s–120s
      let p = Array.isArray(m.path) && m.path.length <= 3000 ? m.path.map(v => Math.round(Number(v)) || 0) : null;
      const b = board();
      const mine = b.find(e => e.n === c.name);
      let improved = false;
      if (!mine) { b.push({ n: c.name, t, p }); improved = true; }
      else if (t < mine.t) { mine.t = t; mine.p = p; improved = true; }
      b.sort((a, x) => a.t - x.t);
      b.splice(100);
      b.forEach((e, i) => { if (i >= 3) delete e.p; });
      saveBoards();
      const rank = b.findIndex(e => e.n === c.name) + 1;
      send(ws, { t: 'finish_ack', rank, total: b.length, lb: publicBoard(), ghost: worldGhost() });
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
        for (const w of c.watchers) send(w, { t: 'drv_gone' });
        crewIndex.delete(c.crewCode);
      }
      clients.delete(myId);
      broadcast({ t: 'bye', id: myId });
    }
  });
});

function liveCount() {
  let n = 0;
  for (const c of clients.values()) if (c.live) n++;
  return n;
}

// broadcast live positions 7x/sec: [id, x, y, size] for every active runner
setInterval(() => {
  const list = [];
  for (const [id, c] of clients) if (c.live) list.push([id, c.live.x, c.live.y, c.live.sz]);
  if (clients.size) broadcast({ t: 'live', l: list, racing: list.length });
}, 140);

// heartbeat
setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false; ws.ping();
  });
}, 15000);

server.listen(PORT, () => {
  console.log('');
  console.log('  🍏 PYRAMID RALLY server running!');
  console.log(`  Play at:  http://localhost:${PORT}`);
  console.log('  Everyone who opens this URL races today\'s stage together — live.');
  console.log('');
});
