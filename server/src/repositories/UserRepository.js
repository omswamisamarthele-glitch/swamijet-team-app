'use strict';
const { Repository } = require('./Repository');

/** Logins (table users). A Team record with a username has one row here, linked by member_id. */
class UserRepository extends Repository {
  countAll() { return this.count('select count(*) from users'); }
  findActiveByUsername(username) { return this.one('select * from users where username = $1 and active', [username]); }
  findByMemberId(memberId) { return this.one('select * from users where member_id = $1', [memberId]); }
  list() { return this.many('select id, username, role, active, (pw_scrypt is not null or pw_legacy_sha256 is not null) as has_password from users order by id'); }

  async isUsernameTakenByOther(username, memberId) {
    return !!(await this.one('select id from users where username = $1 and member_id is distinct from $2', [username, memberId]));
  }

  insert({ memberId = null, username, name = null, role = 'Staff', active = true, pwScrypt = null, pwLegacy = null }) {
    return this.one(`insert into users(member_id, username, name, role, active, pw_scrypt, pw_legacy_sha256)
                     values ($1,$2,$3,$4,$5,$6,$7) returning *`, [memberId, username, name, role, active, pwScrypt, pwLegacy]);
  }

  update(id, { username, name, role, active, pwScrypt, pwLegacy }) {
    return this.one(`update users set username=$2, name=$3, role=$4, active=$5, pw_scrypt=$6, pw_legacy_sha256=$7, updated_at=now()
                     where id=$1 returning *`, [id, username, name, role, active, pwScrypt, pwLegacy]);
  }

  setScrypt(id, pwScrypt) { return this.db.query('update users set pw_scrypt = $2, updated_at = now() where id = $1', [id, pwScrypt]); }

  /** Sets a new password and re-activates the login; returns the user id, or null if there is no such username. */
  async resetPassword(username, pwScrypt) {
    const row = await this.one('update users set pw_scrypt = $2, active = true, updated_at = now() where username = $1 returning id', [username, pwScrypt]);
    return row ? row.id : null;
  }
}

module.exports = { UserRepository };
