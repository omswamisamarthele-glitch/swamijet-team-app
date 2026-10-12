'use strict';
const { createPool, migrate } = require('../src/db');
(async () => {
  const pool = createPool();
  const applied = await migrate(pool);
  console.log(applied.length ? `applied: ${applied.join(', ')}` : 'database is up to date');
  await pool.end();
})().catch(e => { console.error(e.message); process.exit(1); });
