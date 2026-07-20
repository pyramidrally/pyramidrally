/*  clip.js — turns a recorded run into a short shareable animation.

    Three independent pieces:
      pickHighlight()  scores the run and returns the best few seconds
      renderClip()     replays that window onto a canvas, frame by frame
      encodeGif()      writes those frames as a GIF89a, no dependencies

    The scoring and the encoder are pure functions with no DOM, so they can be
    tested outside a browser. Only renderClip() needs a canvas.

    Everything works from the same [x, y, idx] path the game already records for
    ghosts, which means a run stored on the leaderboard can be replayed later —
    that is what the daily FPRC reel is built from.  */

(function (root) {
  'use strict';

  // ============================================================ highlights ==
  // What makes a few seconds worth watching: going fast, actually turning while
  // going fast, and eating. Sitting on a straight at top speed is not a
  // highlight; a committed corner is.
  function scorePath(path, dtMs, events) {
    const n = Math.floor(path.length / 3);
    const sc = new Float64Array(n);
    if (n < 4) return sc;
    const dt = dtMs / 1000;
    for (let i = 1; i < n - 1; i++) {
      const x0 = path[(i - 1) * 3], y0 = path[(i - 1) * 3 + 1];
      const x1 = path[i * 3], y1 = path[i * 3 + 1];
      const x2 = path[(i + 1) * 3], y2 = path[(i + 1) * 3 + 1];
      const dx1 = x1 - x0, dy1 = y1 - y0;
      const dx2 = x2 - x1, dy2 = y2 - y1;
      const sp = Math.hypot(dx1, dy1) / dt;                  // px/s
      let turn = Math.atan2(dy2, dx2) - Math.atan2(dy1, dx1);
      while (turn > Math.PI) turn -= 2 * Math.PI;
      while (turn < -Math.PI) turn += 2 * Math.PI;
      const prog = path[(i + 1) * 3 + 2] - path[(i - 1) * 3 + 2];

      const fast = Math.min(sp / 380, 1.4);
      const corner = Math.min(Math.abs(turn) / 0.22, 1.6);
      // a corner only counts if there is speed behind it
      sc[i] = fast * 0.9 + corner * fast * 2.2 + (prog > 0 ? 0.25 : -1.2);
    }
    // events (food eaten, jumps) land on the sample nearest their timestamp
    for (const e of (events || [])) {
      const i = Math.round(e.t / dtMs);
      if (i < 1 || i >= n - 1) continue;
      const w = e.kind === 'go' ? 3.2 : e.kind === 'jump' ? 3.8 : e.kind === 'whoa' ? 2.4 : 1.5;
      for (let k = Math.max(1, i - 2); k <= Math.min(n - 2, i + 2); k++) sc[k] += w;
    }
    return sc;
  }

  function pickHighlight(path, dtMs, seconds, events) {
    const n = Math.floor(path.length / 3);
    const win = Math.max(4, Math.round((seconds * 1000) / dtMs));
    if (n <= win) return { start: 0, end: n, score: 0 };
    const sc = scorePath(path, dtMs, events);
    let run = 0;
    for (let i = 0; i < win; i++) run += sc[i];
    let best = -1e9, bestStart = 0;
    for (let s = 0; s + win < n; s++) {
      if (s > 0) run += sc[s + win - 1] - sc[s - 1];
      // ignore the launch: the first moments are the same for everybody
      const usable = s > Math.round(1500 / dtMs);
      if (usable && run > best) { best = run; bestStart = s; }
    }
    return { start: bestStart, end: bestStart + win, score: best };
  }

  // ============================================================== jumps ====
  // Recorded lines are [x, y, idx] — flat. The car's height was never stored,
  // so a replay showed a car driving straight over a ramp while the commentary
  // called the air. Rather than change what is stored (and orphan every line
  // already saved), the flight is reconstructed from the same rule the game
  // uses: cross a ramp on the road above 180 px/s and you launch at 300, under
  // gravity of 950. That is the game's own physics, so the arc matches.
  const JUMP_V0 = 300, JUMP_G = 950;
  const JUMP_MS = (2 * JUMP_V0 / JUMP_G) * 1000;

  function findJumps(path, dtMs, stage) {
    const ramps = (stage.ramps || []).map(r => r.i);
    if (!ramps.length) return [];
    const n = Math.floor(path.length / 3);
    const out = [];
    let busyUntil = -1;
    for (let i = 1; i < n; i++) {
      const t = i * dtMs;
      if (t < busyUntil) continue;
      const j = path[i * 3 + 2];
      const step = Math.hypot(path[i * 3] - path[(i - 1) * 3], path[i * 3 + 1] - path[(i - 1) * 3 + 1]);
      const sp = step / (dtMs / 1000);
      if (sp > 180 && ramps.some(r => Math.abs(r - j) <= 1)) {
        out.push(t);
        busyUntil = t + JUMP_MS;
      }
    }
    return out;
  }
  // height at a moment, in the game's units
  function heightAt(jumps, tMs) {
    for (let k = 0; k < jumps.length; k++) {
      const dt = (tMs - jumps[k]) / 1000;
      if (dt < 0 || dt > JUMP_MS / 1000) continue;
      const z = JUMP_V0 * dt - 0.5 * JUMP_G * dt * dt;
      if (z > 0) return z;
    }
    return 0;
  }

  // ========================================================== commentary ====
  // Rally commentary written from the telemetry, so it can only ever describe
  // something that actually happened: how fast, how hard they were turning and
  // which way, whether they were on a bridge, off the road, or in the air.
  // Deterministic — the same run always gets the same call.

  const LINES = {
    openFirst: ["{n} on the road, and this is the benchmark.",
                "Here's {n} — quickest of the day so far.",
                "{n} now. Watch how early they get on the power."],
    openMid:   ["{n} next, {p} on the day.",
                "Here's {n}, running {p}.",
                "{n} now — solid run, {p} overall."],
    openLast:  ["{n} last home, but home.",
                "And {n}, who took the scenic route.",
                "{n} to finish — not the fastest, but they finished."],
    open:      ["{n} on the stage.", "Here's {n}.", "{n}, then."],
    fast:      ["Flat out through here.", "Foot to the floor.",
                "Big speed on this section.", "No lifting — none at all."],
    easyL:     ["Long left, opening up.", "Gentle left, carrying the speed."],
    easyR:     ["Long right, opening up.", "Gentle right, and they hold it."],
    hardL:     ["Hard left — committed.", "Big left, and they're leaning on it.",
                "Into the left, plenty of lock."],
    hardR:     ["Hard right — committed.", "Big right, and they're leaning on it.",
                "Into the right, plenty of lock."],
    pinL:      ["Hairpin left — hard on the brakes.", "Left hairpin, all the way round.",
                "Tightens left, and that's caught plenty out."],
    pinR:      ["Hairpin right — hard on the brakes.", "Right hairpin, all the way round.",
                "Tightens right, and that's caught plenty out."],
    bridge:    ["Onto the bridge — no room for error.", "Over the water now.",
                "Bridge next, and it's narrow."],
    splash:    ["Off the deck — and into the water!", "That's a splash! Run ruined.",
                "Straight off the bridge — oh, that's cost them."],
    off:       ["Wide! Into the grass.", "Runs out of road there.",
                "That's untidy — completely off line.", "Too much speed, and they lose it."],
    jump:      ["Off the ramp — huge air!", "Launches it, and lands it.",
                "Airborne over the crest."],
    go:        ["Takes the greens, and the car lightens.", "Another one collected.",
                "Straight through the good stuff."],
    whoa:      ["Oh, into the fryer — that'll cost them.",
                "Picks up something heavy there.", "That's the wrong thing to eat."],
    finish:    ["Across the line — {t}.", "And that's the stage done. {t}.",
                "Takes the flag in {t}."],
  };

  function rng(seedStr) {
    let h = 2166136261;
    for (let i = 0; i < seedStr.length; i++) { h ^= seedStr.charCodeAt(i); h = Math.imul(h, 16777619); }
    return function () {
      h ^= h << 13; h >>>= 0; h ^= h >> 17; h ^= h << 5; h >>>= 0;
      return h / 4294967296;
    };
  }

  function offRoadAt(stage, x, y, j) {
    const { pts, widths, NPTS } = stage;
    let gap = 1e9;
    for (let i = Math.max(0, j - 14); i <= Math.min(NPTS - 2, j + 14); i++) {
      const ax = pts[i][0], ay = pts[i][1];
      const vx = pts[i + 1][0] - ax, vy = pts[i + 1][1] - ay;
      const L2 = vx * vx + vy * vy || 1;
      let t = ((x - ax) * vx + (y - ay) * vy) / L2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const d = Math.hypot(ax + vx * t - x, ay + vy * t - y) - widths[i];
      if (d < gap) gap = d;
    }
    return gap;
  }

  // returns [{ t, text }] with t in ms from the start of the window
  function commentate(o) {
    const { path, dtMs, stage, start, end, driver } = o;
    const R = rng((driver && driver.name || '') + '|' + (driver && driver.date || '') + '|' + start);
    const pick = key => { const a = LINES[key]; return a[Math.floor(R() * a.length)]; };
    const fill = (s, d) => s.replace('{n}', (d && d.name) || 'This driver')
                            .replace('{p}', (d && d.pos) || '')
                            .replace('{t}', (d && d.time) || '');
    const out = [];
    const MIN_GAP = 1900;                       // don't talk over yourself
    const say = (t, text) => {
      if (out.length && t - out[out.length - 1].t < MIN_GAP) return false;
      out.push({ t, text });
      return true;
    };

    const rel = i => (i - start) * dtMs;
    const bridges = stage.bridges || [];
    const onBridge = j => bridges.some(([a, b]) => j >= a && j <= b);
    const ramps = (stage.ramps || []).map(r => r.i);

    // opener
    const openKey = !driver ? 'open'
      : driver.rank === 1 ? 'openFirst'
      : driver.isLast ? 'openLast'
      : driver.pos ? 'openMid' : 'open';
    out.push({ t: 0, text: fill(pick(openKey), driver) });

    let lastKind = '';
    for (let i = Math.max(start + 1, 1); i < Math.min(end, Math.floor(path.length / 3) - 1); i++) {
      const x = path[i * 3], y = path[i * 3 + 1], j = path[i * 3 + 2];
      const px = path[(i - 1) * 3], py = path[(i - 1) * 3 + 1];
      const nx2 = path[(i + 1) * 3], ny2 = path[(i + 1) * 3 + 1];
      const step = Math.hypot(x - px, y - py);
      const sp = step / (dtMs / 1000);
      let turn = Math.atan2(ny2 - y, nx2 - x) - Math.atan2(y - py, x - px);
      while (turn > Math.PI) turn -= 2 * Math.PI;
      while (turn < -Math.PI) turn += 2 * Math.PI;
      const curve = Math.abs(turn) / Math.max(step, 6);   // radians per pixel
      const dir = turn < 0 ? 'L' : 'R';
      const gap = offRoadAt(stage, x, y, j);
      const t = rel(i);

      let kind = null;
      if (gap > 4 && onBridge(j)) kind = 'splash';
      else if (gap > 10) kind = 'off';
      else if (ramps.some(r => Math.abs(r - j) <= 1) && sp > 200) kind = 'jump';
      else if (onBridge(j) && lastKind !== 'bridge') kind = 'bridge';
      else if (curve > 0.0050) kind = 'pin' + dir;
      else if (curve > 0.0022) kind = 'hard' + dir;
      else if (curve > 0.0007) kind = 'easy' + dir;
      else if (sp > 330) kind = 'fast';

      if (!kind || kind === lastKind) continue;
      // incidents always get called, scenery only if there is room
      const urgent = kind === 'splash' || kind === 'off' || kind === 'jump';
      if (urgent) {
        if (out.length && t - out[out.length - 1].t < 900 && !out[out.length - 1].urgent) out.pop();
        out.push({ t, text: fill(pick(kind), driver), urgent: true });
        lastKind = kind;
      } else if (say(t, fill(pick(kind), driver))) {
        lastKind = kind;
      }
    }

    // Events the path alone cannot show: what was eaten. Eating is the whole
    // point of the game, so it outranks a passing description of a corner —
    // clear the scenery out of the way rather than dropping the call.
    for (const e of (o.events || [])) {
      if (e.kind !== 'go' && e.kind !== 'whoa') continue;
      const t = e.t - start * dtMs;
      if (t < 500 || t > (end - start) * dtMs - 500) continue;
      for (let k = out.length - 1; k >= 1; k--) {
        if (Math.abs(out[k].t - t) < MIN_GAP && !out[k].urgent) out.splice(k, 1);
      }
      out.push({ t, text: fill(pick(e.kind), driver), urgent: true });
    }
    out.sort((a, b) => a.t - b.t);

    if (driver && driver.finish && end >= Math.floor(path.length / 3) - 2) {
      const t = (end - start) * dtMs - 400;
      while (out.length && t - out[out.length - 1].t < MIN_GAP) out.pop();
      out.push({ t, text: fill(pick('finish'), driver) });
    }
    return out;
  }

  // ================================================================= GIF ====
  // GIF89a writer. Builds a palette from the colours actually used (the art is
  // flat, so a few hundred exact colours covers nearly every pixel), then LZW
  // compresses each frame.
  function buildPalette(frames, maxColors) {
    const counts = new Map();
    for (const f of frames) {
      const d = f.data;
      for (let i = 0; i < d.length; i += 4) {
        const key = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
        counts.set(key, (counts.get(key) || 0) + 1);
      }
    }
    const cap = Math.max(2, Math.min(256, maxColors || 256));
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, cap).map(e => e[0]);
    while (top.length < 2) top.push(0);
    return top;
  }

  function makeMapper(palette) {
    const cache = new Map();
    const pr = palette.map(c => (c >> 16) & 255);
    const pg = palette.map(c => (c >> 8) & 255);
    const pb = palette.map(c => c & 255);
    return function (key) {
      let v = cache.get(key);
      if (v !== undefined) return v;
      const r = (key >> 16) & 255, g = (key >> 8) & 255, b = key & 255;
      let bi = 0, bd = 1e9;
      for (let i = 0; i < palette.length; i++) {
        const dr = r - pr[i], dg = g - pg[i], db = b - pb[i];
        const d = dr * dr + dg * dg + db * db;
        if (d < bd) { bd = d; bi = i; if (d === 0) break; }
      }
      cache.set(key, bi);
      return bi;
    };
  }

  function lzwEncode(indices, minCodeSize) {
    const out = [];
    let cur = 0, curBits = 0;
    function emit(code, size) {
      cur |= code << curBits;
      curBits += size;
      while (curBits >= 8) { out.push(cur & 255); cur >>= 8; curBits -= 8; }
    }
    const clear = 1 << minCodeSize;
    const eoi = clear + 1;
    let codeSize = minCodeSize + 1;
    let next = eoi + 1;
    let dict = new Map();
    emit(clear, codeSize);
    let prefix = indices[0];
    for (let i = 1; i < indices.length; i++) {
      const k = indices[i];
      const key = prefix * 4096 + k;
      const found = dict.get(key);
      if (found !== undefined) { prefix = found; continue; }
      emit(prefix, codeSize);
      dict.set(key, next);
      if (next === (1 << codeSize)) {
        if (codeSize < 12) codeSize++;
        else { emit(clear, codeSize); dict = new Map(); next = eoi; codeSize = minCodeSize + 1; }
      }
      next++;
      prefix = k;
    }
    emit(prefix, codeSize);
    emit(eoi, codeSize);
    if (curBits > 0) out.push(cur & 255);
    return out;
  }

  // frames: [{ data: Uint8ClampedArray RGBA }], all the same size
  // opts: { loop, maxColors } — fewer colours compress a lot better, and this
  // art is flat enough that 64 is usually indistinguishable from 256
  function encodeGif(frames, w, h, delayMs, opts) {
    const o = (typeof opts === 'number') ? { loop: opts } : (opts || {});
    const loop = o.loop;
    const palette = buildPalette(frames, o.maxColors);
    const map = makeMapper(palette);
    let bits = 1;
    while ((1 << bits) < palette.length) bits++;
    if (bits > 8) bits = 8;
    const tableSize = 1 << bits;

    const bytes = [];
    const push = (...b) => bytes.push(...b);
    const pushStr = s => { for (let i = 0; i < s.length; i++) bytes.push(s.charCodeAt(i)); };
    const short = v => { bytes.push(v & 255, (v >> 8) & 255); };

    pushStr('GIF89a');
    short(w); short(h);
    push(0x80 | ((bits - 1) & 7), 0, 0);          // global table, sorted flags
    for (let i = 0; i < tableSize; i++) {
      const c = palette[i] || 0;
      push((c >> 16) & 255, (c >> 8) & 255, c & 255);
    }
    // Netscape looping extension
    push(0x21, 0xFF, 11);
    pushStr('NETSCAPE2.0');
    push(3, 1);
    short(loop === undefined ? 0 : loop);
    push(0);

    const delay = Math.max(2, Math.round(delayMs / 10));      // GIF works in 1/100s
    const minCode = Math.max(2, bits);

    for (const f of frames) {
      push(0x21, 0xF9, 4, 0x04, delay & 255, (delay >> 8) & 255, 0, 0); // graphic control
      push(0x2C); short(0); short(0); short(w); short(h); push(0);      // image descriptor
      const d = f.data;
      const idx = new Uint8Array(w * h);
      for (let i = 0, p = 0; i < d.length; i += 4, p++) {
        idx[p] = map((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
      }
      push(minCode);
      const bytesOut = lzwEncode(idx, minCode);
      for (let i = 0; i < bytesOut.length; i += 255) {
        const chunk = bytesOut.slice(i, i + 255);
        push(chunk.length, ...chunk);
      }
      push(0);
    }
    push(0x3B);
    return new Uint8Array(bytes);
  }

  // ============================================================== renderer ==
  const PAINT_COLORS = ['#23331f', '#ffffff', '#ff3b30', '#ff8c2e', '#ffd23f', '#2fae4e', '#5bd1ff', '#c9a2ff'];
  const GRID = 18;

  function shade(hex, amt) {
    const n = parseInt((hex || '#7ddb6a').replace('#', ''), 16);
    let r0 = (n >> 16) & 255, g0 = (n >> 8) & 255, b0 = n & 255;
    if (amt >= 0) { r0 += (255 - r0) * amt; g0 += (255 - g0) * amt; b0 += (255 - b0) * amt; }
    else { r0 += r0 * amt; g0 += g0 * amt; b0 += b0 * amt; }
    const cl = v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
    return '#' + cl(r0) + cl(g0) + cl(b0);
  }
  function rrect(g, x, y, w, h, r) {
    g.beginPath(); g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  }

  // The same car the game draws: a painted round body on a chassis, wheels and
  // bodywork turning with the heading while the paint stays upright.
  function drawCar(g, face, r, heading) {
    const f = face || {};
    g.save();
    const hd = (heading != null ? heading : -Math.PI / 2) + Math.PI / 2;
    g.save(); g.rotate(hd);
    g.fillStyle = '#2b2f2a';
    const wx = r * 0.9, wy = r * 0.58, ww = r * 0.34, wh = r * 0.56;
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
      rrect(g, sx * wx - ww / 2, sy * wy - wh / 2, ww, wh, ww * 0.4); g.fill();
    }
    g.fillStyle = '#8a938a';
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
      g.beginPath(); g.arc(sx * wx, sy * wy, ww * 0.16, 0, Math.PI * 2); g.fill();
    }
    g.fillStyle = '#2b2f2a';
    rrect(g, -r * 0.55, -r * 1.12, r * 1.1, r * 0.24, r * 0.1); g.fill();
    g.fillStyle = shade(f.color, 0.65);
    g.beginPath(); g.arc(-r * 0.34, -r * 1.0, r * 0.11, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.arc(r * 0.34, -r * 1.0, r * 0.11, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#2b2f2a';
    g.fillRect(-r * 0.3, r * 0.82, r * 0.12, r * 0.26);
    g.fillRect(r * 0.18, r * 0.82, r * 0.12, r * 0.26);
    rrect(g, -r * 0.72, r * 1.0, r * 1.44, r * 0.22, r * 0.08); g.fill();
    g.fillStyle = shade(f.color, -0.42);
    g.fillRect(-r * 0.6, r * 1.03, r * 0.22, r * 0.14);
    g.fillRect(r * 0.38, r * 1.03, r * 0.22, r * 0.14);
    g.restore();

    g.fillStyle = f.color || '#ffd23f';
    g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.fill();
    const paint = f.paint || '';
    if (paint.length === GRID * GRID) {
      g.save();
      g.beginPath(); g.arc(0, 0, r * 0.97, 0, Math.PI * 2); g.clip();
      const cell = (r * 2) / GRID;
      for (let i = 0; i < paint.length; i++) {
        const v = paint.charCodeAt(i) - 48;
        if (v <= 0) continue;
        g.fillStyle = PAINT_COLORS[v - 1] || '#23331f';
        g.fillRect(-r + (i % GRID) * cell, -r + ((i / GRID) | 0) * cell, cell + 0.6, cell + 0.6);
      }
      g.restore();
    }
    g.lineWidth = Math.max(2, r * 0.09);
    g.strokeStyle = 'rgba(35,51,31,.55)';
    g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.stroke();
    g.restore();
  }

  // draws one frame of a replay and returns nothing; caller grabs the pixels
  function drawFrame(ctx, W, H, stage, sample, opts) {
    const { pts, widths, normals, NPTS, bridges, FINISH_I, START_I } = stage;
    const { x, y, heading, trail, face, caption, sub, zoom } = sample;
    const Z = zoom || 0.62;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#c7dcae';
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    ctx.translate(W / 2, H * 0.56);
    ctx.scale(Z, Z);
    ctx.translate(-x, -y);

    const near = (ox, oy, pad) => Math.abs(ox - x) < (W / 2) / Z + (pad || 60)
                              && Math.abs(oy - y) < (H / 2) / Z + (pad || 60);

    // grass patches, under everything
    ctx.fillStyle = '#bcd4a0';
    for (const p of (stage.patches || [])) {
      if (!near(p.x, p.y, p.r)) continue;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
    }

    const reach = (Math.max(W, H) / Z) * 0.85;
    let lo = NPTS, hi = 0;
    for (let i = 0; i < NPTS; i++) {
      if (Math.abs(pts[i][0] - x) < reach && Math.abs(pts[i][1] - y) < reach) {
        if (i < lo) lo = i;
        if (i > hi) hi = i;
      }
    }
    lo = Math.max(0, lo - 2); hi = Math.min(NPTS - 1, hi + 2);
    const onBridge = i => bridges.some(([a, b]) => i >= a && i <= b);

    // water under the bridges
    ctx.strokeStyle = '#6fc3e8'; ctx.lineCap = 'round';
    for (const [a, b] of bridges) {
      if (b < lo || a > hi) continue;
      ctx.lineWidth = 380;
      ctx.beginPath();
      for (let i = Math.max(a - 2, 0); i <= Math.min(b + 2, NPTS - 1); i++) {
        if (i === Math.max(a - 2, 0)) ctx.moveTo(pts[i][0], pts[i][1]); else ctx.lineTo(pts[i][0], pts[i][1]);
      }
      ctx.stroke();
    }

    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (let pass = 0; pass < 2; pass++) {
      for (let i = lo; i < hi; i++) {
        const br = onBridge(i);
        ctx.beginPath();
        ctx.moveTo(pts[i][0], pts[i][1]);
        ctx.lineTo(pts[i + 1][0], pts[i + 1][1]);
        if (pass === 0) { ctx.strokeStyle = br ? '#8a6a44' : '#b9cfa1'; ctx.lineWidth = widths[i] * 2 + 12; }
        else { ctx.strokeStyle = br ? '#eedaae' : '#ffffff'; ctx.lineWidth = widths[i] * 2; }
        ctx.stroke();
      }
    }
    for (let i = lo; i < hi; i += 2) {
      const [nx, ny] = normals[i], w = widths[i];
      ctx.fillStyle = (i % 4 === 0) ? '#ff8c2e' : '#2fae4e';
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.arc(pts[i][0] + nx * w * s, pts[i][1] + ny * w * s, 6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // jump ramps — the yellow bar and its arrow
    for (const rp of (stage.ramps || [])) {
      if (rp.i < lo || rp.i > hi) continue;
      const [rnx, rny] = normals[rp.i], rw = widths[rp.i], rp0 = pts[rp.i];
      const a = rp.side < 0 ? -0.92 : 0.06, b = rp.side < 0 ? -0.06 : 0.92;
      ctx.strokeStyle = '#ffd23f'; ctx.lineWidth = 16;
      ctx.beginPath();
      ctx.moveTo(rp0[0] + rnx * rw * a, rp0[1] + rny * rw * a);
      ctx.lineTo(rp0[0] + rnx * rw * b, rp0[1] + rny * rw * b);
      ctx.stroke();
      const mid = (a + b) / 2;
      const nj = Math.min(rp.i + 1, NPTS - 1);
      const dir = Math.atan2(pts[nj][1] - rp0[1], pts[nj][0] - rp0[0]);
      ctx.save();
      ctx.translate(rp0[0] + rnx * rw * mid, rp0[1] + rny * rw * mid);
      ctx.rotate(dir);
      ctx.fillStyle = '#ff8c2e';
      ctx.beginPath(); ctx.moveTo(16, 0); ctx.lineTo(-7, -11); ctx.lineTo(-7, 11); ctx.closePath(); ctx.fill();
      ctx.restore();
    }

    // finish banner
    if (FINISH_I >= lo && FINISH_I <= hi) {
      const [nx, ny] = normals[FINISH_I], w = widths[FINISH_I];
      ctx.strokeStyle = '#23331f'; ctx.lineWidth = 14;
      ctx.beginPath();
      ctx.moveTo(pts[FINISH_I][0] - nx * w, pts[FINISH_I][1] - ny * w);
      ctx.lineTo(pts[FINISH_I][0] + nx * w, pts[FINISH_I][1] + ny * w);
      ctx.stroke();
    }

    // scenery, then the food itself — this is what the stage is about
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const d of (stage.decor || [])) {
      if (!near(d.x, d.y)) continue;
      ctx.font = d.s + 'px sans-serif';
      ctx.fillText(d.e, d.x, d.y);
    }
    for (const st of (stage.stones || [])) {
      if (!near(st.x, st.y)) continue;
      ctx.save();
      ctx.translate(st.x, st.y);
      ctx.rotate(st.a || 0);
      ctx.font = Math.round((st.s || 16) * 2.2) + 'px sans-serif';
      ctx.fillText('🪨', 0, 0);
      ctx.restore();
    }
    for (const f of (stage.foods || [])) {
      if (!near(f.x, f.y)) continue;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(f.x, f.y, 21, 0, Math.PI * 2); ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = f.go ? '#2fae4e' : '#ff8c2e';
      ctx.stroke();
      ctx.font = '28px sans-serif';
      ctx.fillStyle = '#23331f';
      ctx.fillText(f.def[0], f.x, f.y + 2);
    }

    if (trail && trail.length > 2) {
      ctx.strokeStyle = 'rgba(35,51,31,.22)';
      ctx.lineWidth = 9;
      ctx.beginPath();
      ctx.moveTo(trail[0][0], trail[0][1]);
      for (let i = 1; i < trail.length; i++) ctx.lineTo(trail[i][0], trail[i][1]);
      ctx.stroke();
    }

    const z = sample.z || 0;
    ctx.save();
    ctx.translate(x + 5, y + 7);
    ctx.globalAlpha = z > 0 ? 0.26 : 0.18;
    ctx.fillStyle = '#23331f';
    const shr = z > 0 ? 24 * 0.95 : 25;
    ctx.beginPath();
    if (z > 0) ctx.ellipse(0, 0, shr, shr * 0.55, 0, 0, Math.PI * 2);
    else ctx.arc(0, 0, shr, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.translate(x, y - z * 0.55);
    drawCar(ctx, face, 24 * (1 + z / 450), heading);
    ctx.restore();

    ctx.restore();

    // caption bar: what the commentator is saying, then who we're watching
    const commentary = sample.commentary;
    if (caption || commentary) {
      const barH = commentary ? 52 : 38;
      ctx.fillStyle = 'rgba(35,51,31,.84)';
      ctx.fillRect(0, H - barH, W, barH);
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      if (commentary) {
        ctx.fillStyle = '#ffffff';
        ctx.font = '700 15px Rubik, Arial, sans-serif';
        let line = commentary;
        while (ctx.measureText(line).width > W - 22 && line.length > 4) line = line.slice(0, -2);
        if (line !== commentary) line = line.replace(/[ ,.]+$/, '') + '…';
        ctx.fillText(line, 11, H - barH + 15);
      }
      if (caption) {
        ctx.fillStyle = '#c7dcae';
        ctx.font = '700 12px Rubik, Arial, sans-serif';
        ctx.fillText(caption + (sub ? '   ·   ' + sub : ''), 11, H - 12);
      }
    }
    // corner badge
    if (opts && opts.badge) {
      ctx.fillStyle = '#2fae4e';
      ctx.fillRect(W - 92, 0, 92, 24);
      ctx.fillStyle = '#ffffff';
      ctx.font = '800 12px Rubik, Arial, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(opts.badge, W - 46, 13);
    }
  }

  // Replays [x,y,idx] samples into frames. Samples are interpolated up to the
  // output frame rate so the motion is smooth rather than steppy.
  function renderClip(canvas, stage, segments, o) {
    const opts = o || {};
    const W = canvas.width, H = canvas.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const fps = opts.fps || 12;
    const frames = [];

    for (const seg of segments) {
      const { path, dtMs, face, caption, sub, badge } = seg;
      const lines = seg.lines || [];
      const jumps = findJumps(path, dtMs, stage);
      const n = Math.floor(path.length / 3);
      const from = Math.max(0, seg.start | 0), to = Math.min(n, seg.end | 0);
      if (to - from < 2) continue;
      const durMs = (to - from) * dtMs;
      const count = Math.max(2, Math.round((durMs / 1000) * fps));
      for (let f = 0; f < count; f++) {
        const t = from + (to - 1 - from) * (f / (count - 1));
        const i = Math.min(n - 2, Math.floor(t));
        const frac = t - i;
        const x = path[i * 3] + (path[(i + 1) * 3] - path[i * 3]) * frac;
        const y = path[i * 3 + 1] + (path[(i + 1) * 3 + 1] - path[i * 3 + 1]) * frac;
        const hx = path[(i + 1) * 3] - path[i * 3], hy = path[(i + 1) * 3 + 1] - path[i * 3 + 1];
        const heading = Math.atan2(hy, hx);
        const trail = [];
        for (let k = Math.max(from, i - 14); k <= i; k++) trail.push([path[k * 3], path[k * 3 + 1]]);
        const elapsed = (t - from) * dtMs;
        const z = heightAt(jumps, t * dtMs);
        let commentary = '';
        for (const l of lines) {
          if (l.t <= elapsed && elapsed - l.t < 3200) commentary = l.text;
        }
        drawFrame(ctx, W, H, stage, { x, y, heading, trail, face, caption, sub, commentary, z, zoom: opts.zoom }, { badge });
        frames.push({ data: ctx.getImageData(0, 0, W, H).data });
      }
    }
    return { frames, fps };
  }

  // ---- live playback with spoken commentary (browser voice, page only) ----
  function playClip(canvas, stage, segments, o) {
    const opts = o || {};
    const W = canvas.width, H = canvas.height;
    const ctx = canvas.getContext('2d');
    const speak = opts.speak && typeof speechSynthesis !== 'undefined';
    let segI = 0, t0 = 0, stopped = false, spokenUpTo = -1;
    if (speak) { try { speechSynthesis.cancel(); } catch (e) {} }

    function frame(now) {
      if (stopped) return;
      if (!t0) t0 = now;
      const seg = segments[segI];
      if (!seg) { if (opts.onEnd) opts.onEnd(); return; }
      if (!seg._jumps) seg._jumps = findJumps(seg.path, seg.dtMs, stage);
      const n = Math.floor(seg.path.length / 3);
      const from = Math.max(0, seg.start | 0), to = Math.min(n, seg.end | 0);
      const durMs = (to - from) * seg.dtMs;
      const elapsed = now - t0;
      if (elapsed >= durMs) { segI++; t0 = 0; spokenUpTo = -1; requestAnimationFrame(frame); return; }

      const t = from + (to - 1 - from) * (elapsed / durMs);
      const i = Math.min(n - 2, Math.floor(t));
      const frac = t - i;
      const x = seg.path[i * 3] + (seg.path[(i + 1) * 3] - seg.path[i * 3]) * frac;
      const y = seg.path[i * 3 + 1] + (seg.path[(i + 1) * 3 + 1] - seg.path[i * 3 + 1]) * frac;
      const heading = Math.atan2(seg.path[(i + 1) * 3 + 1] - seg.path[i * 3 + 1],
                                 seg.path[(i + 1) * 3] - seg.path[i * 3]);
      const trail = [];
      for (let k = Math.max(from, i - 14); k <= i; k++) trail.push([seg.path[k * 3], seg.path[k * 3 + 1]]);

      const lines = seg.lines || [];
      let commentary = '';
      for (let k = 0; k < lines.length; k++) {
        const l = lines[k];
        if (l.t <= elapsed && elapsed - l.t < 3200) commentary = l.text;
        if (speak && l.t <= elapsed && k > spokenUpTo) {
          spokenUpTo = k;
          try {
            const u = new SpeechSynthesisUtterance(l.text);
            u.rate = 1.12; u.pitch = 1.0; u.lang = 'en-GB';
            speechSynthesis.speak(u);
          } catch (e) {}
        }
      }
      drawFrame(ctx, W, H, stage, { x, y, heading, trail, face: seg.face,
        caption: seg.caption, sub: seg.sub, commentary,
        z: heightAt(seg._jumps, t * seg.dtMs), zoom: opts.zoom }, { badge: seg.badge });
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
    return function stop() {
      stopped = true;
      if (speak) { try { speechSynthesis.cancel(); } catch (e) {} }
    };
  }

  // ====================================================== casting the reel ==
  // Finishing order makes a dull reel: the top three all drive tidily. What is
  // worth watching is a MOMENT — someone launching off a ramp, dropping it into
  // the water, running wide, or hanging the car sideways through a hairpin. So
  // every recorded line is scanned for its best moment of each kind, and the
  // cast is picked for variety of incident rather than for lap time.
  const MOMENTS = {
    splash:   { badge: 'SPLASH!',   weight: 3.4 },
    air:      { badge: 'BIG AIR',   weight: 2.8 },
    off:      { badge: 'OFF ROAD',  weight: 2.0 },
    sideways: { badge: 'SIDEWAYS',  weight: 1.7 },
    charge:   { badge: 'FLAT OUT',  weight: 1.0 },
  };

  function analyseRun(path, dtMs, stage, seconds) {
    const n = Math.floor(path.length / 3);
    const win = Math.max(4, Math.round((seconds * 1000) / dtMs));
    const kinds = Object.keys(MOMENTS);
    const per = {};
    for (const k of kinds) per[k] = new Float64Array(n);
    if (n < win + 2) return null;

    const bridges = stage.bridges || [];
    const onBridge = j => bridges.some(([a, b]) => j >= a && j <= b);
    const ramps = (stage.ramps || []).map(r => r.i);

    for (let i = 1; i < n - 1; i++) {
      const x = path[i * 3], y = path[i * 3 + 1], j = path[i * 3 + 2];
      const px = path[(i - 1) * 3], py = path[(i - 1) * 3 + 1];
      const nx2 = path[(i + 1) * 3], ny2 = path[(i + 1) * 3 + 1];
      const step = Math.hypot(x - px, y - py);
      const sp = step / (dtMs / 1000);
      let turn = Math.atan2(ny2 - y, nx2 - x) - Math.atan2(y - py, x - px);
      while (turn > Math.PI) turn -= 2 * Math.PI;
      while (turn < -Math.PI) turn += 2 * Math.PI;
      const curve = Math.abs(turn) / Math.max(step, 6);
      const gap = offRoadAt(stage, x, y, j);

      if (gap > 4 && onBridge(j)) per.splash[i] += 6;
      if (gap > 18) per.off[i] += Math.min(gap / 40, 3);
      if (ramps.some(r => Math.abs(r - j) <= 1) && sp > 200) per.air[i] += 5;
      if (curve > 0.0035 && sp > 150) per.sideways[i] += curve * 400 * Math.min(sp / 300, 1.4);
      if (sp > 320) per.charge[i] += (sp - 320) / 90;
    }

    const best = {};
    for (const k of kinds) {
      const a = per[k];
      let run = 0;
      for (let i = 0; i < win; i++) run += a[i];
      let top = -1, topStart = 0;
      for (let s = 0; s + win < n; s++) {
        if (s > 0) run += a[s + win - 1] - a[s - 1];
        if (s > Math.round(1200 / dtMs) && run > top) { top = run; topStart = s; }
      }
      best[k] = { kind: k, start: topStart, end: topStart + win, raw: top,
                  score: top * MOMENTS[k].weight };
    }
    let winner = null;
    for (const k of kinds) if (!winner || best[k].score > winner.score) winner = best[k];
    return { best, winner, hasMoment: winner && winner.raw > 0.9 };
  }

  // entries: [{ name, time, face, path, rank, isLast }] in finishing order
  function buildCast(entries, stage, o) {
    const opts = o || {};
    const dtMs = opts.dtMs || 150;
    const seconds = opts.seconds || 4.4;
    const target = opts.cast || 6;
    const usable = entries.filter(e => e.path && e.path.length > 60);
    if (!usable.length) return [];

    const analysed = usable.map(e => ({ e, a: analyseRun(e.path, dtMs, stage, seconds) }))
                           .filter(o2 => o2.a);
    if (!analysed.length) return [];

    const cast = [];
    const used = new Set();
    const add = (o2, kind, label) => {
      if (!o2 || used.has(o2.e)) return;
      const m = o2.a.best[kind] || o2.a.winner;
      used.add(o2.e);
      cast.push({ entry: o2.e, start: m.start, end: m.end, kind,
                  badge: label || MOMENTS[kind].badge });
    };

    // the leader always opens, at their best moment rather than a tidy corner
    const leader = analysed.find(o2 => o2.e.rank === 1);
    if (leader) add(leader, leader.a.winner.kind, 'LEADER');

    // then the strongest moment of each kind, so the reel keeps changing shape
    for (const kind of Object.keys(MOMENTS)) {
      const ranked = analysed.filter(o2 => !used.has(o2.e) && o2.a.best[kind].raw > 0.9)
                             .sort((p, q) => q.a.best[kind].raw - p.a.best[kind].raw);
      if (ranked.length) add(ranked[0], kind);
      if (cast.length >= target - 1) break;
    }

    // whoever came home last gets the sign-off
    const last = analysed.find(o2 => o2.e.isLast && !used.has(o2.e));
    if (last && cast.length < target) add(last, last.a.winner.kind, 'LAST HOME');

    // still short? fill with the best remaining moments of any kind
    if (cast.length < target) {
      const rest = analysed.filter(o2 => !used.has(o2.e))
                           .sort((p, q) => q.a.winner.score - p.a.winner.score);
      for (const o2 of rest) {
        if (cast.length >= target) break;
        add(o2, o2.a.winner.kind);
      }
    }
    return cast;
  }

  root.findJumps = findJumps;
  root.heightAt = heightAt;
  root.analyseRun = analyseRun;
  root.buildCast = buildCast;
  root.MOMENTS = MOMENTS;
  root.commentate = commentate;
  root.playClip = playClip;
  root.pickHighlight = pickHighlight;
  root.scorePath = scorePath;
  root.encodeGif = encodeGif;
  root.renderClip = renderClip;
  root.drawFrame = drawFrame;
})(typeof window !== 'undefined' ? (window.FPRClip = window.FPRClip || {}) : module.exports);
