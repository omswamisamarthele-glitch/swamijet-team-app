'use strict';

/** /api/sync: phones download changes (GET) and upload theirs (POST). */
class SyncController {
  constructor({ auth, sync }) { Object.assign(this, { auth, sync }); }

  routes(router) {
    router.add('GET', '/api/sync', req => this.pull(req));
    router.add('POST', '/api/sync', req => this.push(req));
  }

  async pull(req) {
    await this.auth.requireUser(req.authorization);
    return this.sync.pull(req.query('since'), req.query('limit'));
  }

  async push(req) {
    const user = await this.auth.requireUser(req.authorization);
    const body = await req.json();
    return this.sync.push(user, body.changes, { confirmBulkDelete: body.confirmBulkDelete === true });
  }
}

module.exports = { SyncController };
