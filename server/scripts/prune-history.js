'use strict';
// Deletes record history and sync events older than HISTORY_DAYS (default 180) and expired sessions.
const { runScript } = require('./lib/runScript');

runScript(async app => {
  const r = await app.history.prune(Number(process.env.HISTORY_DAYS || 180));
  console.log(`pruned ${r.history} history rows, ${r.sessions} sessions, ${r.events} events`);
});
