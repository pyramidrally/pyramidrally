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

  function drawFace(g, face, r) {
    g.fillStyle = (face && face.color) || '#ffd23f';
    g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.fill();
    const paint = (face && face.paint) || '';
    if (paint.length === GRID * GRID) {
      g.save();
      g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.clip();
      const cell = (r * 2) / GRID;
      for (let i = 0; i < paint.length; i++) {
        const v = paint.charCodeAt(i) - 48;
        if (v <= 0) continue;
        g.fillStyle = PAINT_COLORS[v - 1] || '#23331f';
        g.fillRect(-r + (i % GRID) * cell, -r + ((i / GRID) | 0) * cell, cell + 0.6, cell + 0.6);
      }
      g.restore();
    }
    g.fillStyle = '#23331f';
    g.beginPath(); g.arc(-r * 0.33, -r * 0.14, r * 0.1, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.arc(r * 0.33, -r * 0.14, r * 0.1, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#23331f'; g.lineWidth = Math.max(1.2, r * 0.12); g.lineCap = 'round';
    g.beginPath(); g.arc(0, r * 0.1, r * 0.42, 0.22 * Math.PI, 0.78 * Math.PI); g.stroke();
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
    // finish banner
    if (FINISH_I >= lo && FINISH_I <= hi) {
      const [nx, ny] = normals[FINISH_I], w = widths[FINISH_I];
      ctx.strokeStyle = '#23331f'; ctx.lineWidth = 14;
      ctx.beginPath();
      ctx.moveTo(pts[FINISH_I][0] - nx * w, pts[FINISH_I][1] - ny * w);
      ctx.lineTo(pts[FINISH_I][0] + nx * w, pts[FINISH_I][1] + ny * w);
      ctx.stroke();
    }

    if (trail && trail.length > 2) {
      ctx.strokeStyle = 'rgba(35,51,31,.22)';
      ctx.lineWidth = 9;
      ctx.beginPath();
      ctx.moveTo(trail[0][0], trail[0][1]);
      for (let i = 1; i < trail.length; i++) ctx.lineTo(trail[i][0], trail[i][1]);
      ctx.stroke();
    }

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(heading + Math.PI / 2);
    ctx.fillStyle = 'rgba(35,51,31,.30)';
    ctx.fillRect(-26, -34, 52, 68);
    ctx.restore();

    ctx.save();
    ctx.translate(x, y);
    drawFace(ctx, face, 24);
    ctx.restore();

    ctx.restore();

    // caption bar
    if (caption) {
      ctx.fillStyle = 'rgba(35,51,31,.82)';
      ctx.fillRect(0, H - 42, W, 42);
      ctx.fillStyle = '#ffffff';
      ctx.font = '700 17px Rubik, Arial, sans-serif';
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(caption, 12, H - 27);
      if (sub) {
        ctx.fillStyle = '#c7dcae';
        ctx.font = '600 12px Rubik, Arial, sans-serif';
        ctx.fillText(sub, 12, H - 11);
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
        drawFrame(ctx, W, H, stage, { x, y, heading, trail, face, caption, sub, zoom: opts.zoom }, { badge });
        frames.push({ data: ctx.getImageData(0, 0, W, H).data });
      }
    }
    return { frames, fps };
  }

  root.pickHighlight = pickHighlight;
  root.scorePath = scorePath;
  root.encodeGif = encodeGif;
  root.renderClip = renderClip;
  root.drawFrame = drawFrame;
})(typeof window !== 'undefined' ? (window.FPRClip = window.FPRClip || {}) : module.exports);
