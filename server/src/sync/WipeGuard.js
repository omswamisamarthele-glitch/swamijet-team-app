'use strict';
const { Roles } = require('../domain/Roles');

/**
 * Stops one request from deleting a large share of a module's live records (a phone with a broken or empty copy).
 * Modules the app trims on purpose are exempt; an admin can confirm a deliberate bulk delete.
 */
class WipeGuard {
  static TRIMMED_MODULES = Object.freeze(['activityLog', 'notifications', 'scoreCache']);

  constructor({ minDeletes = 10, maxShare = 0.2, trimmedModules = WipeGuard.TRIMMED_MODULES } = {}) {
    this.minDeletes = minDeletes;
    this.maxShare = maxShare;
    this.trimmed = new Set(trimmedModules);
  }

  /** Modules whose deletes in this request must be refused. Blocks are logged to sync_events. */
  async blockedModules({ records, events }, user, changes, { confirmBulkDelete = false } = {}) {
    const deletes = {};
    for (const c of changes) {
      if (c && c.deleted && !this.trimmed.has(c.module)) deletes[c.module] = (deletes[c.module] || 0) + 1;
    }
    const blocked = new Set();
    for (const [module, n] of Object.entries(deletes)) {
      if (n < this.minDeletes) continue;
      const live = await records.countLive(module);
      if (n > live * this.maxShare && !(confirmBulkDelete && Roles.isAdmin(user))) {
        blocked.add(module);
        await events.log(user, module, null, 'bulk-delete-blocked', `${n} of ${live} live records`);
      }
    }
    return blocked;
  }
}

module.exports = { WipeGuard };
