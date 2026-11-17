'use strict';

/** Record history and housekeeping: list a record's old versions, restore one, prune old data. */
class HistoryService {
  constructor({ database, history, records, sessions, events }) {
    Object.assign(this, { database, history, records, sessions, events });
  }

  versions(module, id) { return this.history.versionsOf(module, id); }

  /** Puts back the version that was current at `at`; phones pick it up on their next sync. Returns false if none. */
  async restore(module, id, at) {
    const old = await this.history.versionAt(module, id, at);
    if (!old) return false;
    await this.records.save(module, id, { ...old.data, _up: new Date().toISOString() }, old.deleted, null);
    return true;
  }

  async prune(days = 180) {
    return {
      history: await this.history.deleteOlderThan(days),
      sessions: await this.sessions.deleteExpired(),
      events: await this.events.deleteOlderThan(days),
    };
  }
}

module.exports = { HistoryService };
