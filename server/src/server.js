'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { createPool, migrate } = require('./db');
const auth = require('./auth');
const sync = require('./sync');

const APP_DIR = path.resolve(process.env.APP_DIR || path.join(__dirname, '..', '..'));
const STATIC_FILES = new Set(['index.html', 'sw.js', 'manifest.json', 'version.json',
  'icon-192.png', 'icon-512.png', 'icon-maskable-512.png']);
const NO_CACHE = new Set(['index.html', 'sw.js', 'version.json', 'manifest.json']);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png' };
const MAX_BODY = Number(process.env.MAX_BODY_BYTES || 25 * 1024 * 1024);
const CORS_ORIGINS = String(process.env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

function send(res, status, body, headers = {}) {
  const json = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(json);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > MAX_BODY) { reject(new HttpError(413, 'request too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new HttpError(400, 'invalid JSON')); }
    });
    req.on('error', reject);
  });
}

function securityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
}

function cors(req, res) {
  const origin = req.headers.origin;
  if (origin && CORS_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Max-Age', '600');
  }
}

function serveStatic(req, res, pathname) {
  const name = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  if (!STATIC_FILES.has(name)) return send(res, 404, { error: 'not found' });
  const file = path.join(APP_DIR, name);
  fs.stat(file, (err, st) => {
    if (err) return send(res, 404, { error: 'not found' });
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(name)] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': NO_CACHE.has(name) ? 'no-cache' : 'public, max-age=86400',
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

function clientIp(req) {
  const fwd = process.env.TRUST_PROXY ? String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() : '';
  return fwd || req.socket.remoteAddress || '';
}

function createApp(pool) {
  async function requireUser(req) {
    const u = await auth.authenticate(pool, req);
    if (!u) throw new HttpError(401, 'login required');
    return u;
  }

  const routes = {
    'GET /api/health': async () => {
      await pool.query('select 1');
      return { ok: true, time: new Date().toISOString() };
    },

    'POST /api/auth/login': async req => {
      const body = await readJson(req);
      const username = auth.normUser(body.username);
      const key = `${clientIp(req)}|${username}`;
      if (!username || !body.password) throw new HttpError(400, 'username and password required');
      if (auth.loginBlocked(key)) throw new HttpError(429, 'too many attempts; wait 15 minutes');
      const u = (await pool.query('select * from users where username = $1 and active', [username])).rows[0];
      const check = u ? await auth.verifyPassword(u, body.password) : { ok: false };
      if (!check.ok) { auth.loginFailed(key); throw new HttpError(401, 'invalid username or password'); }
      auth.loginSucceeded(key);
      if (check.upgrade) {
        await pool.query('update users set pw_scrypt = $2, updated_at = now() where id = $1',
          [u.id, await auth.hashPassword(body.password)]);
      }
      const token = await auth.createSession(pool, u.id, req.headers['user-agent']);
      return { token, user: auth.publicUser(u) };
    },

    'POST /api/auth/logout': async req => {
      const u = await auth.authenticate(pool, req);
      if (u) await pool.query('delete from sessions where token_hash = $1', [u.token_hash]);
      return { ok: true };
    },

    'GET /api/auth/me': async req => ({ user: auth.publicUser(await requireUser(req)) }),

    'GET /api/sync': async (req, url) => {
      await requireUser(req);
      return sync.pull(pool, url.searchParams.get('since'), url.searchParams.get('limit'));
    },

    'POST /api/sync': async req => {
      const u = await requireUser(req);
      const body = await readJson(req);
      return sync.push(pool, u, body.changes, { confirmBulkDelete: body.confirmBulkDelete === true });
    },

    'GET /api/admin/events': async (req, url) => {
      const u = await requireUser(req);
      if (!auth.isAdmin(u)) throw new HttpError(403, 'admin only');
      const lim = Math.min(Number(url.searchParams.get('limit')) || 100, 500);
      return { events: (await pool.query('select * from sync_events order by at desc limit $1', [lim])).rows };
    },
  };

  return async function handler(req, res) {
    securityHeaders(res);
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname.startsWith('/api/')) {
        cors(req, res);
        if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
        const route = routes[`${req.method} ${url.pathname}`];
        if (!route) throw new HttpError(404, 'not found');
        return send(res, 200, await route(req, url));
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'method not allowed');
      return serveStatic(req, res, url.pathname);
    } catch (e) {
      if (e instanceof HttpError) return send(res, e.status, { error: e.message });
      if (e instanceof sync.Reject) return send(res, 400, { error: e.message });
      console.error(new Date().toISOString(), req.method, url.pathname, e);
      return send(res, 500, { error: 'server error' });
    }
  };
}

async function start() {
  const pool = createPool();
  const applied = await migrate(pool);
  if (applied.length) console.log('migrations applied:', applied.join(', '));
  await bootstrapAdmin(pool);
  const port = Number(process.env.PORT || 8080);
  const server = http.createServer(createApp(pool));
  server.listen(port, () => console.log(`swamijet server on :${port}, app from ${APP_DIR}`));
  const stop = () => server.close(() => pool.end().then(() => process.exit(0)));
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

// First run only: create an admin login from BOOTSTRAP_ADMIN_USER / BOOTSTRAP_ADMIN_PASSWORD when no users exist.
async function bootstrapAdmin(pool) {
  const n = Number((await pool.query('select count(*) from users')).rows[0].count);
  const user = auth.normUser(process.env.BOOTSTRAP_ADMIN_USER), pw = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  if (n > 0 || !user || !pw) return;
  if (String(pw).length < 8) throw new Error('BOOTSTRAP_ADMIN_PASSWORD must be at least 8 characters');
  await pool.query(`insert into users(username, name, role, pw_scrypt) values ($1, 'Admin', 'Admin', $2)`,
    [user, await auth.hashPassword(pw)]);
  console.log(`bootstrap admin "${user}" created`);
}

if (require.main === module) start().catch(e => { console.error(e); process.exit(1); });

module.exports = { createApp, bootstrapAdmin };
