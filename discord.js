/*  discord.js — posts the leaderboard to a Discord channel via a webhook.

    Why a webhook and not a gateway bot: this game runs happily on a free tier
    that sleeps after a few idle minutes. A gateway bot would spend its life
    reconnecting; a webhook is a plain outbound POST, so it works whenever the
    server happens to be awake and costs nothing when it isn't.

    Two kinds of message:
      • a LIVE message for today, edited in place as times come in, so the
        channel gets one self-updating scoreboard instead of a stream of spam
      • a FINAL message when a stage closes, with the finished podium and the
        championship standings

    All state lives in a plain object owned by the caller, so it can be
    persisted with the leaderboards and survive restarts. */

const MIN_UPDATE_MS = 20000; // Discord allows ~30 webhook calls/min; stay well under

let URL_ = null, SITE = '';
let state = null;                 // { liveDate, liveId, liveSig, posted: {date:true} }
let timer = null, pending = null; // debounce
let failures = 0;

function configure({ url, site, siteUrl } = {}) {
  URL_ = url || null;
  SITE = siteUrl || site || '';
  failures = 0;
}
function enabled() { return !!URL_ && failures < 5; }
function attach(s) {
  state = s || {};
  if (!state.posted) state.posted = {};
  return state;
}

function fmt(ms) { return (ms / 1000).toFixed(2) + 's'; }
function medal(i) { return ['🥇', '🥈', '🥉'][i] || '`' + String(i + 1).padStart(2, ' ') + '.`'; }

function board(entries, limit) {
  if (!entries.length) return '_no times yet_';
  return entries.slice(0, limit).map((e, i) =>
    `${medal(i)} **${clean(e.n)}**${e.u ? ' ✓' : ''} — ${fmt(e.t)}`).join('\n');
}
// Discord renders markdown and pings; neutralise both (names are user input)
function clean(s) {
  return String(s == null ? '' : s)
    .replace(/[\\*_`~|>]/g, '')
    .replace(/@(everyone|here)/gi, '@\u200bevery1')
    .slice(0, 32);
}

function liveEmbed(stage, entries, total) {
  return {
    title: `🏁 ${stage.label}`,
    url: SITE || undefined,
    description: board(entries, 10),
    color: 0x2fae4e,
    footer: { text: `${total} driver${total === 1 ? '' : 's'} today · updates live · stage closes at midnight UTC` },
    timestamp: new Date().toISOString(),
  };
}
function finalEmbed(stage, entries, total, standings, monthLabel) {
  const fields = [];
  if (standings && standings.length) {
    fields.push({
      name: `🏆 ${monthLabel} championship`,
      value: standings.slice(0, 5).map((s, i) =>
        `${medal(i)} **${clean(s.n)}** — ${s.pts} pts`).join('\n'),
    });
  }
  return {
    title: `🏆 ${stage.label} — final results`,
    url: SITE ? `${SITE}/day?d=${stage.date}` : undefined,
    description: board(entries, 10),
    color: 0xff8c2e,
    fields,
    footer: { text: `${total} driver${total === 1 ? '' : 's'} took part · full results on the site` },
    timestamp: new Date().toISOString(),
  };
}

async function send(embed) {
  const r = await fetch(URL_ + '?wait=true', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ embeds: [embed] }),
  });
  if (!r.ok) throw new Error('discord post failed: ' + r.status);
  const j = await r.json().catch(() => ({}));
  return j && j.id ? String(j.id) : null;
}
async function edit(id, embed) {
  const r = await fetch(`${URL_}/messages/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ embeds: [embed] }),
  });
  if (!r.ok) throw new Error('discord edit failed: ' + r.status);
}

// ---- live scoreboard for the day in progress ----
async function pushLive(stage, entries, total) {
  if (!enabled()) return;
  const sig = entries.slice(0, 10).map(e => e.n + ':' + e.t).join('|');
  try {
    if (state.liveDate !== stage.date || !state.liveId) {
      const id = await send(liveEmbed(stage, entries, total));
      state.liveDate = stage.date;
      state.liveId = id;
      state.liveSig = sig;
    } else {
      if (state.liveSig === sig) return; // nothing actually changed
      await edit(state.liveId, liveEmbed(stage, entries, total));
      state.liveSig = sig;
    }
    failures = 0;
  } catch (e) {
    failures++;
    if (failures >= 5) console.log('  Discord: giving up after repeated failures —', e.message);
  }
}

// debounced entry point: call as often as you like
function scheduleLive(getPayload) {
  if (!enabled()) return;
  pending = getPayload;
  if (timer) return;
  timer = setTimeout(async () => {
    timer = null;
    const p = pending; pending = null;
    if (!p) return;
    const { stage, entries, total } = p();
    await pushLive(stage, entries, total);
  }, MIN_UPDATE_MS);
}
async function flushLive() { // for tests and shutdown
  if (timer) { clearTimeout(timer); timer = null; }
  const p = pending; pending = null;
  if (!p || !enabled()) return;
  const { stage, entries, total } = p();
  await pushLive(stage, entries, total);
}

// ---- final results once a stage has closed ----
async function postFinal(stage, entries, total, standings, monthLabel) {
  if (!enabled() || state.posted[stage.date]) return false;
  try {
    await send(finalEmbed(stage, entries, total, standings, monthLabel));
    state.posted[stage.date] = true;
    if (state.liveDate === stage.date) { state.liveId = null; state.liveDate = null; state.liveSig = null; }
    // keep the ledger small
    const keys = Object.keys(state.posted).sort();
    while (keys.length > 60) delete state.posted[keys.shift()];
    failures = 0;
    return true;
  } catch (e) {
    failures++;
    return false;
  }
}
function alreadyPosted(date) { return !!(state && state.posted && state.posted[date]); }
function markPosted(date) { if (state) state.posted[date] = true; }

module.exports = {
  configure, enabled, attach, scheduleLive, flushLive, postFinal,
  alreadyPosted, markPosted, clean, MIN_UPDATE_MS,
};
