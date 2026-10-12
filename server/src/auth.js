'use strict';
const crypto = require('crypto');

const ADMIN_ROLES = ['owner', 'director', 'admin', 'superadmin'];
const SESSION_DAYS = Number(process.env.SESSION_DAYS || 30);

const isAdmin = u => !!u && (u.system || ADMIN_ROLES.includes(String(u.role || '').toLowerCase()));
const isAccountant = u => !!u && String(u.role || '').toLowerCase() === 'accountant';
const normUser = s => String(s || '').trim().toLowerCase();
const sha256Hex = s => crypto.createHash('sha256').update(String(s)).digest('hex');
const isLegacyHash = s => /^[0-9a-f]{64}$/i.test(String(s || ''));

function scrypt(pw, salt, n, r, p) {
  return new Promise((resolve, reject) =>
    crypto.scrypt(pw, salt, 64, { N: n, r, p, maxmem: 64 * 1024 * 1024 }, (e, k) => (e ? reject(e) : resolve(k))));
}

async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(String(pw).trim(), salt, 16384, 8, 1);
  return `scrypt$16384$8$1$${salt.toString('base64')}$${key.toString('base64')}`;
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// -> { ok, upgrade }  upgrade = true when the legacy app hash matched and should become scrypt
async function verifyPassword(user, pw) {
  const typed = String(pw || '').trim();
  if (!typed) return { ok: false };
  if (user.pw_scrypt) {
    const [, n, r, p, salt, hash] = user.pw_scrypt.split('$');
    const key = await scrypt(typed, Buffer.from(salt, 'base64'), Number(n), Number(r), Number(p));
    return { ok: safeEqual(key.toString('base64'), hash) };
  }
  if (user.pw_legacy_sha256) return { ok: safeEqual(sha256Hex(typed), user.pw_legacy_sha256.toLowerCase()), upgrade: true };
  return { ok: false };
}

async function createSession(db, userId, userAgent) {
  const token = crypto.randomBytes(32).toString('base64url');
  await db.query(
    `insert into sessions(token_hash, user_id, expires_at, user_agent)
     values ($1, $2, now() + make_interval(days => $3), $4)`,
    [sha256Hex(token), userId, SESSION_DAYS, String(userAgent || '').slice(0, 200)]);
  return token;
}

// Bearer token -> active user row, or null.
async function authenticate(db, req) {
  const m = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization || '');
  if (!m) return null;
  const { rows } = await db.query(
    `select u.*, s.token_hash, s.last_seen_at from sessions s join users u on u.id = s.user_id
      where s.token_hash = $1 and s.expires_at > now() and u.active`, [sha256Hex(m[1])]);
  if (!rows.length) return null;
  const u = rows[0];
  if (Date.now() - new Date(u.last_seen_at).getTime() > 5 * 60 * 1000) {
    db.query('update sessions set last_seen_at = now() where token_hash = $1', [u.token_hash]).catch(() => {});
  }
  return u;
}

// Failed-login limiter: 10 failures per username+IP per 15 minutes.
const failures = new Map();
const WINDOW_MS = 15 * 60 * 1000, MAX_FAILS = 10;
function loginBlocked(key) {
  const f = failures.get(key);
  if (!f) return false;
  if (Date.now() - f.first > WINDOW_MS) { failures.delete(key); return false; }
  return f.count >= MAX_FAILS;
}
function loginFailed(key) {
  const f = failures.get(key);
  if (!f || Date.now() - f.first > WINDOW_MS) failures.set(key, { count: 1, first: Date.now() });
  else f.count++;
}
const loginSucceeded = key => failures.delete(key);

const publicUser = u => ({ userId: String(u.id), memberId: u.member_id, username: u.username, name: u.name, role: u.role });

module.exports = {
  ADMIN_ROLES, isAdmin, isAccountant, normUser, sha256Hex, isLegacyHash,
  hashPassword, verifyPassword, createSession, authenticate,
  loginBlocked, loginFailed, loginSucceeded, publicUser,
};
