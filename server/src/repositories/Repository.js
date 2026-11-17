'use strict';

/**
 * Base for data-access classes. All SQL lives in repositories. `executor` is the Database or an open
 * Transaction (both have query()); with(tx) returns the same repository bound to a transaction.
 */
class Repository {
  constructor(executor) { this.db = executor; }
  with(executor) { return new this.constructor(executor); }
  async one(text, params) { return (await this.db.query(text, params)).rows[0] || null; }
  async many(text, params) { return (await this.db.query(text, params)).rows; }
  async count(text, params) { return Number((await this.db.query(text, params)).rows[0].count); }
}

module.exports = { Repository };
