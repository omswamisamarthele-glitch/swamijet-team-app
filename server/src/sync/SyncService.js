'use strict';
const { RecordFields } = require('../domain/RecordFields');
const { Roles } = require('../domain/Roles');
const { ChangeRejected, ValidationError } = require('../domain/errors');
const { ChangeValidator } = require('./ChangeValidator');

/**
 * Record sync between phones and the server.
 *
 * push: applies each change on its own (one savepoint per change, one transaction per request), so one refused
 * change never blocks the others. A change carries the server version the phone last saw (baseVersion). If the
 * server copy has moved on, the change is applied only when its _up is newer, otherwise it is refused and the
 * server copy is returned for the phone to take.
 * pull: every record changed after a given change seq, oldest first, deleted records included.
 */
class SyncService {
  constructor({ database, records, events, users, sessions, policy, validator, wipeGuard, teamLogins }) {
    Object.assign(this, { database, records, events, users, sessions, policy, validator, wipeGuard, teamLogins });
  }

  /** What a phone receives for one record. */
  static toOutput(row) {
    return { module: row.module, id: row.id, data: RecordFields.withoutSecrets(row.data), deleted: row.deleted, version: row.version, seq: Number(row.seq) };
  }

  async push(user, changes, { confirmBulkDelete = false } = {}) {
    if (!Array.isArray(changes)) throw new ValidationError('changes must be an array');
    const results = await this.database.transaction(async tx => {
      const repos = this.#reposFor(tx);
      const blocked = await this.wipeGuard.blockedModules(repos, user, changes, { confirmBulkDelete });
      const out = [];
      for (const change of changes) out.push(await this.#applyOne(tx, repos, user, change, blocked));
      return out;
    });
    return { results, seq: await this.records.maxSeq() };
  }

  async pull(since, limit = 2000) {
    const from = Number(since) || 0;
    const max = Math.min(Math.max(Number(limit) || 2000, 1), 5000);
    const rows = await this.records.changesSince(from, max + 1);
    const page = rows.slice(0, max).map(SyncService.toOutput);
    return { changes: page, nextSince: page.length ? page[page.length - 1].seq : from, more: rows.length > max };
  }

  #reposFor(tx) {
    return { records: this.records.with(tx), events: this.events.with(tx), users: this.users.with(tx), sessions: this.sessions.with(tx) };
  }

  async #applyOne(tx, repos, user, change, blockedModules) {
    let id = change && change.id != null ? String(change.id) : null;
    try {
      return await tx.savepoint(async () => {
        id = this.validator.validate(change);
        return this.#decide(repos, user, change, id, blockedModules);
      });
    } catch (e) {
      if (!(e instanceof ChangeRejected)) throw e;
      if (e.kind !== 'bulk-delete-blocked') await repos.events.log(user, change && change.module, id, e.kind, e.message);
      const current = change && ChangeValidator.isModuleName(change.module) && id ? await repos.records.find(change.module, id) : null;
      return { module: change && change.module, id, status: 'rejected', code: e.kind, reason: e.message, record: current ? SyncService.toOutput(current) : null };
    }
  }

  async #decide({ records, events, users, sessions }, user, change, id, blockedModules) {
    const module = change.module;
    const current = await records.findForUpdate(module, id);
    const deleted = !!change.deleted || change.data._del === true;
    const toStore = d => RecordFields.withoutSecrets(deleted ? { ...d, _del: true } : d);

    // An identical copy (typical on a phone's first sync) changes nothing. A Team record carrying a password is never identical.
    if (current && !(module === 'team' && RecordFields.password(change.data)) && !current.deleted === !deleted
        && JSON.stringify(current.data) === JSON.stringify(toStore(change.data))) {
      return { module, id, status: 'applied', record: SyncService.toOutput(current) };
    }
    if (deleted && blockedModules.has(module)) throw new ChangeRejected('bulk delete blocked; ask an admin', 'bulk-delete-blocked');
    const data = this.policy.authorizeWrite(user, { module, id, data: change.data, deleted }, current);

    if (current && change.baseVersion !== current.version) {
      const incoming = RecordFields.updatedAt(data), onServer = RecordFields.updatedAt(current.data);
      if (!incoming || incoming <= onServer) {
        await events.log(user, module, id, 'conflict-rejected', `base ${change.baseVersion} vs server ${current.version}`);
        return { module, id, status: 'rejected', code: 'conflict', reason: 'newer version on server', record: SyncService.toOutput(current) };
      }
      await events.log(user, module, id, 'conflict-applied', `base ${change.baseVersion} vs server ${current.version}, newer _up`);
    }

    if (module === 'team') await this.teamLogins.apply({ users, sessions }, id, data, deleted);
    const row = await records.save(module, id, toStore(data), deleted, Roles.actorId(user));
    return { module, id, status: 'applied', record: SyncService.toOutput(row) };
  }
}

module.exports = { SyncService };
