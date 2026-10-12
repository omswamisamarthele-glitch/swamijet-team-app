// End-to-end: the real server + PostgreSQL + the app in two browser "phones".
// Needs TEST_DATABASE_URL pointing at a database whose name ends in _test (it is wiped).
// Run: TEST_DATABASE_URL=postgres://... node tests/app.e2e.test.cjs   (see tests/README.md)
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const SERVER = path.join(ROOT, 'server');
const DB_URL = process.env.TEST_DATABASE_URL;
const PORT = 8791, BASE = `http://127.0.0.1:${PORT}`;
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const T_OLD = '2026-10-01T00:00:00.000Z', T_NEW = '2026-10-10T00:00:00.000Z';

if (!DB_URL || !/_test$/.test(new URL(DB_URL).pathname)) { console.error('TEST_DATABASE_URL must name a *_test database'); process.exit(2); }

const results = [];
async function check(name, fn) {
  try { await fn(); results.push(['PASS', name]); }
  catch (e) { results.push(['FAIL', `${name} -> ${e.message}`]); }
}
const assert = (c, m) => { if (!c) throw new Error(m); };

// What the old Supabase app_data table held (rows of key/value).
const EXPORT = [
  { key: 'team', value: [
    { id: 1, name: 'Owner', role: 'Admin', username: 'owner', password: sha('Owner#Pass1'), active: true, _up: T_OLD },
    { id: 2, name: 'Ravi', role: 'Technician', username: 'ravi', password: 'ravi-pass', active: true, _up: T_OLD },
  ] },
  { key: 'attendance', value: [
    { id: 11, mId: 2, mName: 'Ravi', date: '2026-10-01', ci: '09:00', _up: T_NEW },
    { id: 12, mId: 2, mName: 'Ravi', date: '2026-10-02', ci: '09:05', _up: T_NEW },
  ] },
  { key: 'officeGps', value: { lat: 18.5, lng: 73.8, _up: T_OLD } },
];

async function phone(browser, label) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  page.errors = []; page.blocked = [];
  page.on('pageerror', e => page.errors.push(e.message));
  await page.route(/supabase\.co|script\.google\.com|cdn\.jsdelivr\.net|cloudinary\.com/, r => { page.blocked.push(r.request().url()); return r.abort(); });
  await page.goto(BASE + '/');
  await page.waitForTimeout(3000);
  page.label = label;
  return page;
}
async function login(page, u, p) {
  await page.fill('#lu', u); await page.fill('#lp', p);
  await page.evaluate(() => window.doLogin());
  await page.waitForFunction(() => !/Signing|Loading/.test(document.getElementById('loginBtn').textContent), null, { timeout: 30000 });
  await page.waitForTimeout(800);
  return page.evaluate(() => (window.CU ? { id: CU.id, role: CU.role, name: CU.name } : null));
}
const sync = page => page.evaluate(() => window.sjServerSync.sync());
const local = (page, k) => page.evaluate(k => JSON.parse(localStorage.getItem('sj3_' + k) || 'null'), k);
const editRecord = (page, k, id, patch) => page.evaluate(([k, id, patch]) => {
  const arr = DB.getRaw(k) || [];
  const r = arr.find(x => String(x.id) === String(id));
  Object.assign(r, patch, { _up: new Date().toISOString() });
  DB.set(k, arr);
}, [k, id, patch]);

(async () => {
  // fresh database + import of the old data
  execFileSync('psql', [DB_URL, '-q', '-c', 'drop schema public cascade; create schema public;']);
  const exportFile = path.join(os.tmpdir(), `sj-export-${process.pid}.json`);
  fs.writeFileSync(exportFile, JSON.stringify(EXPORT));
  const imp = execFileSync('node', ['scripts/import-app-data.js', exportFile], { cwd: SERVER, env: { ...process.env, DATABASE_URL: DB_URL } }).toString();

  const srv = spawn('node', ['src/server.js'], { cwd: SERVER, env: { ...process.env, DATABASE_URL: DB_URL, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe'] });
  let srvLog = ''; srv.stdout.on('data', d => (srvLog += d)); srv.stderr.on('data', d => (srvLog += d));
  for (let i = 0; i < 50 && !srvLog.includes('swamijet server on'); i++) await new Promise(r => setTimeout(r, 100));

  const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
  const A = await phone(browser, 'owner'), B = await phone(browser, 'ravi');

  await check('import created logins from the team list', async () => {
    assert(/imported 5/.test(imp), imp);
    assert(/owner \(Admin\)/.test(imp) && /ravi \(Technician\)/.test(imp), imp);
  });

  await check('admin/admin123 and wrong passwords are refused', async () => {
    assert((await login(A, 'admin', 'admin123')) === null, 'admin123 worked');
    assert((await login(A, 'owner', 'wrong')) === null, 'wrong password worked');
    assert((await login(A, 'owner', sha('Owner#Pass1'))) === null, 'hash accepted');
  });

  await check('owner logs in with the old password and gets all data', async () => {
    const cu = await login(A, 'owner', 'Owner#Pass1');
    assert(cu && String(cu.id) === '1' && cu.role === 'Admin', JSON.stringify(cu));
    const att = await local(A, 'attendance');
    assert(att.length === 2, 'attendance ' + JSON.stringify(att));
    const gps = await local(A, 'officeGps');
    assert(gps && gps.lat === 18.5, 'officeGps ' + JSON.stringify(gps));
    const team = await local(A, 'team');
    assert(team.every(m => !('password' in m)), 'password reached the phone');
  });

  await check('technician logs in with a plain-text legacy password', async () => {
    const cu = await login(B, 'ravi', 'ravi-pass');
    assert(cu && String(cu.id) === '2', JSON.stringify(cu));
  });

  await check('edits to different records on two phones both survive', async () => {
    await editRecord(A, 'attendance', 11, { co: '18:00' });
    await editRecord(B, 'attendance', 12, { co: '18:30' });
    await sync(A); await sync(B); await sync(A);
    for (const p of [A, B]) {
      const att = await local(p, 'attendance');
      assert(att.find(r => r.id === 11).co === '18:00' && att.find(r => r.id === 12).co === '18:30', p.label + ' ' + JSON.stringify(att));
    }
  });

  await check('an edit reaches the other phone by itself (no manual sync, no reload)', async () => {
    const t0 = Date.now();
    await editRecord(A, 'attendance', 12, { note: 'auto-' + t0 });
    // A uploads on its own within ~2 s; B downloads on its own 20 s timer
    await B.waitForFunction(v => (JSON.parse(localStorage.getItem('sj3_attendance') || '[]').find(r => r.id === 12) || {}).note === v,
      'auto-' + t0, { timeout: 35000, polling: 500 });
    console.log(`  (arrived on the other phone after ${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  });

  await check('a new record and a delete reach the other phone', async () => {
    await A.evaluate(() => { const n = DB.getRaw('notices') || []; n.push({ id: 501, title: 'Holiday', _up: new Date().toISOString() }); DB.set('notices', n); });
    await sync(A); await sync(B);
    assert((await local(B, 'notices')).some(n => n.id === 501), 'notice missing on B');
    await A.evaluate(() => softDelete('notices', 501));
    await sync(A); await sync(B);
    assert(!(await local(B, 'notices')).some(n => n.id === 501), 'deleted notice still on B');
  });

  await check('technician cannot change salary data or another member', async () => {
    await B.evaluate(() => {
      DB.set('salaryPayments', [{ id: 901, amount: 99999, _up: new Date().toISOString() }]);
      const t = DB.getRaw('team'); t.find(m => m.id === 1).role = 'Technician'; t.find(m => m.id === 1)._up = new Date().toISOString(); DB.set('team', t);
    });
    await sync(B); await sync(A);
    assert(!((await local(A, 'salaryPayments')) || []).some(r => r.id === 901), 'salary record reached admin');
    assert((await local(A, 'team')).find(m => m.id === 1).role === 'Admin', 'owner role changed');
    assert((await local(B, 'team')).find(m => m.id === 1).role === 'Admin', 'B kept its forbidden edit');
    assert(!((await local(B, 'salaryPayments')) || []).some(r => r.id === 901), 'refused salary record still on B');
  });

  await check('admin adds a member; they can log in on another phone', async () => {
    await A.evaluate(async () => {
      const t = DB.getRaw('team');
      t.push({ id: 3, name: 'Sita', role: 'Technician', username: 'sita', password: await hashPassword('sita-pass-1'), active: true, _up: new Date().toISOString() });
      DB.set('team', t);
    });
    await sync(A);
    const C = await phone(browser, 'sita');
    const cu = await login(C, 'sita', 'sita-pass-1');
    assert(cu && String(cu.id) === '3', JSON.stringify(cu));
  });

  await check('a phone with old local data does not overwrite newer server data', async () => {
    const D = await phone(browser, 'stale');
    await D.evaluate(t => {
      localStorage.setItem('sj3_attendance', JSON.stringify([{ id: 11, mId: 2, date: '2026-10-01', ci: '09:00', co: 'STALE', _up: t }]));
    }, T_OLD);
    await login(D, 'ravi', 'ravi-pass');
    await sync(A);
    assert((await local(A, 'attendance')).find(r => r.id === 11).co === '18:00', 'stale copy overwrote server');
    assert((await local(D, 'attendance')).find(r => r.id === 11).co === '18:00', 'stale phone kept old copy');
  });

  await check('reload keeps the session; logout ends it', async () => {
    await A.reload(); await A.waitForTimeout(4000);
    assert(await A.evaluate(() => !!window.CU && !!localStorage.getItem('sj_token')), 'session lost on reload');
    assert(await sync(A), 'sync after reload failed');
    await A.evaluate(() => window.doLogout()); await A.waitForTimeout(500);
    assert(await A.evaluate(() => !localStorage.getItem('sj_token')), 'token kept after logout');
  });

  await check('a session from the Supabase version must log in again', async () => {
    const E = await phone(browser, 'legacy');
    await E.evaluate(() => {
      localStorage.setItem('sj3_team', JSON.stringify([{ id: 2, name: 'Ravi', role: 'Technician', username: 'ravi', active: true }]));
      localStorage.setItem('sj3_sess', '2');
    });
    await E.reload(); await E.waitForTimeout(4500);
    assert(await E.evaluate(() => !window.CU), 'old session still active without a server login');
  });

  await check('every page opens from the real menu and shows content; no external services called', async () => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const P = await ctx.newPage();
    P.errors = []; P.blocked = [];
    P.on('pageerror', e => P.errors.push(e.message));
    await P.route(/supabase\.co|script\.google\.com|cdn\.jsdelivr\.net|cloudinary\.com/, r => { P.blocked.push(r.request().url()); return r.abort(); });
    await P.goto(BASE + '/'); await P.waitForTimeout(3000);
    P.label = 'pages';
    await login(P, 'owner', 'Owner#Pass1');
    const ids = await P.evaluate(() => [...document.querySelectorAll('.page')].map(p => p.id.slice(2)));
    assert(ids.length >= 23, 'pages: ' + ids.length);
    // what the menus offer: bottom bar + "More" sheet; then reload to close the sheet (session persists)
    await P.click('#sjbbMore'); await P.waitForTimeout(400);
    const inMenu = new Set(await P.evaluate(() => [...document.querySelectorAll('#sjBottomBar [data-p], .sjSheetItem[data-p]')].map(e => e.getAttribute('data-p'))));
    await P.reload(); await P.waitForTimeout(4000);
    const empty = [], notInMenu = ids.filter(id => !inMenu.has(id));
    for (const id of ids.filter(id => inMenu.has(id))) {
      // bottom bar if the page is there, otherwise the "More" sheet, like a person would
      let btn = P.locator(`#sjBottomBar [data-p="${id}"]:visible`).first();
      if (!(await btn.count())) {
        await P.click('#sjbbMore');
        await P.waitForTimeout(300);
        btn = P.locator(`.sjSheetItem[data-p="${id}"]`).first();
      }
      await btn.click();
      await P.waitForTimeout(250);
      const st = await P.evaluate(p => { const el = document.getElementById('p-' + p); return { shown: getComputedStyle(el).display !== 'none', text: el.innerText.trim().length }; }, id);
      if (!st.shown || st.text < 20) empty.push(`${id} (shown=${st.shown}, text=${st.text})`);
    }
    assert(!empty.length, 'not shown: ' + empty.join(', '));
    if (notInMenu.length) console.log('  (pages with no menu entry: ' + notInMenu.join(', ') + ')');
    assert(notInMenu.length <= 1, 'pages with no menu entry: ' + notInMenu.join(', '));   // 'sites' is hidden by the app itself
    assert(P.errors.length === 0, 'errors: ' + P.errors.join(' | '));
    assert(!P.blocked.some(u => /supabase|script\.google|jsdelivr/.test(u)), 'external calls: ' + P.blocked.join(', '));
    const badge = await P.evaluate(() => document.getElementById('appVersionBadge').textContent);
    const v = JSON.parse(fs.readFileSync(path.join(ROOT, 'version.json'))).version;
    assert(badge === 'v' + v, 'badge ' + badge);
  });

  await browser.close();
  srv.kill();
  fs.unlinkSync(exportFile);
  for (const [s, n] of results) console.log(s, n);
  const failed = results.filter(r => r[0] === 'FAIL').length;
  if (failed) console.log('--- server log ---\n' + srvLog.slice(-3000));
  console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
