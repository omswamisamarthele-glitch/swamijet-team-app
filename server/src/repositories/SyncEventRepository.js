'use strict';
const { Repository } = require('./Repository');
const { Roles } = require('../domain/Roles');

/** Writes the server refused or overrode (table sync_events), for review. */
class SyncEventRepository extends Repository {
  log(actor, module, recordId, kind, detail) {
    return this.db.query('insert into sync_events(user_id, module, record_id, kind, detail) values ($1,$2,$3,$4,$5)',
      [Roles.actorId(actor), module, recordId, kind, String(detail || '').slice(0, 500)]);
  }
  recent(limit) { return this.many('select * from sync_events order by at desc limit $1', [limit]); }
  async deleteOlderThan(days) { return (await this.db.query('delete from sync_events where at < now() - make_interval(days => $1)', [days])).rowCount; }
}

module.exports = { SyncEventRepository };
