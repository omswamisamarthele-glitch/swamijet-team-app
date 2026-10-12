// Phase 0 browser tests. Run: node tests/phase0.test.cjs  (see tests/README.md)
// All cloud hosts are blocked, so nothing here can touch the production database.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const PORT = 8790;
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png' };

function serve() {
  return http.createServer((req, res) => {
    const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]).replace(/^\/$/, '/index.html'));
    if (!p.startsWith(ROOT) || !fs.existsSync(p)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream' });
    fs.createReadStream(p).pipe(res);
  }).listen(PORT);
}

const results = [];
async function check(name, fn) {
  try { await fn(); results.push(['PASS', name]); }
  catch (e) { results.push(['FAIL', name + ' -> ' + e.message]); }
}
const assert = (c, m) => { if (!c) throw new Error(m); };

async function freshPage(browser, team) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  page.errors = [];
  page.cloudHits = [];
  page.on('pageerror', e => page.errors.push(e.message));
  await page.route(/supabase\.co|script\.google\.com|cdn\.jsdelivr\.net|cloudinary\.com/, r => {
    page.cloudHits.push(r.request().url());
    return r.abort();
  });
  await page.goto(`http://127.0.0.1:${PORT}/index.html`);
  if (team) {
    await page.evaluate(t => {
      localStorage.clear();
      localStorage.setItem('sj3_team', JSON.stringify(t));
      localStorage.setItem('sj3_team_backup', JSON.stringify(t));
      localStorage.setItem('sj3_seededV3', 'true');
    }, team);
    await page.reload();
  }
  await page.waitForTimeout(1500);
  return page;
}

async function login(page, u, p) {
  await page.fill('#lu', u);
  await page.fill('#lp', p);
  await page.evaluate(() => window.doLogin());
  // The login layer waits up to 8 s for a cloud pull before checking locally.
  await page.waitForFunction(() => window.CU || !/Syncing|Checking/.test(document.getElementById('loginBtn').textContent), null, { timeout: 20000 });
  await page.waitForTimeout(1500);
  return page.evaluate(() => (window.CU ? { id: CU.id, role: CU.role, username: CU.username } : null));
}

const now = new Date().toISOString();
const TEAM = [
  { id: 101, name: 'Owner', role: 'Admin', username: 'owner', password: sha('S3cret!Pass'), active: true, _up: now },
  { id: 102, name: 'Tech', role: 'Technician', username: 'tech', password: 'tech1pass', active: true, _up: now },
];

(async () => {
  const server = serve();
  const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});

  await check('admin/admin123 is refused when no admin account exists', async () => {
    const page = await freshPage(browser, TEAM);
    assert((await login(page, 'admin', 'admin123')) === null, 'logged in via backdoor');
    const team = await page.evaluate(() => JSON.parse(localStorage.getItem('sj3_team')));
    assert(!team.some(m => m.username === 'admin'), 'admin account was created');
  });

  await check('admin/admin123 does not reset an existing admin password', async () => {
    const t = TEAM.concat([{ id: 103, name: 'Admin', role: 'Admin', username: 'admin', password: sha('Changed#1'), active: true, _up: now }]);
    const page = await freshPage(browser, t);
    assert((await login(page, 'admin', 'admin123')) === null, 'logged in via backdoor');
    const pw = await page.evaluate(() => JSON.parse(localStorage.getItem('sj3_team')).find(m => m.username === 'admin').password);
    assert(pw === sha('Changed#1'), 'admin password was overwritten');
  });

  await check('typing the stored hash is refused', async () => {
    const page = await freshPage(browser, TEAM);
    assert((await login(page, 'owner', sha('S3cret!Pass'))) === null, 'hash accepted as password');
  });

  await check('correct hashed password logs in', async () => {
    const page = await freshPage(browser, TEAM);
    const cu = await login(page, 'owner', 'S3cret!Pass');
    assert(cu && cu.id === 101, 'owner could not log in');
  });

  await check('legacy plain-text password still logs in', async () => {
    const page = await freshPage(browser, TEAM);
    const cu = await login(page, 'tech', 'tech1pass');
    assert(cu && cu.id === 102, 'tech could not log in');
  });

  await check('new device with failed cloud pull creates no default admin', async () => {
    const page = await freshPage(browser, null);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForTimeout(1500);
    assert((await login(page, 'admin', 'admin123')) === null, 'offline default admin login worked');
    const team = await page.evaluate(() => JSON.parse(localStorage.getItem('sj3_team') || '[]'));
    assert(!team.some(m => m && m.username === 'admin'), 'default admin was created without cloud confirmation');
  });

  await check('all pages open with no JavaScript errors', async () => {
    const page = await freshPage(browser, TEAM);
    await login(page, 'owner', 'S3cret!Pass');
    const ids = await page.evaluate(() => [...document.querySelectorAll('.page')].map(p => p.id.slice(2)));
    assert(ids.length >= 23, 'expected 23 pages, found ' + ids.length);
    for (const id of ids) {
      const ok = await page.evaluate(p => { goPage(p); return document.getElementById('p-' + p).classList.contains('on'); }, id);
      assert(ok, 'page did not open: ' + id);
      await page.waitForTimeout(150);
    }
    assert(page.errors.length === 0, 'page errors: ' + page.errors.join(' | '));
  });

  await check('version is consistent everywhere', async () => {
    const v = JSON.parse(fs.readFileSync(path.join(ROOT, 'version.json'))).version;
    const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
    const man = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json')));
    assert(sw.includes(`APP_VERSION = '${v}'`) && sw.includes(`swamijet-v${v.replace(/\./g, '')}`), 'sw.js version');
    assert(man.start_url === `./?v=${v}`, 'manifest start_url');
    const page = await freshPage(browser, TEAM);
    await login(page, 'owner', 'S3cret!Pass');
    await page.waitForTimeout(2500);
    const badge = await page.evaluate(() => document.getElementById('appVersionBadge').textContent);
    assert(badge === 'v' + v, 'badge shows ' + badge);
  });

  await check('no request to the retired Google Sheets endpoint', async () => {
    const page = await freshPage(browser, TEAM);
    await login(page, 'owner', 'S3cret!Pass');
    assert(!page.cloudHits.some(u => u.includes('script.google.com')), 'Google Sheets was called');
  });

  await browser.close();
  server.close();
  for (const [s, n] of results) console.log(s, n);
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
  process.exit(failed ? 1 : 0);
})();
