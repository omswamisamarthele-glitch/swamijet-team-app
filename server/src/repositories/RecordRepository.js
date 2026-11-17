'use strict';
const { Repository } = require('./Repository');

/** App records (table records): one row per record of a module, with the server's version and change seq. */
class RecordRepository extends Repository {
  find(module, id) { return this.one('select * from records where module=$1 and id=$2', [module, id]); }
  /** Same, and locks the row until the transaction ends. */
  findForUpdate(module, id) { return this.one('select * from records where module=$1 and id=$2 for update', [module, id]); }
  countLive(module) { return this.count('select count(*) from records where module=$1 and not deleted', [module]); }
  isEmpty() { return this.count('select count(*) from records').then(n => n === 0); }
  countAll() { return this.count('select count(*) from records'); }
  versions() { return this.many('select module, id, version from records'); }

  /** Insert, or replace and bump the version; every write gets a new change seq. */
  save(module, id, data, deleted, actorId) {
    return this.one(`insert into records(module, id, data, deleted, updated_by) values ($1,$2,$3,$4,$5)
                     on conflict (module, id) do update set data=excluded.data, deleted=excluded.deleted,
                       version=records.version+1, seq=nextval('change_seq'), updated_at=now(), updated_by=excluded.updated_by
                     returning *`, [module, id, data, deleted, actorId]);
  }

  changesSince(since, limit) { return this.many('select * from records where seq > $1 order by seq limit $2', [since, limit]); }
  async maxSeq() { return Number((await this.one('select coalesce(max(seq), 0) as s from records')).s); }
}

module.exports = { RecordRepository };
