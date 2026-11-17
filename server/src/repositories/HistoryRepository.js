'use strict';
const { Repository } = require('./Repository');

/** Overwritten versions of records (table records_history, filled by a database trigger). */
class HistoryRepository extends Repository {
  versionsOf(module, id, limit = 50) {
    return this.many(`select version, deleted, updated_at, archived_at from records_history
                      where module=$1 and id=$2 order by archived_at desc limit $3`, [module, id, limit]);
  }
  /** The version that was current at `at`. */
  versionAt(module, id, at) {
    return this.one(`select data, deleted from records_history where module=$1 and id=$2 and updated_at <= $3
                     order by updated_at desc limit 1`, [module, id, at]);
  }
  async deleteOlderThan(days) { return (await this.db.query('delete from records_history where archived_at < now() - make_interval(days => $1)', [days])).rowCount; }
}

module.exports = { HistoryRepository };
