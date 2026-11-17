'use strict';
const fs = require('fs');
const path = require('path');

/** Applies db/migrations/*.sql in name order, each once, each in its own transaction. */
class Migrator {
  constructor(database, dir = path.join(__dirname, '..', '..', 'db', 'migrations')) {
    this.db = database;
    this.dir = dir;
  }

  async run() {
    await this.db.query(`create table if not exists schema_migrations (
      version text primary key, applied_at timestamptz not null default now())`);
    const done = new Set((await this.db.query('select version from schema_migrations')).rows.map(r => r.version));
    const applied = [];
    for (const file of fs.readdirSync(this.dir).filter(f => f.endsWith('.sql')).sort()) {
      if (done.has(file)) continue;
      try {
        await this.db.transaction(async tx => {
          await tx.query(fs.readFileSync(path.join(this.dir, file), 'utf8'));
          await tx.query('insert into schema_migrations(version) values ($1)', [file]);
        });
      } catch (e) {
        throw new Error(`migration ${file} failed: ${e.message}`);
      }
      applied.push(file);
    }
    return applied;
  }
}

module.exports = { Migrator };
