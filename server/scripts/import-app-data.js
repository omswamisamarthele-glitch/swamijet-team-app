'use strict';
// Import the old Supabase app_data into the server.
// Usage: node scripts/import-app-data.js export.json [--overwrite]
//    or: SUPABASE_ANON_KEY=eyJ... node scripts/import-app-data.js https://<project>.supabase.co [--overwrite]
//        (reads the app_data table straight from the old Supabase project)
// export.json is either {"team":[...], "attendance":[...], ...}
// or the rows of app_data: [{"key":"team","value":[...]}, ...] (value may be a JSON string).
// Without --overwrite, a record already on the server is replaced only if the imported copy has a newer _up.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runScript, UsageError } = require('./lib/runScript');
const { LegacyImporter } = require('../src/import/LegacyImporter');

async function readSource(source) {
  if (!/^https?:\/\//.test(source)) return JSON.parse(fs.readFileSync(source, 'utf8'));
  const key = process.env.SUPABASE_ANON_KEY;
  if (!key) throw new UsageError('set SUPABASE_ANON_KEY');
  const raw = await LegacyImporter.fetchFromSupabase(source, key);
  const copy = path.join(os.tmpdir(), `supabase-export-${Date.now()}.json`);
  fs.writeFileSync(copy, JSON.stringify(raw), { mode: 0o600 });   // holds password hashes, delete when done
  console.log(`raw export saved to ${copy}`);
  return raw;
}

runScript(async (app, [source, flag]) => {
  if (!source) throw new UsageError('usage: node scripts/import-app-data.js export.json [--overwrite]');
  const raw = await readSource(source);
  await app.prepare();
  const importer = new LegacyImporter({ sync: app.sync, records: app.repositories.records });
  const totals = await importer.import(raw, {
    overwrite: flag === '--overwrite',
    onModule: (module, count) => console.log(`${module}: ${count} records`),
    onRejected: r => console.warn(`  rejected ${r.module}/${r.id}: ${r.reason}`),
  });
  const users = (await app.repositories.users.list()).sort((a, b) => a.username.localeCompare(b.username));
  console.log(`\nimported ${totals.imported}, rejected ${totals.rejected}, skipped (no id) ${totals.skipped}`);
  console.log(`logins: ${users.map(u => `${u.username} (${u.role}${u.has_password ? '' : ', NO PASSWORD'})`).join(', ')}`);
});
