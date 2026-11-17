'use strict';

/** /api/health: is the server up and can it reach the database. */
class HealthController {
  constructor({ database }) { this.database = database; }

  routes(router) {
    router.add('GET', '/api/health', () => this.health());
  }

  async health() {
    await this.database.query('select 1');
    return { ok: true, time: new Date().toISOString() };
  }
}

module.exports = { HealthController };
