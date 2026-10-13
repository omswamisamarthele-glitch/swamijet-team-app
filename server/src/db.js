'use strict';
const fs = require('fs');
const path = require('path');
let Pool;
try { ({ Pool } = require('pg')); }
catch (e) {
  console.error('Packages are not installed yet. In the SwamiJet folder run:  npm run setup');
  process.exit(1);
}

// Read server/.env (KEY=value lines) for local runs; real environment variables win.
(function loadEnv() {
  const file = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || line.trim().startsWith('#')) continue;
    if (process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
})();

function createPool(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) throw new Error('DATABASE_URL is not set');
  return new Pool({ connectionString, max: Number(process.env.PG_POOL_MAX || 10) });
}

// Applies db/migrations/*.sql in name order, each once, each in its own transaction.
async function migrate(pool) {
  const dir = path.join(__dirname, '..', 'db', 'migrations');
  await pool.query(`create table if not exists schema_migrations (
    version text primary key, applied_at timestamptz not null default now())`);
  const done = new Set((await pool.query('select version from schema_migrations')).rows.map(r => r.version));
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
  const applied = [];
  for (const f of files) {
    if (done.has(f)) continue;
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query(fs.readFileSync(path.join(dir, f), 'utf8'));
      await client.query('insert into schema_migrations(version) values ($1)', [f]);
      await client.query('commit');
      applied.push(f);
    } catch (e) {
      await client.query('rollback');
      throw new Error(`migration ${f} failed: ${e.message}`);
    } finally {
      client.release();
    }
  }
  return applied;
}

// Turn common connection errors into a plain next step.
function explainDbError(e) {
  const url = String(process.env.DATABASE_URL || '');
  if (!url) return 'DATABASE_URL is not set. Run "npm run setup" first (it creates server/.env).';
  if (e.code === 'ECONNREFUSED' || e.code === 'ENOTFOUND') return 'Cannot reach PostgreSQL. Is it installed and running? Check host/port in server/.env.';
  if (e.code === '28P01' || e.code === '28000') return 'PostgreSQL refused the username/password. Fix the password in DATABASE_URL in server/.env.';
  if (e.code === '3D000') return 'The database does not exist yet. Run "npm run setup".';
  return e.message;
}

module.exports = { createPool, migrate, explainDbError };
