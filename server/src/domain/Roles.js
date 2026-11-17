'use strict';

/** Who may do what, by role name. Role names come from the app's Team records. */
class Roles {
  static ADMIN = Object.freeze(['owner', 'director', 'admin', 'superadmin']);
  /** The actor used by server-side scripts (import, demo data): treated as an admin, recorded as nobody. */
  static SYSTEM = Object.freeze({ system: true, role: 'Admin' });

  static isAdmin(user) { return !!user && (!!user.system || Roles.ADMIN.includes(String(user.role || '').toLowerCase())); }
  static isAccountant(user) { return !!user && String(user.role || '').toLowerCase() === 'accountant'; }
  static normalizeUsername(name) { return String(name || '').trim().toLowerCase(); }
  /** users.id of a real person, or null for the system actor. */
  static actorId(user) { return user && !user.system ? user.id : null; }
}

module.exports = { Roles };
