'use strict';
// Usage: node scripts/create-admin.js <username> <password> [name]
// Creates an admin login with no team record (for recovery or a fresh install).
const { createPool, migrate } = require('../src/db');
const { hashPassword, normUser } = require('../src/auth');
(async () => {
  const [u, pw, name] = process.argv.slice(2);
  if (!u || !pw || pw.length < 8) { console.error('usage: create-admin <username> <password min 8 chars> [name]'); process.exit(2); }
  const pool = createPool();
  await migrate(pool);
  await pool.query(`insert into users(username, name, role, pw_scrypt) values ($1, $2, 'Admin', $3)`,
    [normUser(u), name || 'Admin', await hashPassword(pw)]);
  console.log(`admin "${normUser(u)}" created`);
  await pool.end();
})().catch(e => { console.error(e.message); process.exit(1); });
