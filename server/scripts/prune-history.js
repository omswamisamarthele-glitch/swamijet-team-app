'use strict';
// Deletes record history older than HISTORY_DAYS (default 180) and expired sessions.
const { createPool } = require('../src/db');
(async () => {
  const days = Number(process.env.HISTORY_DAYS || 180);
  const pool = createPool();
  const h = await pool.query(`delete from records_history where archived_at < now() - make_interval(days => $1)`, [days]);
  const s = await pool.query('delete from sessions where expires_at < now()');
  const e = await pool.query(`delete from sync_events where at < now() - make_interval(days => $1)`, [days]);
  console.log(`pruned ${h.rowCount} history rows, ${s.rowCount} sessions, ${e.rowCount} events`);
  await pool.end();
})().catch(e => { console.error(e.message); process.exit(1); });
