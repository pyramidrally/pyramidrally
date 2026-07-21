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

  const CUISINES = [
    { name:'AMERICAN 🍔', go:[
        ['🥗','Cobb salad','veggies + lean protein'],
        ['🌽','Corn on the cob','whole-grain fiber'],
        ['🍎','Apple','fiber keeps you full longer'],
        ['🍗','Grilled chicken','lean protein, not fried']],
      whoa:[
        ['🍔','Double cheeseburger','a saturated-fat overload'],
        ['🍟','Fries','fried AND salty'],
        ['🥤','Soda','it\u2019s basically liquid sugar'],
        ['🍩','Donut','sugar wrapped in fried dough']] },
    { name:'INDIAN 🍛', go:[
        ['🫘','Dal','lentils bring protein + fiber'],
        ['🥬','Saag','iron-rich leafy greens'],
        ['🍗','Tandoori chicken','grilled in the oven, not fried'],
        ['🥒','Raita','cooling probiotic yogurt']],
      whoa:[
        ['🥟','Samosa','deep-fried pastry pocket'],
        ['🫓','Butter naan','refined flour soaked in butter'],
        ['🍬','Jalebi','fried, then dunked in sugar syrup'],
        ['🥛','Sweet lassi','a sugar-loaded drink']] },
    { name:'ITALIAN 🍝', go:[
        ['🍅','Pomodoro','tomatoes are full of lycopene'],
        ['🫒','Olive oil','heart-healthy fats'],
        ['🐟','Grilled fish','lean omega-3s'],
        ['🥗','Caprese','fresh veg + light protein']],
      whoa:[
        ['🍕','Four-cheese pizza','a saturated-fat bomb'],
        ['🍝','Alfredo pasta','cream + butter + cheese'],
        ['🍰','Tiramisu','sugar, cream and more sugar'],
        ['🥖','Garlic bread','white bread soaked in butter']] },
    { name:'FRENCH 🥐', go:[
        ['🍆','Ratatouille','a rainbow of vegetables'],
        ['🥗','Salade niçoise','veg + eggs + fish'],
        ['🦪','Mussels','zinc and lean protein'],
        ['🥣','Vegetable soup','light and filling']],
      whoa:[
        ['🥐','Croissant','layer upon layer of butter'],
        ['🧀','Fondue','a pot of melted cheese'],
        ['🍮','Crème brûlée','cream topped with burnt sugar'],
        ['🍟','Frites','fried and salty']] },
    { name:'JAPANESE 🍱', go:[
        ['🍣','Sashimi','lean fish, big on omega-3'],
        ['🥗','Edamame','fiber-rich soybeans'],
        ['🍲','Miso soup','fermented and low-calorie'],
        ['🥦','Yasai itame','stir-fried veg, light oil']],
      whoa:[
        ['🍤','Tempura','battered and deep-fried'],
        ['🍡','Dango','sweet rice dumplings in syrup'],
        ['🍶','Sweet sake','sugar hides in the sip'],
        ['🍥','Katsu curry','fried cutlet in a rich sauce']] },
    { name:'CHINESE 🥡', go:[
        ['🥬','Stir-fried bok choy','quick-cooked, nutrient-packed'],
        ['🍤','Steamed dumplings','lighter than the fried kind'],
        ['🍵','Oolong tea','unsweetened and antioxidant-rich'],
        ['🍚','Brown rice','whole grain fiber']],
      whoa:[
        ['🍟','Sweet & sour pork','battered, fried, sugary sauce'],
        ['🥠','Fortune cookie','mostly sugar'],
        ['🍜','Fried noodles','oil-soaked carbs'],
        ['🧋','Bubble tea','a sugar bomb in a cup']] },
    { name:'KOREAN 🍲', go:[
        ['🥬','Kimchi','fermented cabbage, gut-friendly'],
        ['🍢','Grilled skewers','lean protein, not fried'],
        ['🍚','Bibimbap veggies','a bowl full of colors'],
        ['🍵','Barley tea','caffeine-free and light']],
      whoa:[
        ['🍗','Korean fried chicken','double-fried & glazed sweet'],
        ['🍢','Tteokbokki','chewy cakes in sugary chili sauce'],
        ['🍺','Sweet soju cocktails','liquid sugar and alcohol'],
        ['🥟','Fried mandu','dumplings deep-fried']] },
    { name:'THAI 🌶️', go:[
        ['🥗','Som tam','shredded papaya salad, low-cal'],
        ['🍲','Tom yum','spicy broth, light on oil'],
        ['🦐','Grilled shrimp skewers','lean protein'],
        ['🥦','Stir-fried greens','quick-cooked veg']],
      whoa:[
        ['🍛','Pad see ew','noodles soaked in oil & sugar'],
        ['🥥','Sticky rice dessert','sugar + coconut fat combo'],
        ['🍤','Fried spring rolls','crispy, oily wrapper'],
        ['🧋','Thai iced tea','sweetened condensed milk overload']] },
    { name:'VIETNAMESE 🍜', go:[
        ['🍲','Pho broth with herbs','light and protein-rich'],
        ['🥗','Fresh spring rolls','rice paper, not fried'],
        ['🐟','Grilled fish','lean and simple'],
        ['🥕','Do chua pickles','crunchy and low-calorie']],
      whoa:[
        ['🥖','Banh mi with pate','a rich fatty spread'],
        ['🍤','Fried spring rolls','crispy fried shell'],
        ['☕','Ca phe sua da','strong coffee, condensed milk sugar'],
        ['🍮','Banh flan','caramel egg custard, sugar-heavy']] },
    { name:'MEXICAN 🌮', go:[
        ['🌮','Grilled fish tacos','lean protein, light toppings'],
        ['🫘','Black beans','fiber and plant protein'],
        ['🥑','Guacamole','healthy fats from avocado'],
        ['🌶️','Salsa fresca','veg-based, low-calorie']],
      whoa:[
        ['🧀','Cheesy nachos','fried chips buried in cheese'],
        ['🌯','Fried chimichanga','a burrito, but deep-fried'],
        ['🍹','Frozen margarita','sugar and alcohol combined'],
        ['🍩','Churros','fried dough rolled in sugar']] },
    { name:'GREEK 🥙', go:[
        ['🥙','Grilled souvlaki','lean meat, simple prep'],
        ['🥗','Greek salad','veg, olive oil, feta'],
        ['🫒','Olives','heart-healthy fats'],
        ['🐙','Grilled octopus','lean seafood protein']],
      whoa:[
        ['🥧','Spanakopita','buttery, flaky pastry layers'],
        ['🍯','Baklava','honey-soaked filo and nuts'],
        ['🧀','Fried saganaki','deep-fried block of cheese'],
        ['🥤','Sweet frappe','sugar-loaded iced coffee']] },
    { name:'SPANISH 🥘', go:[
        ['🐟','Grilled sardines','omega-3 rich'],
        ['🍅','Gazpacho','cold veg soup, refreshing'],
        ['🫒','Olive oil drizzle','good fats'],
        ['🥗','Pan con tomate','simple bread and tomato']],
      whoa:[
        ['🍮','Churros con chocolate','fried dough, sugary dip'],
        ['🥘','Fried croquetas','creamy filling, deep-fried shell'],
        ['🍷','Sangria','wine mixed with added sugar'],
        ['🧀','Fried Manchego bites','cheese battered and fried']] },
    { name:'GERMAN 🥨', go:[
        ['🥗','Light kartoffelsalat','potato salad with vinegar'],
        ['🥬','Sauerkraut','fermented cabbage, probiotic'],
        ['🐟','Grilled fish','lean protein classic'],
        ['🥖','Rye bread','whole grain fiber']],
      whoa:[
        ['🌭','Bratwurst','processed meat, high in fat'],
        ['🥨','Buttery pretzel','refined dough, salty butter'],
        ['🍺','Beer','empty calories add up fast'],
        ['🍰','Black Forest cake','cream, cherries, sugar']] },
    { name:'POLISH 🥟', go:[
        ['🥗','Mizeria','cucumber salad, light and fresh'],
        ['🐟','Grilled fish','lean protein'],
        ['🍲','Barszcz','beet soup, low-calorie'],
        ['🥬','Fermented cabbage','gut-friendly probiotics']],
      whoa:[
        ['🥟','Fried pierogi','dumplings pan-fried in butter'],
        ['🍩','Paczki','deep-fried, jam-filled doughnuts'],
        ['🥓','Kielbasa','fatty processed sausage'],
        ['🍰','Sernik','rich sweet cheesecake']] },
    { name:'TURKISH 🧆', go:[
        ['🧆','Grilled kofte','lean seasoned meat'],
        ['🥗','Cacik','yogurt and cucumber, cool and light'],
        ['🍆','Grilled eggplant','fiber-rich veg'],
        ['🫘','Lentil soup','protein and fiber combo']],
      whoa:[
        ['🥐','Simit','a sesame ring, more bread than it looks'],
        ['🍯','Baklava','honey-soaked filo pastry'],
        ['🍮','Kunefe','cheese pastry drenched in syrup'],
        ['☕','Sweet Turkish coffee','sugar stirred right in']] },
    { name:'LEBANESE 🫓', go:[
        ['🥙','Grilled chicken shawarma','lean protein'],
        ['🥗','Tabbouleh','herbs and bulgur, fiber-rich'],
        ['🫘','Hummus','chickpeas, plant protein'],
        ['🍆','Baba ganoush','roasted eggplant dip']],
      whoa:[
        ['🧀','Fried kibbeh','meat and bulgur, deep-fried shell'],
        ['🍯','Baklava','syrup-soaked pastry layers'],
        ['🫓','Extra-oily falafel','oil-soaked chickpea balls'],
        ['🍮','Sweet muhallabia','milk pudding heavy on sugar']] },
    { name:'MOROCCAN 🍲', go:[
        ['🍲','Vegetable tagine','slow-cooked veg, light oil'],
        ['🥗','Carrot salad','fiber and vitamins'],
        ['🐟','Grilled fish tagine','lean protein'],
        ['🫘','Harira soup','lentils and chickpeas']],
      whoa:[
        ['🥮','Pastilla','flaky pastry, sugar-dusted'],
        ['🍯','Chebakia','fried dough soaked in honey'],
        ['☕','Sweet mint tea','loaded with sugar'],
        ['🍟','Fried merguez','fatty spiced sausage']] },
    { name:'CARIBBEAN 🥥', go:[
        ['🐟','Grilled jerk fish','lean, spiced not fried'],
        ['🥭','Fresh mango salad','vitamins and fiber'],
        ['🫘','Rice and peas','fiber-rich plant protein'],
        ['🥬','Callaloo greens','leafy and iron-rich']],
      whoa:[
        ['🍗','Deep-fried jerk chicken','crispy skin, heavy oil'],
        ['🍞','Fried festival dumplings','fried dough'],
        ['🍹','Rum punch','sugary and alcoholic'],
        ['🥧','Coconut sweet bread','sugar and saturated fat']] },
    { name:'BRAZILIAN 🍖', go:[
        ['🍖','Grilled picanha','lean cut, simple grilling'],
        ['🫘','Light feijoada','beans bring protein and fiber'],
        ['🥗','Salada mista','fresh mixed salad'],
        ['🍊','Fresh fruit plate','vitamins, natural sugar']],
      whoa:[
        ['🧀','Pão de queijo (many)','cheesy fried bread, easy to overeat'],
        ['🍩','Brigadeiro','condensed milk and chocolate fudge'],
        ['🍹','Caipirinha','sugar and alcohol mixed'],
        ['🍟','Fried coxinha','battered, deep-fried chicken']] },
    { name:'BRITISH 🫖', go:[
        ['🐟','Grilled fish','lean protein classic'],
        ['🥗','Garden salad','fresh veg'],
        ['🍲','Vegetable soup','light and filling'],
        ['🫘','Low-sugar baked beans','fiber and protein']],
      whoa:[
        ['🍟','Fish and chips','battered and deep-fried'],
        ['🥧','Meat pie','pastry crust, heavy fat'],
        ['🍰','Sticky toffee pudding','sugar-soaked sponge cake'],
        ['☕','Full English fry-up','a plate of fried everything']] },
  ];


  function buildStage(dateStr) {
    const SW = sha256Words('pyramid-' + dateStr);
  const cuisine = CUISINES[Math.floor(mulberry32(SW[1])() * CUISINES.length)];
  // Every stage used to be exactly (590-26)x24 px — the same length, the same
  // two bridges, the same five ramps, every single day. Only the shape changed.
  // From VARIETY_FROM the seed decides the distance and the furniture too, so
  // some days are a 3km sprint and some are a 5km slog. Older dates keep the
  // old numbers exactly, so their stored results and replays still line up.
  const VARIETY_FROM = '2026-07-22';
  const varied = dateStr >= VARIETY_FROM;
  const STEP = 24;
  const NPTS = varied ? 450 + Math.floor(mulberry32(SW[6] ^ 0x5eed)() * 341) : 600;
  const START_I = 26, FINISH_I = NPTS - 10;
  const STAGE_PX = (FINISH_I - START_I) * STEP;
  // how many of each thing this stage gets
  const COUNTS = (() => {
    if (!varied) return { bridges: 2, ramps: 5, waters: 2 };
    const r = mulberry32(SW[7] ^ 0x1eaf);
    const scale = STAGE_PX / 13536;            // relative to the old fixed length
    return {
      bridges: Math.max(1, Math.min(3, Math.round((1 + Math.floor(r() * 3)) * scale))),
      ramps: Math.max(2, Math.round((3 + Math.floor(r() * 5)) * scale)),
      waters: Math.max(1, Math.min(3, Math.round((1 + Math.floor(r() * 3)) * scale))),
    };
  })();
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
    for (let b = 0; b < COUNTS.bridges; b++){
      const s = Math.floor(START_I + 60 + r() * (FINISH_I - START_I - 170));
      bridges.push([s, s + 26 + Math.floor(r() * 14)]);
    }
    bridges.sort((a, b) => a[0] - b[0]);
    // push overlapping spans apart, and drop any that no longer fit
    for (let b = 1; b < bridges.length; b++){
      if (bridges[b][0] < bridges[b - 1][1] + 30){
        const len = bridges[b][1] - bridges[b][0];
        bridges[b][0] = bridges[b - 1][1] + 40;
        bridges[b][1] = bridges[b][0] + len;
      }
    }
    while (bridges.length && bridges[bridges.length - 1][1] > FINISH_I - 25) bridges.pop();
    let tries = 0;
    while (ramps.length < COUNTS.ramps && tries++ < 80 + COUNTS.ramps * 16){
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


  // ============ foods (seeded, themed) ============
  const foods = []; // {x,y,def:[emoji,name,fact],go:bool,eaten}
  {
    const r = mulberry32(SW[4]);
    let i = START_I + 14;
    while (i < FINISH_I - 12){
      i += 5 + Math.floor(r() * 7);
      if (i >= FINISH_I - 12) break;
      const [px, py] = pts[i], [nx, ny] = normals[i], w = widths[i];
      if (r() < 0.12 && w > 70){
        // WHOA wall: junk across the road with one gap — squeeze through!
        const gapLane = Math.floor(r() * 3) - 1; // -1,0,1
        for (let lane = -1; lane <= 1; lane++){
          if (lane === gapLane) continue;
          const off = lane * w * 0.62;
          const def = cuisine.whoa[Math.floor(r() * 4)];
          foods.push({ x: px + nx * off, y: py + ny * off, def, go: false, eaten: false });
        }
        i += 3;
      } else if (r() < 0.26){
        // single WHOA food sitting right on the racing line (tempting!)
        const off = (r() - 0.5) * w * 0.5;
        const def = cuisine.whoa[Math.floor(r() * 4)];
        foods.push({ x: px + nx * off, y: py + ny * off, def, go: false, eaten: false });
      } else {
        // GO food, slightly off the racing line — worth the detour
        const side = r() < 0.5 ? -1 : 1;
        const off = side * w * (0.55 + r() * 0.3);
        const def = cuisine.go[Math.floor(r() * 4)];
        foods.push({ x: px + nx * off, y: py + ny * off, def, go: true, eaten: false });
      }
    }
  }

  // water shields: grab one → junk-proof for 3 seconds
  const waters = [];
  {
    const r = mulberry32(SW[5]);
    let placed = 0, tries = 0;
    while (placed < COUNTS.waters && tries++ < 40 + COUNTS.waters * 20){
      const i = Math.floor(START_I + 50 + r() * (FINISH_I - START_I - 90));
      if (bridges.some(([a, b]) => i > a - 6 && i < b + 6)) continue;
      const [px, py] = pts[i], [nx, ny] = normals[i], w = widths[i];
      const off = (r() * 2 - 1) * w * 0.5;
      waters.push({ x: px + nx * off, y: py + ny * off, taken: false });
      placed++;
    }
  }


  const decor = [], patches = [];
  {
    const r = mulberry32(SW[7]);
    const flora = ['🌲','🌳','🌳','🌲','🌲','🌼','🪨','🍄','🌻','🌾'];
    const coarse = [];
    for (let i = 0; i < NPTS; i += 4) coarse.push(pts[i]);
    function clearOfRoad(x, y, min){
      for (const [px, py] of coarse){
        const dx = px - x, dy = py - y;
        if (dx*dx + dy*dy < min*min) return false;
      }
      return true;
    }
    // clearOfRoad() is a fast coarse filter against a fixed radius; this is the
    // exact test — the road varies from 1 to 3 lanes wide and can loop past.
    function onAnyRoad(x, y, margin){
      for (let i = 0; i < NPTS; i++){
        const dx = pts[i][0] - x, dy = pts[i][1] - y;
        const lim = widths[i] + margin;
        if (dx * dx + dy * dy < lim * lim) return true;
      }
      return false;
    }
    for (let i = 6; i < NPTS - 4; i += 3){
      const [px, py] = pts[i], [nx, ny] = normals[i], w = widths[i];
      for (const side of [-1, 1]){
        if (r() < 0.5) continue;
        const off = side * (w + 55 + r() * 300);
        const x = px + nx * off, y = py + ny * off;
        if (!clearOfRoad(x, y, 165) || onAnyRoad(x, y, 12)) continue;
        decor.push({ x, y, e: flora[Math.floor(r() * flora.length)], s: 20 + r() * 18 });
      }
      if (r() < 0.25){
        const side = r() < 0.5 ? -1 : 1;
        const off = side * (w + 40 + r() * 380);
        const x = px + nx * off, y = py + ny * off;
        if (clearOfRoad(x, y, 175) && !onAnyRoad(x, y, 12)) patches.push({ x, y, r: 45 + r() * 85 });
      }
    }
    // ducks paddle beside the bridge — but never on a road
    for (const [a, b] of bridges){
      let placed = 0;
      for (let k = 0; k < 24 && placed < 3; k++){
        const i = a + Math.floor(r() * Math.max(b - a, 1));
        const [px, py] = pts[i], [nx, ny] = normals[i], w = widths[i];
        const off = (r() < 0.5 ? -1 : 1) * (w + 45 + r() * 70);
        const x = px + nx * off, y = py + ny * off;
        if (onAnyRoad(x, y, 15)) continue;
        decor.push({ x, y, e: '🦆', s: 18 });
        placed++;
      }
    }
  }

  const PACE = { gold: 386.74, silver: 314.79, bronze: 241.71, dnf: 180.48 }; // px/s
  const PAR = varied
    ? { gold: Math.round(STAGE_PX / PACE.gold),
        silver: Math.round(STAGE_PX / PACE.silver),
        bronze: Math.round(STAGE_PX / PACE.bronze) }
    : { gold: 35, silver: 43, bronze: 56 };
  const DNF_AT = varied ? Math.round(STAGE_PX / PACE.dnf) : 75;


    return { pts, widths, normals, bridges, ramps, foods, stones, decor, patches, waters,
             cuisine, NPTS, STEP, START_I, FINISH_I, STAGE_PX, COUNTS, SW };
  }

  root.buildStage = buildStage;
  root.sha256Words = sha256Words;
  root.mulberry32 = mulberry32;
})(typeof window !== 'undefined' ? (window.FPRStage = window.FPRStage || {}) : module.exports);
