'use strict';
// Import the old Supabase app_data into the server.
// Usage: node scripts/import-app-data.js export.json [--overwrite]
//    or: SUPABASE_ANON_KEY=eyJ... node scripts/import-app-data.js https://<project>.supabase.co [--overwrite]
//        (reads the app_data table straight from the old Supabase project)
// export.json is either {"team":[...], "attendance":[...], ...}
// or the rows of app_data: [{"key":"team","value":[...]}, ...] (value may be a JSON string).
// Without --overwrite, a record already on the server is replaced only if the imported copy has a newer _up.
const fs = require('fs');
const { createPool, migrate } = require('../src/db');
const { push } = require('../src/sync');

const SYSTEM = { system: true, role: 'Admin' };

function normalize(raw) {
  const out = {};
  if (Array.isArray(raw)) {
    for (const row of raw) {
      if (!row || !row.key) continue;
      out[row.key] = typeof row.value === 'string' ? JSON.parse(row.value) : row.value;
    }
  } else Object.assign(out, raw);
  return out;
}

(async () => {
  const [file, flag] = process.argv.slice(2);
  if (!file) { console.error('usage: node scripts/import-app-data.js export.json [--overwrite]'); process.exit(2); }
  let raw;
  if (/^https?:\/\//.test(file)) {
    const key = process.env.SUPABASE_ANON_KEY;
    if (!key) { console.error('set SUPABASE_ANON_KEY'); process.exit(2); }
    const r = await fetch(file.replace(/\/+$/, '') + '/rest/v1/app_data?select=key,value', { headers: { apikey: key, Authorization: `Bearer ${key}` } });
    if (!r.ok) throw new Error(`Supabase read failed: ${r.status} ${(await r.text()).slice(0, 200)}`);
    raw = await r.json();
    const copy = require('path').join(require('os').tmpdir(), `supabase-export-${Date.now()}.json`);
    fs.writeFileSync(copy, JSON.stringify(raw), { mode: 0o600 });   // copy of what was imported; holds password hashes, delete when done
    console.log(`raw export saved to ${copy}`);
  } else raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const data = normalize(raw);
  const pool = createPool();
  await migrate(pool);
  const versions = new Map((await pool.query('select module, id, version from records')).rows.map(r => [`${r.module}\u0000${r.id}`, r.version]));
  const keys = Object.keys(data).sort((a, b) => (a === 'team' ? -1 : b === 'team' ? 1 : a.localeCompare(b)));
  let total = 0, skipped = 0, rejected = 0;
  for (const module of keys) {
    const value = data[module];
    const changes = [];
    const add = (id, rec) => changes.push({
      module, id: String(id), data: rec, deleted: rec._del === true,
      // --overwrite claims the current server version, so the imported copy always wins
      baseVersion: flag === '--overwrite' ? versions.get(`${module}\u0000${id}`) : null,
    });
    if (Array.isArray(value)) {
      for (const rec of value) {
        if (!rec || typeof rec !== 'object' || rec.id == null || rec.id === '') { skipped++; continue; }
        add(rec.id, rec);
      }
    } else if (value && typeof value === 'object') add('_', value);
    else continue;
    for (let i = 0; i < changes.length; i += 500) {
      const { results } = await push(pool, SYSTEM, changes.slice(i, i + 500), { confirmBulkDelete: true });
      for (const r of results) {
        if (r.status === 'applied') total++;
        else { rejected++; console.warn(`  rejected ${r.module}/${r.id}: ${r.reason}`); }
      }
    }
    console.log(`${module}: ${changes.length} records`);
  }
  const users = (await pool.query('select username, role, (pw_scrypt is not null or pw_legacy_sha256 is not null) as has_pw from users order by username')).rows;
  console.log(`\nimported ${total}, rejected ${rejected}, skipped (no id) ${skipped}`);
  console.log(`logins: ${users.map(u => `${u.username} (${u.role}${u.has_pw ? '' : ', NO PASSWORD'})`).join(', ')}`);
  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
