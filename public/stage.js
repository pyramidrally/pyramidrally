/*  stage.js — the daily stage geometry, shared by the game and the results page.

    GENERATED from public/index.html by make_stage_js.py. Do not edit by hand:
    edit the game, then re-run the generator. A test checks this file still
    produces the same track as index.html for hundreds of dates.  */

(function (root) {
  function sha256Words(str){
    const K = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
               0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
               0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
               0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
               0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
               0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
               0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
               0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
    let H = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
    const bytes = [];
    for (let i = 0; i < str.length; i++){
      let c = str.charCodeAt(i);
      if (c < 128) bytes.push(c);
      else if (c < 2048){ bytes.push(192 | (c >> 6), 128 | (c & 63)); }
      else { bytes.push(224 | (c >> 12), 128 | ((c >> 6) & 63), 128 | (c & 63)); }
    }
    const bitLen = bytes.length * 8;
    bytes.push(0x80);
    while (bytes.length % 64 !== 56) bytes.push(0);
    for (let i = 7; i >= 0; i--) bytes.push(Math.floor(bitLen / Math.pow(2, i * 8)) & 255);
    const rot = (v, n) => (v >>> n) | (v << (32 - n));
    const w = new Array(64);
    for (let off = 0; off < bytes.length; off += 64){
      for (let i = 0; i < 16; i++)
        w[i] = (bytes[off+i*4] << 24) | (bytes[off+i*4+1] << 16) | (bytes[off+i*4+2] << 8) | bytes[off+i*4+3];
      for (let i = 16; i < 64; i++){
        const s0 = rot(w[i-15], 7) ^ rot(w[i-15], 18) ^ (w[i-15] >>> 3);
        const s1 = rot(w[i-2], 17) ^ rot(w[i-2], 19) ^ (w[i-2] >>> 10);
        w[i] = (w[i-16] + s0 + w[i-7] + s1) | 0;
      }
      let a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (let i = 0; i < 64; i++){
        const S1 = rot(e, 6) ^ rot(e, 11) ^ rot(e, 25);
        const ch = (e & f) ^ (~e & g);
        const t1 = (h + S1 + ch + K[i] + w[i]) | 0;
        const S0 = rot(a, 2) ^ rot(a, 13) ^ rot(a, 22);
        const mj = (a & b) ^ (a & c) ^ (b & c);
        const t2 = (S0 + mj) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      H = [(H[0]+a)|0,(H[1]+b)|0,(H[2]+c)|0,(H[3]+d)|0,(H[4]+e)|0,(H[5]+f)|0,(H[6]+g)|0,(H[7]+h)|0];
    }
    return H.map(v => v >>> 0);
  }

  function mulberry32(a){ return function(){ a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

  function buildStage(dateStr) {
    const SW = sha256Words('pyramid-' + dateStr);
const STEP = 24, NPTS = 600, START_I = 26, FINISH_I = NPTS - 10;
  let pts = [], widths = [];
  {
    // Deterministic retry: generate, MEASURE self-clearance, and if the road
    // would overlap itself, regenerate with a nudged seed. Same math on every
    // device → everyone still gets the identical daily stage.
    function attemptGen(s2){
      const P = [], W = [];
      const r = mulberry32(s2);
      const grid = new Map();
      const cell = (x, y) => (Math.round(x / 120)) + ':' + (Math.round(y / 120));
      let x = 0, y = 0, h = -Math.PI / 2; // north
      let turn = 0, segLeft = 0, wTarget = 110, w = 120;
      for (let i = 0; i < NPTS; i++){
        P.push([x, y]);
        W.push(w);
        const key = cell(x, y);
        if (!grid.has(key)) grid.set(key, i);
        if (segLeft-- <= 0){
          segLeft = 10 + Math.floor(r() * 22);
          const roll = r();
          const dir = r() < 0.5 ? -1 : 1;
          if (roll < 0.18) turn = 0;
          else if (roll < 0.40) turn = dir * 0.035;
          else if (roll < 0.62) turn = dir * 0.075;
          else if (roll < 0.84) turn = dir * 0.14;   // sharp: lift or brake
          else { turn = dir * 0.21; segLeft += 10; } // hairpin: you MUST brake
          {
            const lane = r();
            wTarget = lane < 0.22 ? 46 + r() * 12    // 1 lane: tight!
                    : lane < 0.68 ? 80 + r() * 30    // 2 lanes
                    : 128 + r() * 24;                // 3 lanes: boulevard
          }
        }
        // steer back if drifting into an old part of the track (no crossings)
        let avoid = 0;
        for (const look of [220, 400, 600, 820]) for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++){
          const k = (Math.round((x + Math.cos(h) * look) / 120) + dx) + ':' + (Math.round((y + Math.sin(h) * look) / 120) + dy);
          const old = grid.get(k);
          if (old !== undefined && i - old > 35) avoid = 1;
        }
        const north = -Math.PI / 2;
        let dh = turn;
        if (avoid) dh += (north - h) * 0.62; // bend back toward north to escape
        h += dh;
        // clamp heading so the stage always makes progress (can go sideways & slightly down)
        let rel = h - north;
        while (rel > Math.PI) rel -= 2 * Math.PI;
        while (rel < -Math.PI) rel += 2 * Math.PI;
        rel = Math.max(-2.0, Math.min(2.0, rel));
        h = north + rel;
        w += (wTarget - w) * 0.12;
        x += Math.cos(h) * STEP;
        y += Math.sin(h) * STEP;
      }
      // measure the tightest gap between non-adjacent road sections
      let clear = 1e9;
      for (let i = 0; i < NPTS; i += 4) for (let j = i + 70; j < NPTS; j += 4){
        const dd = Math.hypot(P[i][0] - P[j][0], P[i][1] - P[j][1]) - (W[i] + W[j]);
        if (dd < clear) clear = dd;
      }
      return { P, W, clear };
    }
    let best = null;
    for (let a = 0; a < 8; a++){
      const g = attemptGen((SW[0] + a * 0x51ab) >>> 0);
      if (!best || g.clear > best.clear) best = g;
      if (g.clear >= 12) { best = g; break; }
    }
    pts = best.P; widths = best.W;
    // widen & straighten the opening stretch
    for (let i = 0; i < START_I + 8; i++) widths[i] = 135;
  }
  

  const normals = pts.map((p, i) => {
    const a = pts[Math.max(i - 1, 0)], b = pts[Math.min(i + 1, NPTS - 1)];
    const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1;
    return [-dy / L, dx / L];
  });


  const ramps = [], bridges = [];
  {
    const r = mulberry32(SW[2]);
    for (let b = 0; b < 2; b++){
      const s = Math.floor(START_I + 60 + r() * (FINISH_I - START_I - 170));
      bridges.push([s, s + 26 + Math.floor(r() * 14)]);
    }
    bridges.sort((a, b) => a[0] - b[0]);
    if (bridges[1][0] < bridges[0][1] + 30){
      const len = bridges[1][1] - bridges[1][0];
      bridges[1][0] = bridges[0][1] + 40;
      bridges[1][1] = bridges[1][0] + len;
      if (bridges[1][1] > FINISH_I - 25) bridges.pop();
    }
    let tries = 0;
    while (ramps.length < 5 && tries++ < 80){
      const i = Math.floor(START_I + 30 + r() * (FINISH_I - START_I - 70));
      if (bridges.some(([a, b]) => i > a - 8 && i < b + 8)) continue;
      if (ramps.some(r0 => Math.abs(r0.i - i) < 25)) continue;
      ramps.push({ i, side: r() < 0.5 ? -1 : 1 });
    }
  }
  function onBridge(i){ return bridges.some(([a, b]) => i >= a && i <= b); }

  // real obstacles: stones on the road
  const stones = [];
  {
    const r = mulberry32(SW[3]);
    let i = START_I + 40;
    while (i < FINISH_I - 20){
      i += 35 + Math.floor(r() * 55);
      if (i >= FINISH_I - 20) break;
      if (bridges.some(([a, b]) => i > a - 6 && i < b + 6)) continue;
      if (ramps.some(rp => Math.abs(rp.i - i) < 12)) continue;
      const [px, py] = pts[i], [nx, ny] = normals[i], w = widths[i];
      const off = (r() * 2 - 1) * w * 0.7;
      stones.push({ x: px + nx * off, y: py + ny * off, a: r() * Math.PI, s: 14 + r() * 7 });
    }
  }


    return { pts, widths, normals, bridges, ramps, NPTS, STEP, START_I, FINISH_I, SW };
  }

  root.buildStage = buildStage;
  root.sha256Words = sha256Words;
  root.mulberry32 = mulberry32;
})(typeof window !== 'undefined' ? (window.FPRStage = window.FPRStage || {}) : module.exports);
