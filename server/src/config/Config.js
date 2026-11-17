'use strict';
const fs = require('fs');
const path = require('path');

const SERVER_DIR = path.join(__dirname, '..', '..');

/** All settings in one immutable object. Built from environment variables (plus server/.env for local runs). */
class Config {
  /** Reads server/.env (KEY=value lines) into process.env; variables already set win. */
  static loadEnvFile(file = path.join(SERVER_DIR, '.env')) {
    if (!fs.existsSync(file)) return;
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
      if (!m || line.trim().startsWith('#')) continue;
      if (process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  }

  static fromEnv(env = process.env) {
    Config.loadEnvFile();
    return new Config({
      databaseUrl: env.DATABASE_URL || '',
      port: Number(env.PORT || 8080),
      host: env.HOST || undefined,
      appDir: path.resolve(env.APP_DIR || path.join(SERVER_DIR, '..')),
      trustProxy: !!env.TRUST_PROXY,
      corsOrigins: String(env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean),
      maxBodyBytes: Number(env.MAX_BODY_BYTES || 25 * 1024 * 1024),
      maxRecordBytes: Number(env.MAX_RECORD_BYTES || 3 * 1024 * 1024),
      sessionDays: Number(env.SESSION_DAYS || 30),
      poolSize: Number(env.PG_POOL_MAX || 10),
      bootstrapAdminUser: env.BOOTSTRAP_ADMIN_USER || '',
      bootstrapAdminPassword: env.BOOTSTRAP_ADMIN_PASSWORD || '',
    });
  }

  constructor(values = {}) {
    Object.assign(this, Config.defaults(), values);
    Object.freeze(this);
  }

  static defaults() {
    return {
      databaseUrl: '', port: 8080, host: undefined, appDir: path.join(SERVER_DIR, '..'), trustProxy: false,
      corsOrigins: [], maxBodyBytes: 25 * 1024 * 1024, maxRecordBytes: 3 * 1024 * 1024, sessionDays: 30,
      poolSize: 10, bootstrapAdminUser: '', bootstrapAdminPassword: '',
    };
  }

  /** A copy with some values changed (used by tests and scripts). */
  with(values) { return new Config({ ...this, ...values }); }
}

module.exports = { Config, SERVER_DIR };
