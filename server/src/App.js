'use strict';
const { Config } = require('./config/Config');
const { Database } = require('./db/Database');
const { Migrator } = require('./db/Migrator');
const { UserRepository } = require('./repositories/UserRepository');
const { SessionRepository } = require('./repositories/SessionRepository');
const { RecordRepository } = require('./repositories/RecordRepository');
const { SyncEventRepository } = require('./repositories/SyncEventRepository');
const { HistoryRepository } = require('./repositories/HistoryRepository');
const { PasswordHasher } = require('./auth/PasswordHasher');
const { LoginRateLimiter } = require('./auth/LoginRateLimiter');
const { AuthService } = require('./auth/AuthService');
const { AccessPolicy } = require('./sync/AccessPolicy');
const { ChangeValidator } = require('./sync/ChangeValidator');
const { WipeGuard } = require('./sync/WipeGuard');
const { TeamLoginSync } = require('./sync/TeamLoginSync');
const { SyncService } = require('./sync/SyncService');
const { HistoryService } = require('./history/HistoryService');
const { Router } = require('./http/Router');
const { StaticFiles } = require('./http/StaticFiles');
const { HttpServer } = require('./http/HttpServer');
const { AuthController } = require('./http/controllers/AuthController');
const { SyncController } = require('./http/controllers/SyncController');
const { AdminController } = require('./http/controllers/AdminController');
const { HealthController } = require('./http/controllers/HealthController');

/**
 * Composition root: builds every object once and wires them together (constructor injection).
 * The server, the CLI scripts and the tests all start from here, so they share the same rules.
 */
class App {
  constructor(config = Config.fromEnv(), { logger = console } = {}) {
    this.config = config;
    this.logger = logger;
    this.database = new Database({ url: config.databaseUrl, poolSize: config.poolSize });
    this.migrator = new Migrator(this.database);

    this.repositories = {
      users: new UserRepository(this.database),
      sessions: new SessionRepository(this.database),
      records: new RecordRepository(this.database),
      events: new SyncEventRepository(this.database),
      history: new HistoryRepository(this.database),
    };
    const { users, sessions, records, events, history } = this.repositories;

    this.hasher = new PasswordHasher();
    this.auth = new AuthService({ users, sessions, hasher: this.hasher, rateLimiter: new LoginRateLimiter(), sessionDays: config.sessionDays, logger });
    this.sync = new SyncService({
      database: this.database, records, events, users, sessions,
      policy: new AccessPolicy(),
      validator: new ChangeValidator({ maxRecordBytes: config.maxRecordBytes }),
      wipeGuard: new WipeGuard(),
      teamLogins: new TeamLoginSync({ hasher: this.hasher }),
    });
    this.history = new HistoryService({ database: this.database, history, records, sessions, events });

    const router = new Router()
      .mount(new HealthController({ database: this.database }))
      .mount(new AuthController({ auth: this.auth }))
      .mount(new SyncController({ auth: this.auth, sync: this.sync }))
      .mount(new AdminController({ auth: this.auth, events }));
    this.http = new HttpServer({ router, staticFiles: new StaticFiles({ appDir: config.appDir }), config, logger });
  }

  /** Database schema up to date, and the first-run admin login if configured. */
  async prepare() {
    const applied = await this.migrator.run();
    if (applied.length) this.logger.log('migrations applied:', applied.join(', '));
    await this.auth.bootstrapAdmin(this.config.bootstrapAdminUser, this.config.bootstrapAdminPassword);
    return applied;
  }

  async start() {
    await this.prepare();
    await this.http.listen(this.config.port, this.config.host);
    this.logger.log(`swamijet server on :${this.config.port}, app from ${this.config.appDir}\nOpen http://localhost:${this.config.port}`);
  }

  async stop() {
    await this.http.close();
    await this.database.close();
  }
}

module.exports = { App };
