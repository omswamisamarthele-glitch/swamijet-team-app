'use strict';
// Usage: node scripts/reset-password.js <username> <new password>
// Also re-activates the login and signs the user out everywhere.
const { runScript, UsageError } = require('./lib/runScript');
const { Roles } = require('../src/domain/Roles');

runScript(async (app, [username, password]) => {
  if (!username || !password || password.length < 6) throw new UsageError('usage: reset-password <username> <new password min 6 chars>');
  const name = Roles.normalizeUsername(username);
  if (!(await app.auth.resetPassword(name, password))) { console.error(`no user "${name}"`); process.exitCode = 1; return; }
  console.log(`password reset for "${name}"`);
});
