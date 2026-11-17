'use strict';
const { Repository } = require('./Repository');

/** Login sessions (table sessions). Only the sha256 of a token is stored. */
class SessionRepository extends Repository {
  create(tokenHash, userId, days, userAgent) {
    return this.db.query(`insert into sessions(token_hash, user_id, expires_at, user_agent)
                          values ($1, $2, now() + make_interval(days => $3), $4)`, [tokenHash, userId, days, String(userAgent || '').slice(0, 200)]);
  }

  /** The active user behind an unexpired session, with the session's token_hash and last_seen_at. */
  findUser(tokenHash) {
    return this.one(`select u.*, s.token_hash, s.last_seen_at from sessions s join users u on u.id = s.user_id
                      where s.token_hash = $1 and s.expires_at > now() and u.active`, [tokenHash]);
  }

  touch(tokenHash) { return this.db.query('update sessions set last_seen_at = now() where token_hash = $1', [tokenHash]); }
  delete(tokenHash) { return this.db.query('delete from sessions where token_hash = $1', [tokenHash]); }
  deleteForUser(userId) { return this.db.query('delete from sessions where user_id = $1', [userId]); }
  async deleteExpired() { return (await this.db.query('delete from sessions where expires_at < now()')).rowCount; }
}

module.exports = { SessionRepository };
