'use strict';
// Usage: node scripts/restore-record.js <module> <id> [ISO time]
// Lists a record's saved versions, or with a time restores the version that was current then.
const { runScript, UsageError } = require('./lib/runScript');

runScript(async (app, [module, id, at]) => {
  if (!module || !id) throw new UsageError('usage: restore-record <module> <id> [ISO time]');
  if (!at) { console.table(await app.history.versions(module, id)); return; }
  if (!(await app.history.restore(module, id, at))) { console.error('no saved version at or before that time'); process.exitCode = 1; return; }
  console.log(`restored ${module}/${id}; phones pick it up on their next sync`);
});
