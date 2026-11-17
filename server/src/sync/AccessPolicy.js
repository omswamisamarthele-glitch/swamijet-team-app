'use strict';
const { Roles } = require('../domain/Roles');
const { ChangeRejected } = require('../domain/errors');

/**
 * Who may change which records. One place for the write rules, so a role x module x action matrix
 * (plan Phase 2) can replace these defaults without touching the sync code.
 */
class AccessPolicy {
  /** Only admins or accountants may write these modules. */
  static RESTRICTED_MODULES = Object.freeze(['salaryPayments', 'salaryLocks', 'salaryOverrides', 'salHist',
    'paymentSettings', 'userPermissions', 'officeGps']);
  /** Fields a non-admin may not change on their own Team record. */
  static TEAM_PROTECTED_FIELDS = Object.freeze(['role', 'active', 'salType', 'rate', 'openBal', 'leaves', 'perms', 'permissions']);

  constructor({ restrictedModules = AccessPolicy.RESTRICTED_MODULES, teamProtectedFields = AccessPolicy.TEAM_PROTECTED_FIELDS } = {}) {
    this.restricted = new Set(restrictedModules);
    this.teamProtected = [...teamProtectedFields];
  }

  /**
   * Checks a write and returns the data to store (a staff member's own profile keeps its protected fields).
   * Throws ChangeRejected('denied') when the user may not make this change.
   */
  authorizeWrite(user, { module, id, data, deleted }, current) {
    if (this.restricted.has(module) && !Roles.isAdmin(user) && !Roles.isAccountant(user)) {
      throw new ChangeRejected(`only admin or accountant can change ${module}`);
    }
    if (module === 'team' && !Roles.isAdmin(user)) return this.#ownProfile(user, id, data, deleted, current);
    return data;
  }

  #ownProfile(user, id, data, deleted, current) {
    if (String(user.member_id) !== id) throw new ChangeRejected('you can only edit your own profile');
    if (deleted) throw new ChangeRejected('you cannot delete your own profile');
    if (!current) throw new ChangeRejected('profile not found');
    const out = { ...data };
    for (const f of this.teamProtected) {
      if (current.data[f] === undefined) delete out[f]; else out[f] = current.data[f];
    }
    return out;
  }
}

module.exports = { AccessPolicy };
