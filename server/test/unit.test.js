'use strict';
// Unit tests for the domain classes, with in-memory fakes in place of the database (no PostgreSQL needed).
const test = require('node:test');
const assert = require('node:assert/strict');
const { AccessPolicy } = require('../src/sync/AccessPolicy');
const { WipeGuard } = require('../src/sync/WipeGuard');
const { ChangeValidator } = require('../src/sync/ChangeValidator');
const { LoginRateLimiter } = require('../src/auth/LoginRateLimiter');
const { PasswordHasher } = require('../src/auth/PasswordHasher');
const { RecordFields } = require('../src/domain/RecordFields');
const { Roles } = require('../src/domain/Roles');
const { ChangeRejected, AuthenticationError, TooManyAttemptsError, ValidationError } = require('../src/domain/errors');
const { HttpError } = require('../src/http/HttpError');
const { LegacyImporter } = require('../src/import/LegacyImporter');
const { Router } = require('../src/http/Router');
const { AuthService } = require('../src/auth/AuthService');

const admin = { id: 1, role: 'Owner' }, accountant = { id: 2, role: 'Accountant' }, tech = { id: 3, role: 'Technician', member_id: '103' };

test('Roles: admin roles, system actor, usernames', () => {
  assert.ok(Roles.isAdmin(admin) && Roles.isAdmin({ role: 'Director' }) && Roles.isAdmin(Roles.SYSTEM));
  assert.ok(!Roles.isAdmin(tech) && !Roles.isAdmin(null));
  assert.equal(Roles.normalizeUsername('  Ravi '), 'ravi');
  assert.equal(Roles.actorId(Roles.SYSTEM), null);
  assert.equal(Roles.actorId(admin), 1);
});

test('AccessPolicy: restricted modules, own profile only, protected fields kept', () => {
  const p = new AccessPolicy();
  assert.throws(() => p.authorizeWrite(tech, { module: 'salaryPayments', id: 'x', data: {} }), ChangeRejected);
  assert.deepEqual(p.authorizeWrite(accountant, { module: 'salaryPayments', id: 'x', data: { a: 1 } }), { a: 1 });
  assert.throws(() => p.authorizeWrite(tech, { module: 'team', id: '999', data: {} }, { data: {} }), /own profile/);
  assert.throws(() => p.authorizeWrite(tech, { module: 'team', id: '103', data: {}, deleted: true }, { data: {} }), /cannot delete/);
  const out = p.authorizeWrite(tech, { module: 'team', id: '103', data: { name: 'New', role: 'Admin', rate: 1 } }, { data: { role: 'Technician' } });
  assert.deepEqual(out, { name: 'New', role: 'Technician' });            // role restored, rate dropped (not on server copy)
  assert.deepEqual(p.authorizeWrite(admin, { module: 'team', id: '999', data: { role: 'Admin' } }), { role: 'Admin' });
  const custom = new AccessPolicy({ restrictedModules: ['stock'] });   // rules are injectable
  assert.throws(() => custom.authorizeWrite(tech, { module: 'stock', id: '1', data: {} }), ChangeRejected);
});

test('WipeGuard: blocks a large share of deletes unless an admin confirms; trimmed modules exempt', async () => {
  const logged = [];
  const fakes = { records: { countLive: async () => 20 }, events: { log: async (...a) => logged.push(a) } };
  const del = (module, n) => Array.from({ length: n }, (_, i) => ({ module, id: String(i), deleted: true }));
  const g = new WipeGuard();
  assert.deepEqual([...await g.blockedModules(fakes, admin, del('jobcards', 15))], ['jobcards']);
  assert.equal(logged.length, 1);
  assert.equal((await g.blockedModules(fakes, admin, del('jobcards', 15), { confirmBulkDelete: true })).size, 0);
  assert.equal((await g.blockedModules(fakes, tech, del('jobcards', 15), { confirmBulkDelete: true })).size, 1);
  assert.equal((await g.blockedModules(fakes, admin, del('jobcards', 3))).size, 0);          // under the minimum
  assert.equal((await g.blockedModules(fakes, admin, del('notifications', 15))).size, 0);    // trimmed on purpose
});

test('ChangeValidator: shape and size of a change', () => {
  const v = new ChangeValidator({ maxRecordBytes: 50 });
  assert.equal(v.validate({ module: 'tasks', id: 7, data: {} }), '7');
  for (const bad of [null, { module: 'bad name!', id: 1, data: {} }, { module: 'tasks', id: '', data: {} },
    { module: 'tasks', id: 1, data: null }, { module: 'tasks', id: 1, data: { x: 'y'.repeat(100) } }]) {
    assert.throws(() => v.validate(bad), e => e instanceof ChangeRejected && e.kind === 'invalid');
  }
});

test('LoginRateLimiter: blocks after the limit, forgets after the window', () => {
  let now = 0;
  const l = new LoginRateLimiter({ maxFailures: 3, windowMs: 1000, clock: () => now });
  for (let i = 0; i < 3; i++) l.recordFailure('k');
  assert.ok(l.isBlocked('k'));
  now = 1001;
  assert.ok(!l.isBlocked('k'));
  l.recordFailure('k'); l.recordSuccess('k');
  assert.ok(!l.isBlocked('k'));
});

test('PasswordHasher: scrypt round trip, legacy SHA-256 asks for upgrade, hash never accepted as password', async () => {
  const h = new PasswordHasher({ N: 1024 });
  const stored = await h.hash('Secret#1');
  assert.deepEqual(await h.verify({ pw_scrypt: stored }, ' Secret#1 '), { ok: true });
  assert.deepEqual(await h.verify({ pw_scrypt: stored }, 'nope'), { ok: false });
  const legacy = PasswordHasher.sha256Hex('old');
  assert.deepEqual(await h.verify({ pw_legacy_sha256: legacy }, 'old'), { ok: true, upgrade: true });
  assert.equal((await h.verify({ pw_legacy_sha256: legacy }, legacy)).ok, false);
});

test('AuthService: wrong password counted, rate limited, legacy password upgraded (fake repositories)', async () => {
  const hasher = new PasswordHasher({ N: 1024 });
  const user = { id: 5, username: 'ravi', role: 'Technician', member_id: '1002', pw_legacy_sha256: PasswordHasher.sha256Hex('ravi-pw') };
  const upgraded = [], created = [];
  const users = { findActiveByUsername: async n => (n === 'ravi' ? user : null), setScrypt: async (id, h) => upgraded.push(id) };
  const sessions = { create: async (...a) => created.push(a) };
  const auth = new AuthService({ users, sessions, hasher, rateLimiter: new LoginRateLimiter({ maxFailures: 2 }), logger: { log() {} } });
  await assert.rejects(auth.login({ username: '', password: 'x' }), ValidationError);
  const ok = await auth.login({ username: ' RAVI', password: 'ravi-pw', ip: '1.1.1.1' });
  assert.equal(ok.user.memberId, '1002');
  assert.deepEqual(upgraded, [5]);
  assert.equal(created.length, 1);
  await assert.rejects(auth.login({ username: 'ravi', password: 'bad', ip: '2.2.2.2' }), AuthenticationError);
  await assert.rejects(auth.login({ username: 'ravi', password: 'bad', ip: '2.2.2.2' }), AuthenticationError);
  await assert.rejects(auth.login({ username: 'ravi', password: 'ravi-pw', ip: '2.2.2.2' }), TooManyAttemptsError);
});

test('RecordFields: secrets stripped, password found, liveness', () => {
  assert.deepEqual(RecordFields.withoutSecrets({ a: 1, password: 'x', pw: 'y' }), { a: 1 });
  assert.equal(RecordFields.password({ pass: '  abc ' }), 'abc');
  assert.ok(!RecordFields.isLive({ _del: true }) && !RecordFields.isLive({ active: false }) && RecordFields.isLive({}));
});

test('HttpError: domain errors map to statuses; unknown errors hide details', () => {
  assert.deepEqual(HttpError.from(new AuthenticationError()), { status: 401, message: 'login required' });
  assert.equal(HttpError.from(new TooManyAttemptsError('x')).status, 429);
  assert.equal(HttpError.from(new ValidationError('x')).status, 400);
  assert.deepEqual(HttpError.from(new Error('db password is ...')), { status: 500, message: 'server error' });
});

test('LegacyImporter.normalize: both export shapes', () => {
  assert.deepEqual(LegacyImporter.normalize([{ key: 'team', value: '[{"id":1}]' }, { key: 'x', value: [] }, {}]), { team: [{ id: 1 }], x: [] });
  assert.deepEqual(LegacyImporter.normalize({ team: [] }), { team: [] });
});

test('Router: controllers register their own routes', () => {
  const r = new Router().mount({ routes: rt => rt.add('GET', '/api/x', () => 'x') });
  assert.equal(r.find('GET', '/api/x')(), 'x');
  assert.equal(r.find('POST', '/api/x'), null);
});
