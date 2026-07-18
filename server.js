/*  PYRAMID RALLY — live server
    Everyone races the same daily stage on their own device.
    The server: broadcasts live racer positions, runs the shared service-park
    start queue, keeps the global daily leaderboard, and shares the world
    ghost + pace notes link for co-drivers. */

const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { WebSocketServer } = require('ws');
const QRCode = require('qrcode');

const PORT = process.env.PORT || 3000;
const LB_FILE = path.join(__dirname, 'leaderboard.json');

// ---------- persistent leaderboard storage ----------
// The board is just a small JSON file — the problem is that Render's free
// tier wipes the local disk on every sleep/redeploy. So we optionally mirror
// that file somewhere that survives. Three backends, picked automatically:
//   1. GitHub Gist  — set GIST_ID + GIST_TOKEN   (simplest: it IS a txt file,
//                     living in a gist you own; token needs only "gist" scope)
//   2. Upstash Redis — set UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN
//   3. Local file only (default) — resets whenever the free instance restarts
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
    const body = JSON.stringify(boards);
    if (storageMode === 'upstash') {
      await fetch(`${KV_URL}/set/pr-boards`, { method: 'POST',
        headers: { Authorization: `Bearer ${KV_TOKEN}` },
        body: JSON.stringify(body) });
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
app.get('/api/history', async (req, res) => {
  const days = [];
  for (let d = 1; d <= 5; d++) {
    const ds = new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);
    const e = boards[ds] || [];
    days.push({ date: ds, top: e.slice(0, 3).map(x => ({ n: x.n, t: x.t })), total: e.length });
  }
  res.json({ days, storage: storageMode });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// ---------- daily leaderboard ----------
let boards = {}; // { 'YYYY-MM-DD': [{n, t, p?}] }  p = ghost path for top 3 only
try { boards = JSON.parse(fs.readFileSync(LB_FILE, 'utf8')); } catch {}
let saveTimer = null;
function saveBoards() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const keys = Object.keys(boards).sort().slice(-7);
    const slim = {};
    for (const k of keys) slim[k] = boards[k];
    boards = slim;
    fs.writeFile(LB_FILE, JSON.stringify(boards), () => {});
    saveRemote(); // mirror the file somewhere that survives disk wipes
  }, 500);
}
function today() { return new Date().toISOString().slice(0, 10); }
function board() { return (boards[today()] = boards[today()] || []); }

function publicBoard() {
  return board().slice(0, 100).map(e => ({ n: e.n, t: e.t, f: e.f }));
}
function worldGhost() {
  const b = board();
  return b.length && b[0].p ? { n: b[0].n, t: b[0].t, p: b[0].p } : null;
}

// on boot, restore from remote storage in case the local disk was wiped
(async () => {
  const remote = await loadRemote();
  if (!remote) return;
  for (const day of Object.keys(remote)) {
    if (!boards[day] || boards[day].length < remote[day].length) boards[day] = remote[day];
  }
  console.log('  Restored leaderboards from ' + storageMode + ' (' + Object.keys(remote).length + ' day(s))');
})();

// ---------- clients & live positions ----------
let nextId = 1;
const clients = new Map(); // id -> {ws, name, face, live, crewCode, watchers:Set, queueJoinT}
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

// ---------- the service-park start queue (shared by every real player) ----------
// Rally rules: everyone queues in the park. The marshal releases the next
// car 3 seconds after the previous one crosses the start line.
const marshal = { queue: [], pending: null, lastCrossT: 0 };
function queueSnapshot() {
  return { t: 'queue', order: marshal.queue.map(c => c.id), pending: marshal.pending ? marshal.pending.id : null };
}
function broadcastQueue() { broadcast(queueSnapshot()); }
function removeFromQueue(c) {
  const before = marshal.queue.length;
  marshal.queue = marshal.queue.filter(e => e !== c);
  if (marshal.pending === c) marshal.pending = null;
  return before !== marshal.queue.length;
}
setInterval(() => {
  if (!marshal.pending && marshal.queue.length && Date.now() - marshal.lastCrossT >= 3000) {
    const c = marshal.queue[0];
    if (Date.now() - (c.queueJoinT || 0) < 900) return; // minimum park dwell
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
      const c = { ws, id: myId, name: sanitizeName(m.name), face: sanitizeFace(m.face), live: null,
        crewCode: makeCrewCode(), watchers: new Set(), queueJoinT: 0 };
      clients.set(myId, c);
      crewIndex.set(c.crewCode, c);
      send(ws, {
        t: 'welcome', id: myId, date: today(),
        lb: publicBoard(), ghost: worldGhost(),
        racing: liveCount(), crew: c.crewCode,
        storage: storageMode,
      });
      broadcast({ t: 'roster', id: myId, n: c.name, face: c.face }, myId);
      for (const [id, o] of clients) if (id !== myId) send(ws, { t: 'roster', id, n: o.name, face: o.face });
      send(ws, queueSnapshot());
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
    if (m.t === 'queue_join') {
      if (!marshal.queue.includes(c) && marshal.pending !== c) {
        c.queueJoinT = Date.now();
        marshal.queue.push(c);
        broadcastQueue();
      }
      return;
    }
    if (m.t === 'queue_leave') {
      if (removeFromQueue(c)) broadcastQueue();
      return;
    }
    if (m.t === 'crossed') {
      if (marshal.pending === c) { marshal.pending = null; marshal.lastCrossT = Date.now(); broadcastQueue(); }
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
      const t = Math.round(Number(m.time));
      if (!Number.isFinite(t) || t < 20000 || t > 120000) return; // basic sanity: 20s–120s
      let p = Array.isArray(m.path) && m.path.length <= 3000 ? m.path.map(v => Math.round(Number(v)) || 0) : null;
      const b = board();
      const mine = b.find(e => e.n === c.name);
      let improved = false;
      if (!mine) { b.push({ n: c.name, t, p, f: { color: c.face.color, paint: c.face.paint } }); improved = true; }
      else if (t < mine.t) { mine.t = t; mine.p = p; mine.f = { color: c.face.color, paint: c.face.paint }; improved = true; }
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
        if (removeFromQueue(c)) broadcastQueue();
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
  console.log(`  Leaderboard storage: ${storageMode === 'file' ? 'local file (resets on redeploy — see README)' : storageMode + ' (persistent)'}`);
  console.log('');
});
