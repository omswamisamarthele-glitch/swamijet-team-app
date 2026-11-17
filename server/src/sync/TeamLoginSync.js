'use strict';
const { PasswordHasher } = require('../auth/PasswordHasher');
const { Roles } = require('../domain/Roles');
const { RecordFields } = require('../domain/RecordFields');
const { ChangeRejected } = require('../domain/errors');

/**
 * Keeps logins (users) in step with Team records: username, name, role and active come from the record,
 * and a password typed into it becomes the login's password. Deactivating a member signs them out.
 */
class TeamLoginSync {
  constructor({ hasher }) { this.hasher = hasher; }

  async apply({ users, sessions }, memberId, data, deleted) {
    const existing = await users.findByMemberId(memberId);
    const username = Roles.normalizeUsername(data.username || data.user || data.login);
    if (!username && !existing) return;                                 // a member without a login
    const finalUsername = username || existing.username;
    if (await users.isUsernameTakenByOther(finalUsername, memberId)) throw new ChangeRejected(`username "${finalUsername}" is already used`);

    const active = !deleted && RecordFields.isLive(data);
    const { pwScrypt, pwLegacy } = await this.#passwordFields(existing, RecordFields.password(data));
    if (existing) {
      await users.update(existing.id, { username: finalUsername, name: data.name || existing.name, role: data.role || existing.role,
        active, pwScrypt, pwLegacy });
      if (!active) await sessions.deleteForUser(existing.id);
    } else {
      await users.insert({ memberId, username: finalUsername, name: data.name || null, role: data.role || 'Staff', active, pwScrypt, pwLegacy });
    }
  }

  /**
   * The app sends either its old SHA-256 hash or plain text. pw_legacy_sha256 also remembers the last hash seen,
   * so an unchanged copy of a record never undoes a password already upgraded to scrypt.
   */
  async #passwordFields(existing, password) {
    let pwScrypt = existing ? existing.pw_scrypt : null;
    let pwLegacy = existing ? existing.pw_legacy_sha256 : null;
    if (password) {
      if (PasswordHasher.isLegacyHash(password)) {
        if (!existing || password.toLowerCase() !== existing.pw_legacy_sha256) { pwLegacy = password.toLowerCase(); pwScrypt = null; }
      } else if (!(existing && (await this.hasher.verify(existing, password)).ok)) {
        pwScrypt = await this.hasher.hash(password);
      }
    }
    return { pwScrypt, pwLegacy };
  }
}

module.exports = { TeamLoginSync };
