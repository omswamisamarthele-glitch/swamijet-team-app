'use strict';
// API tests against a real PostgreSQL. TEST_DATABASE_URL must point at a database whose
// name ends in _test; every table in it is dropped first.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const crypto = require('crypto');
const { createPool, migrate } = require('../src/db');
const { createApp } = require('../src/server');

const URL_ = process.env.TEST_DATABASE_URL;
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
let pool, server, base;

async function api(method, path, body, token) {
  const r = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}
const login = async (u, p) => (await api('POST', '/api/auth/login', { username: u, password: p })).body?.token;
const push = (token, changes, extra = {}) => api('POST', '/api/sync', { changes, ...extra }, token);
const t0 = '2026-10-12T00:00:00.000Z', later = '2026-10-12T01:00:00.000Z';

test.before(async () => {
  if (!URL_ || !/_test(\?|$)/.test(new URL(URL_).pathname)) throw new Error('TEST_DATABASE_URL must name a *_test database');
  pool = createPool(URL_);
  await pool.query('drop schema public cascade; create schema public;');
  await migrate(pool);
  const { hashPassword } = require('../src/auth');
  await pool.query(`insert into users(username, name, role, pw_scrypt) values ('boss', 'Boss', 'Admin', $1)`, [await hashPassword('BossPass#1')]);
  server = http.createServer(createApp(pool)).listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => { server.close(); await pool.end(); });

test('API needs a login; static app is served', async () => {
  assert.equal((await api('GET', '/api/sync?since=0')).status, 401);
  assert.equal((await api('POST', '/api/sync', { changes: [] }, 'bogus')).status, 401);
  const r = await fetch(base + '/');
  assert.equal(r.status, 200);
  assert.match(await r.text(), /SwamiJet/);
  assert.equal((await fetch(base + '/server/src/server.js')).status, 404);
  assert.equal((await fetch(base + '/../.env')).status, 404);
});

test('wrong password refused; right one logs in', async () => {
  assert.equal((await api('POST', '/api/auth/login', { username: 'boss', password: 'nope' })).status, 401);
  const r = await api('POST', '/api/auth/login', { username: 'BOSS ', password: 'BossPass#1' });
  assert.equal(r.status, 200);
  assert.equal(r.body.user.role, 'Admin');
});

test('team records create logins; passwords never stored in records', async () => {
  const admin = await login('boss', 'BossPass#1');
  const r = await push(admin, [
    { module: 'team', id: '101', data: { id: 101, name: 'Tech', role: 'Technician', username: 'Tech', password: sha('tech-pass'), active: true, _up: t0 } },
    { module: 'team', id: '102', data: { id: 102, name: 'Acc', role: 'Accountant', username: 'acc', password: 'acc-pass-1', active: true, _up: t0 } },
  ]);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.results.map(x => x.status), ['applied', 'applied']);
  const rows = (await pool.query(`select data from records where module='team'`)).rows;
  assert.ok(rows.every(x => !('password' in x.data)), 'password stored in record');
  const pulled = await api('GET', '/api/sync?since=0', null, admin);
  assert.ok(pulled.body.changes.every(c => !('password' in c.data)), 'password sent to clients');

  // legacy SHA-256 login works and is upgraded to scrypt
  const tech = await login('tech', 'tech-pass');
  assert.ok(tech, 'legacy hash login failed');
  const u = (await pool.query(`select pw_scrypt from users where username='tech'`)).rows[0];
  assert.ok(u.pw_scrypt, 'not upgraded');
  assert.ok(await login('tech', 'tech-pass'), 'login after upgrade failed');
  assert.equal(await login('tech', sha('tech-pass')), undefined, 'hash accepted as password');
  assert.ok(await login('acc', 'acc-pass-1'), 'plain password login failed');

  // re-sending the old hash (unchanged copy) does not undo the upgraded password
  await push(admin, [{ module: 'team', id: '101', baseVersion: 1, data: { id: 101, name: 'Tech', role: 'Technician', username: 'tech', password: sha('tech-pass'), active: true, _up: later } }]);
  assert.ok(await login('tech', 'tech-pass'));
});

test('a password-only change is applied', async () => {
  const admin = await login('boss', 'BossPass#1');
  const cur = (await pool.query(`select version, data from records where module='team' and id='101'`)).rows[0];
  const r = await push(admin, [{ module: 'team', id: '101', baseVersion: cur.version, data: { ...cur.data, password: 'brand-new-pw' } }]);
  assert.equal(r.body.results[0].status, 'applied');
  assert.ok(await login('tech', 'brand-new-pw'), 'new password not applied');
  assert.equal(await login('tech', 'tech-pass'), undefined, 'old password still works');
  const back = await push(admin, [{ module: 'team', id: '101', baseVersion: r.body.results[0].record.version, data: { ...cur.data, password: 'tech-pass' } }]);
  assert.equal(back.body.results[0].status, 'applied');
});

test('staff: own profile only, cannot change role, cannot touch salary', async () => {
  const tech = await login('tech', 'tech-pass');
  const cur = (await pool.query(`select version from records where module='team' and id='101'`)).rows[0].version;
  const own = await push(tech, [{ module: 'team', id: '101', baseVersion: cur, data: { id: 101, name: 'Tech Renamed', role: 'Admin', username: 'tech', active: true, _up: later } }]);
  assert.equal(own.body.results[0].status, 'applied');
  assert.equal(own.body.results[0].record.data.role, 'Technician', 'staff changed own role');
  assert.equal(own.body.results[0].record.data.name, 'Tech Renamed');
  const other = await push(tech, [{ module: 'team', id: '102', data: { id: 102, name: 'x', _up: later } }]);
  assert.equal(other.body.results[0].status, 'rejected');
  const sal = await push(tech, [{ module: 'salaryPayments', id: 's1', data: { id: 's1', amount: 1 } }]);
  assert.equal(sal.body.results[0].status, 'rejected');
  const acc = await login('acc', 'acc-pass-1');
  assert.equal((await push(acc, [{ module: 'salaryPayments', id: 's1', data: { id: 's1', amount: 1 } }])).body.results[0].status, 'applied');
});

test('deactivated member is signed out and cannot log in', async () => {
  const admin = await login('boss', 'BossPass#1');
  const acc = await login('acc', 'acc-pass-1');
  const v = (await pool.query(`select version from records where module='team' and id='102'`)).rows[0].version;
  await push(admin, [{ module: 'team', id: '102', baseVersion: v, data: { id: 102, name: 'Acc', role: 'Accountant', username: 'acc', active: false, _up: later } }]);
  assert.equal((await api('GET', '/api/sync?since=0', null, acc)).status, 401);
  assert.equal(await login('acc', 'acc-pass-1'), undefined);
});

test('two devices editing different records never clash; stale edit of same record is rejected', async () => {
  const admin = await login('boss', 'BossPass#1');
  const a = await push(admin, [
    { module: 'attendance', id: 'a1', data: { id: 'a1', note: 'v1', _up: t0 } },
    { module: 'attendance', id: 'a2', data: { id: 'a2', note: 'v1', _up: t0 } },
  ]);
  const v1 = a.body.results[0].record.version;
  // device A edits a1, device B edits a2 (both from version 1)
  await push(admin, [{ module: 'attendance', id: 'a1', baseVersion: v1, data: { id: 'a1', note: 'A', _up: later } }]);
  await push(admin, [{ module: 'attendance', id: 'a2', baseVersion: v1, data: { id: 'a2', note: 'B', _up: later } }]);
  const notes = (await pool.query(`select id, data->>'note' n from records where module='attendance' order by id`)).rows.map(r => r.n);
  assert.deepEqual(notes, ['A', 'B']);
  // device B still thinks a1 is at v1 and sends an older copy
  const stale = await push(admin, [{ module: 'attendance', id: 'a1', baseVersion: v1, data: { id: 'a1', note: 'old', _up: t0 } }]);
  assert.equal(stale.body.results[0].status, 'rejected');
  assert.equal(stale.body.results[0].record.data.note, 'A', 'server copy not returned');
  const ev = (await pool.query(`select count(*) from sync_events where kind='conflict-rejected'`)).rows[0].count;
  assert.equal(Number(ev), 1);
});

test('history keeps every overwritten version', async () => {
  const h = (await pool.query(`select data->>'note' n from records_history where module='attendance' and id='a1' order by hid`)).rows.map(r => r.n);
  assert.deepEqual(h, ['v1']);
});

test('pull is incremental and paged', async () => {
  const admin = await login('boss', 'BossPass#1');
  const all = await api('GET', '/api/sync?since=0', null, admin);
  const since = all.body.nextSince;
  await push(admin, [{ module: 'notices', id: 'n1', data: { id: 'n1', title: 'hi' } }]);
  const delta = await api('GET', `/api/sync?since=${since}`, null, admin);
  assert.deepEqual(delta.body.changes.map(c => c.id), ['n1']);
  const paged = await api('GET', '/api/sync?since=0&limit=2', null, admin);
  assert.equal(paged.body.changes.length, 2);
  assert.equal(paged.body.more, true);
});

test('wipe guard blocks deleting most of a module in one request', async () => {
  const admin = await login('boss', 'BossPass#1');
  const recs = Array.from({ length: 20 }, (_, i) => ({ module: 'jobcards', id: `j${i}`, data: { id: `j${i}`, _up: t0 } }));
  await push(admin, recs);
  const versions = Object.fromEntries((await pool.query(`select id, version from records where module='jobcards'`)).rows.map(r => [r.id, r.version]));
  const wipe = recs.slice(0, 15).map(r => ({ ...r, deleted: true, baseVersion: versions[r.id], data: { ...r.data, _del: true, _up: later } }));
  const r = await push(admin, wipe);
  assert.ok(r.body.results.every(x => x.status === 'rejected'));
  assert.equal(Number((await pool.query(`select count(*) from records where module='jobcards' and not deleted`)).rows[0].count), 20);
  // a normal single delete still works
  const one = await push(admin, [wipe[0]]);
  assert.equal(one.body.results[0].status, 'applied');
  // an admin can confirm a deliberate bulk delete
  const ok = await push(admin, wipe.slice(1), { confirmBulkDelete: true });
  assert.ok(ok.body.results.every(x => x.status === 'applied'));
});

test('bad input is rejected per record, not per request', async () => {
  const admin = await login('boss', 'BossPass#1');
  const r = await push(admin, [
    { module: 'bad name!', id: 'x', data: {} },
    { module: 'tasks', id: '', data: {} },
    { module: 'tasks', id: 't1', data: { id: 't1' } },
  ]);
  assert.deepEqual(r.body.results.map(x => x.status), ['rejected', 'rejected', 'applied']);
});

test('duplicate usernames are refused', async () => {
  const admin = await login('boss', 'BossPass#1');
  const r = await push(admin, [{ module: 'team', id: '103', data: { id: 103, name: 'Dup', username: 'tech', password: 'x12345', _up: t0 } }]);
  assert.equal(r.body.results[0].status, 'rejected');
  assert.match(r.body.results[0].reason, /already used/);
});

test('repeated wrong passwords are rate limited', async () => {
  for (let i = 0; i < 10; i++) await api('POST', '/api/auth/login', { username: 'tech', password: 'wrong' });
  assert.equal((await api('POST', '/api/auth/login', { username: 'tech', password: 'tech-pass' })).status, 429);
});
