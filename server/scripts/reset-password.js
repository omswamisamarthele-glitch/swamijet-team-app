'use strict';
// Usage: node scripts/reset-password.js <username> <new password>
// Also re-activates the login and signs the user out everywhere.
const { createPool } = require('../src/db');
const { hashPassword, normUser } = require('../src/auth');
(async () => {
  const [u, pw] = process.argv.slice(2);
  if (!u || !pw || pw.length < 6) { console.error('usage: reset-password <username> <new password min 6 chars>'); process.exit(2); }
  const pool = createPool();
  const { rows } = await pool.query(
    `update users set pw_scrypt = $2, active = true, updated_at = now() where username = $1 returning id`,
    [normUser(u), await hashPassword(pw)]);
  if (!rows.length) { console.error(`no user "${normUser(u)}"`); process.exit(1); }
  await pool.query('delete from sessions where user_id = $1', [rows[0].id]);
  console.log(`password reset for "${normUser(u)}"`);
  await pool.end();
})().catch(e => { console.error(e.message); process.exit(1); });
