/*  auth.js — Google Sign-In verification + stateless sessions.

    Kept separate from server.js so it can be unit-tested in isolation with a
    fake JWKS endpoint (Google's real certs aren't reachable from CI).

    We verify the ID token ourselves rather than trusting anything the browser
    sends: RS256 signature against Google's published keys, plus issuer,
    audience and expiry checks. */

const crypto = require('crypto');

let CLIENT_ID = null;
let SESSION_SECRET = crypto.randomBytes(32); // replaced by configure()
let JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';

function configure({ clientId, sessionSecret, jwksUrl } = {}) {
  CLIENT_ID = clientId || null;
  if (sessionSecret) SESSION_SECRET = Buffer.from(sessionSecret);
  if (jwksUrl) JWKS_URL = jwksUrl;
}
function enabled() { return !!CLIENT_ID; }

// ---------- JWKS cache ----------
let jwksCache = { keys: [], fetchedAt: 0, ttl: 3600e3 };
let lastMissFetch = 0;

async function fetchJwks() {
  const r = await fetch(JWKS_URL);
  if (!r.ok) throw new Error('jwks fetch failed: ' + r.status);
  const j = await r.json();
  let ttl = 3600e3;
  const cc = r.headers && typeof r.headers.get === 'function' ? r.headers.get('cache-control') : null;
  if (cc) {
    const m = /max-age=(\d+)/.exec(cc);
    if (m) ttl = Math.max(300e3, Math.min(86400e3, parseInt(m[1], 10) * 1000));
  }
  jwksCache = { keys: j.keys || [], fetchedAt: Date.now(), ttl };
  return jwksCache.keys;
}

async function keyForKid(kid) {
  const fresh = Date.now() - jwksCache.fetchedAt < jwksCache.ttl;
  if (!fresh || !jwksCache.keys.length) await fetchJwks();
  let jwk = jwksCache.keys.find(k => k.kid === kid);
  if (!jwk && Date.now() - lastMissFetch > 60e3) {
    // unknown kid: Google may have rotated keys — refetch at most once a minute
    lastMissFetch = Date.now();
    await fetchJwks();
    jwk = jwksCache.keys.find(k => k.kid === kid);
  }
  if (!jwk) throw new Error('unknown signing key');
  return crypto.createPublicKey({ key: jwk, format: 'jwk' });
}

// ---------- ID token verification ----------
const SKEW = 300; // seconds of tolerated clock drift

async function verifyIdToken(token) {
  if (!CLIENT_ID) throw new Error('auth not configured');
  if (typeof token !== 'string' || token.length > 4096) throw new Error('bad token');
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('malformed token');

  let header, payload;
  try {
    header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch { throw new Error('malformed token'); }

  if (header.alg !== 'RS256') throw new Error('unsupported alg');
  if (!header.kid) throw new Error('missing kid');

  const key = await keyForKid(header.kid);
  const sig = Buffer.from(parts[2], 'base64url');
  const ok = crypto.verify('RSA-SHA256', Buffer.from(parts[0] + '.' + parts[1]), key, sig);
  if (!ok) throw new Error('bad signature');

  const now = Math.floor(Date.now() / 1000);
  const iss = payload.iss;
  if (iss !== 'accounts.google.com' && iss !== 'https://accounts.google.com') throw new Error('bad issuer');
  if (payload.aud !== CLIENT_ID) throw new Error('bad audience');
  if (typeof payload.exp !== 'number' || payload.exp + SKEW < now) throw new Error('token expired');
  if (typeof payload.iat === 'number' && payload.iat - SKEW > now) throw new Error('token from the future');
  if (!payload.sub) throw new Error('missing subject');

  return {
    sub: String(payload.sub),
    name: typeof payload.name === 'string' ? payload.name : '',
  };
}

// ---------- stateless sessions ----------
// token = base64url(JSON payload) + "." + base64url(HMAC-SHA256)
// Survives server restarts (no session store), which matters on a free tier
// instance that sleeps constantly.
const SESSION_DAYS = 60;

function sign(dataB64) {
  return crypto.createHmac('sha256', SESSION_SECRET).update(dataB64).digest('base64url');
}
function makeSession(sub) {
  const payload = { u: String(sub), e: Date.now() + SESSION_DAYS * 86400e3 };
  const b64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return b64 + '.' + sign(b64);
}
function readSession(token) {
  if (typeof token !== 'string' || token.length > 1024) return null;
  const i = token.lastIndexOf('.');
  if (i <= 0) return null;
  const b64 = token.slice(0, i), mac = token.slice(i + 1);
  const expect = sign(b64);
  const a = Buffer.from(mac), b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let payload;
  try { payload = JSON.parse(Buffer.from(b64, 'base64url').toString('utf8')); } catch { return null; }
  if (!payload || typeof payload.u !== 'string') return null;
  if (typeof payload.e !== 'number' || payload.e < Date.now()) return null;
  return { sub: payload.u };
}

module.exports = { configure, enabled, verifyIdToken, makeSession, readSession, _fetchJwks: fetchJwks };
