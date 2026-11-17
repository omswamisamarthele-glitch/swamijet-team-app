'use strict';
const { Roles } = require('../../domain/Roles');
const { ForbiddenError } = require('../../domain/errors');

/** /api/admin/*: admin-only views. */
class AdminController {
  constructor({ auth, events }) { Object.assign(this, { auth, events }); }

  routes(router) {
    router.add('GET', '/api/admin/events', req => this.listEvents(req));
  }

  /** Recent refused or overridden writes. */
  async listEvents(req) {
    const user = await this.auth.requireUser(req.authorization);
    if (!Roles.isAdmin(user)) throw new ForbiddenError('admin only');
    const limit = Math.min(Number(req.query('limit')) || 100, 500);
    return { events: await this.events.recent(limit) };
  }
}

module.exports = { AdminController };
