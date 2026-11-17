'use strict';
// Usage: node scripts/create-admin.js <username> <password> [name]
// Creates an admin login with no team record (for recovery or a fresh install).
const { runScript, UsageError } = require('./lib/runScript');

runScript(async (app, [username, password, name]) => {
  if (!username || !password || password.length < 8) throw new UsageError('usage: create-admin <username> <password min 8 chars> [name]');
  await app.prepare();
  console.log(`admin "${await app.auth.createAdmin(username, password, name || 'Admin')}" created`);
});
