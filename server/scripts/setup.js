'use strict';
// One-time (and safe to repeat) setup:
//   1. creates server/.env from .env.example if it is missing
//   2. creates the PostgreSQL database named in DATABASE_URL if it does not exist
//   3. applies migrations and creates the first admin login (BOOTSTRAP_ADMIN_* in .env)
// Usage: npm run setup
const fs = require('fs');
const path = require('path');

const envFile = path.join(__dirname, '..', '.env');
if (!fs.existsSync(envFile)) {
  fs.copyFileSync(path.join(__dirname, '..', '.env.example'), envFile);
  console.log('created server/.env (edit the PostgreSQL password in it if setup fails below)');
}
const { runScript } = require('./lib/runScript');
const { Database } = require('../src/db/Database');

runScript(async app => {
  const { name, created } = await Database.ensureExists(app.config.databaseUrl);
  console.log(created ? `created database ${name}` : `database ${name} already exists`);
  const applied = await app.migrator.run();
  console.log(applied.length ? `migrations applied: ${applied.join(', ')}` : 'database schema is up to date');
  await app.auth.bootstrapAdmin(app.config.bootstrapAdminUser, app.config.bootstrapAdminPassword);
  const users = await app.repositories.users.list();
  console.log(users.length ? `logins: ${users.map(u => `${u.username} (${u.role})`).join(', ')}` : 'no logins yet: set BOOTSTRAP_ADMIN_USER / BOOTSTRAP_ADMIN_PASSWORD in server/.env, or run "npm run seed-demo"');
  console.log('\nSetup done. Start the server with: npm start');
}).then(() => { if (process.exitCode) console.error('Setup failed (see the message above).'); });
