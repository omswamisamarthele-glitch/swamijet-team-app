'use strict';
let pg;
try { pg = require('pg'); }
catch (e) {
  console.error('Packages are not installed yet. In the SwamiJet folder run:  npm run setup');
  process.exit(1);
}

/** One open transaction. Repositories accept it in place of the Database (both have query()). */
class Transaction {
  constructor(client) { this.client = client; }
  query(text, params) { return this.client.query(text, params); }

  /** Runs work inside a savepoint: on error only that work is undone, then the error is re-thrown. */
  async savepoint(work) {
    await this.client.query('savepoint sp');
    try {
      const result = await work();
      await this.client.query('release savepoint sp');
      return result;
    } catch (e) {
      await this.client.query('rollback to savepoint sp');
      throw e;
    }
  }
}

/** Connection pool for the app's PostgreSQL database. */
class Database {
  constructor({ url, poolSize = 10 }) {
    if (!url) throw new Error('DATABASE_URL is not set');
    this.url = url;
    this.pool = new pg.Pool({ connectionString: url, max: poolSize });
  }

  query(text, params) { return this.pool.query(text, params); }

  /** Runs work(tx) in one transaction: committed if it returns, rolled back if it throws. */
  async transaction(work) {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const result = await work(new Transaction(client));
      await client.query('commit');
      return result;
    } catch (e) {
      await client.query('rollback');
      throw e;
    } finally {
      client.release();
    }
  }

  close() { return this.pool.end(); }

  /** Creates the database named in url if it does not exist (connects to the "postgres" database to do it). */
  static async ensureExists(url) {
    const target = new URL(url);
    const name = decodeURIComponent(target.pathname.replace(/^\//, ''));
    if (!/^[A-Za-z0-9_]+$/.test(name)) throw new Error(`unexpected database name "${name}" in DATABASE_URL`);
    const admin = new URL(url); admin.pathname = '/postgres';
    const client = new pg.Client({ connectionString: admin.href });
    await client.connect();
    try {
      const exists = (await client.query('select 1 from pg_database where datname = $1', [name])).rowCount > 0;
      if (!exists) await client.query(`create database "${name}"`);
      return { name, created: !exists };
    } finally {
      await client.end();
    }
  }

  /** Turns common connection errors into a plain next step. */
  static explainError(e, url) {
    if (!url) return 'DATABASE_URL is not set. Run "npm run setup" first (it creates server/.env).';
    if (e.code === 'ECONNREFUSED' || e.code === 'ENOTFOUND') return 'Cannot reach PostgreSQL. Is it installed and running? Check host/port in server/.env.';
    if (e.code === '28P01' || e.code === '28000') return 'PostgreSQL refused the username/password. Fix the password in DATABASE_URL in server/.env.';
    if (e.code === '3D000') return 'The database does not exist yet. Run "npm run setup".';
    return e.message;
  }
}

module.exports = { Database, Transaction };
