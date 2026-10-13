'use strict';
// One-time (and safe to repeat) setup for running without Docker:
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
const { createPool, migrate, explainDbError } = require('../src/db');   // loads server/.env, checks packages
const { Client } = require('pg');
const { bootstrapAdmin } = require('../src/server');

(async () => {
  const url = new URL(process.env.DATABASE_URL);
  const dbName = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!/^[A-Za-z0-9_]+$/.test(dbName)) throw new Error(`unexpected database name "${dbName}" in DATABASE_URL`);

  const admin = new URL(url.href); admin.pathname = '/postgres';
  const c = new Client({ connectionString: admin.href });
  await c.connect();
  const exists = (await c.query('select 1 from pg_database where datname = $1', [dbName])).rowCount > 0;
  if (!exists) { await c.query(`create database "${dbName}"`); console.log(`created database ${dbName}`); }
  else console.log(`database ${dbName} already exists`);
  await c.end();

  const pool = createPool();
  const applied = await migrate(pool);
  console.log(applied.length ? `migrations applied: ${applied.join(', ')}` : 'database schema is up to date');
  await bootstrapAdmin(pool);
  const users = (await pool.query('select username, role from users order by id')).rows;
  console.log(users.length ? `logins: ${users.map(u => `${u.username} (${u.role})`).join(', ')}` : 'no logins yet: set BOOTSTRAP_ADMIN_USER / BOOTSTRAP_ADMIN_PASSWORD in server/.env, or run "npm run seed-demo"');
  await pool.end();
  console.log('\nSetup done. Start the server with: npm start');
})().catch(e => { console.error('Setup failed: ' + explainDbError(e)); process.exit(1); });
