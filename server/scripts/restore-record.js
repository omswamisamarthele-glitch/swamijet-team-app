'use strict';
// Usage: node scripts/restore-record.js <module> <id> [ISO time]
// Lists a record's saved versions, or with a time restores the version that was current then.
const { createPool } = require('../src/db');
(async () => {
  const [module, id, at] = process.argv.slice(2);
  if (!module || !id) { console.error('usage: restore-record <module> <id> [ISO time]'); process.exit(2); }
  const pool = createPool();
  if (!at) {
    const { rows } = await pool.query(`select version, deleted, updated_at, archived_at from records_history
      where module=$1 and id=$2 order by archived_at desc limit 50`, [module, id]);
    console.table(rows);
  } else {
    const h = (await pool.query(`select data, deleted from records_history where module=$1 and id=$2 and updated_at <= $3
      order by updated_at desc limit 1`, [module, id, at])).rows[0];
    if (!h) { console.error('no saved version at or before that time'); process.exit(1); }
    await pool.query(`update records set data=$3, deleted=$4, version=version+1, seq=nextval('change_seq'), updated_at=now(), updated_by=null
      where module=$1 and id=$2`, [module, id, { ...h.data, _up: new Date().toISOString() }, h.deleted]);
    console.log(`restored ${module}/${id}; phones pick it up on their next sync`);
  }
  await pool.end();
})().catch(e => { console.error(e.message); process.exit(1); });
