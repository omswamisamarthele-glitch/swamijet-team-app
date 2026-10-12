'use strict';
const { isAdmin, isAccountant, normUser, isLegacyHash, hashPassword, verifyPassword } = require('./auth');

// Only admins or accountants may write these modules.
const RESTRICTED = new Set(['salaryPayments', 'salaryLocks', 'salaryOverrides', 'salHist',
  'paymentSettings', 'userPermissions', 'officeGps']);
// The app trims these on purpose, so mass removal is normal for them.
const TRIMMED = new Set(['activityLog', 'notifications', 'scoreCache']);
// Fields a non-admin may not change on their own team record.
const TEAM_PROTECTED = ['role', 'active', 'salType', 'rate', 'openBal', 'leaves', 'perms', 'permissions'];
// Never stored or sent: passwords live only in users.pw_*.
const SECRET_FIELDS = ['password', 'pass', 'pw'];

const MODULE_RE = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const MAX_RECORD_BYTES = Number(process.env.MAX_RECORD_BYTES || 3 * 1024 * 1024);
const BULK_DELETE_MIN = 10, BULK_DELETE_SHARE = 0.2;

const stripSecrets = d => {
  if (!d || typeof d !== 'object' || Array.isArray(d)) return d;
  const out = { ...d };
  for (const f of SECRET_FIELDS) delete out[f];
  return out;
};
const pickPassword = d => {
  if (!d || typeof d !== 'object') return '';
  for (const f of SECRET_FIELDS) if (typeof d[f] === 'string' && d[f].trim()) return d[f].trim();
  return '';
};
const isLive = d => !!d && d._del !== true && d.active !== false;
const outRecord = r => ({ module: r.module, id: r.id, data: stripSecrets(r.data), deleted: r.deleted, version: r.version, seq: Number(r.seq) });

async function logEvent(db, user, module, id, kind, detail) {
  await db.query('insert into sync_events(user_id, module, record_id, kind, detail) values ($1,$2,$3,$4,$5)',
    [user && !user.system ? user.id : null, module, id, kind, String(detail || '').slice(0, 500)]);
}

class Reject extends Error {
  constructor(reason, kind = 'denied') { super(reason); this.kind = kind; }
}

// Keep the users table in step with a team record. Throws Reject on a username clash.
async function syncUser(db, memberId, data, deleted) {
  const existing = (await db.query('select * from users where member_id = $1', [memberId])).rows[0];
  const username = normUser(data.username || data.user || data.login);
  if (!username && !existing) return;                       // member without a login
  const finalUsername = username || existing.username;
  const clash = (await db.query('select id from users where username = $1 and member_id is distinct from $2',
    [finalUsername, memberId])).rows[0];
  if (clash) throw new Reject(`username "${finalUsername}" is already used`);

  const active = !deleted && isLive(data);
  const pw = pickPassword(data);
  let scrypt = existing ? existing.pw_scrypt : null, legacy = existing ? existing.pw_legacy_sha256 : null;
  // The app sends either its SHA-256 hash or plain text. pw_legacy_sha256 also remembers the last
  // hash seen, so an unchanged copy never undoes a password already upgraded to scrypt.
  if (pw) {
    if (isLegacyHash(pw)) {
      if (!existing || pw.toLowerCase() !== existing.pw_legacy_sha256) { legacy = pw.toLowerCase(); scrypt = null; }
    } else if (!(existing && (await verifyPassword(existing, pw)).ok)) {
      scrypt = await hashPassword(pw);
    }
  }
  if (existing) {
    await db.query(`update users set username=$2, name=$3, role=$4, active=$5, pw_scrypt=$6, pw_legacy_sha256=$7, updated_at=now()
                     where id=$1`, [existing.id, finalUsername, data.name || existing.name, data.role || existing.role, active, scrypt, legacy]);
    if (!active) await db.query('delete from sessions where user_id = $1', [existing.id]);
  } else {
    await db.query(`insert into users(member_id, username, name, role, active, pw_scrypt, pw_legacy_sha256)
                    values ($1,$2,$3,$4,$5,$6,$7)`, [memberId, finalUsername, data.name || null, data.role || 'Staff', active, scrypt, legacy]);
  }
}

function validate(c) {
  if (!c || typeof c !== 'object') throw new Reject('bad change', 'invalid');
  if (!MODULE_RE.test(String(c.module || ''))) throw new Reject('bad module name', 'invalid');
  const id = String(c.id == null ? '' : c.id);
  if (!id || id.length > 100) throw new Reject('bad record id', 'invalid');
  if (c.data === null || typeof c.data !== 'object') throw new Reject('record data must be an object', 'invalid');
  if (Buffer.byteLength(JSON.stringify(c.data)) > MAX_RECORD_BYTES) throw new Reject('record too large', 'invalid');
  return id;
}

/**
 * Apply client changes. Each change: { module, id, data, deleted, baseVersion }.
 * baseVersion = server version the client last saw (null for a record it never synced).
 * Rule: a change based on an older version is applied only if its _up is newer than the
 * server copy's _up; otherwise it is rejected and the server copy is returned.
 */
async function push(pool, user, changes, opts = {}) {
  if (!Array.isArray(changes)) throw new Reject('changes must be an array', 'invalid');
  const client = await pool.connect();
  const results = [];
  try {
    await client.query('begin');

    // Wipe guard: a request may not remove a large share of a module's live records.
    const blockedModules = new Set();
    const deletesByModule = {};
    for (const c of changes) if (c && c.deleted && !TRIMMED.has(c.module)) deletesByModule[c.module] = (deletesByModule[c.module] || 0) + 1;
    for (const [mod, n] of Object.entries(deletesByModule)) {
      if (n < BULK_DELETE_MIN) continue;
      const live = Number((await client.query('select count(*) from records where module=$1 and not deleted', [mod])).rows[0].count);
      if (n > live * BULK_DELETE_SHARE && !(opts.confirmBulkDelete && isAdmin(user))) {
        blockedModules.add(mod);
        await logEvent(client, user, mod, null, 'bulk-delete-blocked', `${n} of ${live} live records`);
      }
    }

    for (const c of changes) {
      await client.query('savepoint ch');
      let id = c && c.id != null ? String(c.id) : null;
      try {
        id = validate(c);
        const mod = c.module;
        const cur = (await client.query('select * from records where module=$1 and id=$2 for update', [mod, id])).rows[0];
        let data = c.data;
        const deleted = !!c.deleted || data._del === true;

        // An identical copy (typical on a phone's first sync) changes nothing.
        if (cur && !(mod === 'team' && pickPassword(data)) && !cur.deleted === !deleted && JSON.stringify(cur.data) === JSON.stringify(stripSecrets(deleted ? { ...data, _del: true } : data))) {
          results.push({ module: mod, id, status: 'applied', record: outRecord(cur) });
          await client.query('release savepoint ch');
          continue;
        }

        if (deleted && blockedModules.has(mod)) throw new Reject('bulk delete blocked; ask an admin', 'bulk-delete-blocked');
        if (RESTRICTED.has(mod) && !isAdmin(user) && !isAccountant(user)) throw new Reject(`only admin or accountant can change ${mod}`);
        if (mod === 'team' && !isAdmin(user)) {
          if (String(user.member_id) !== id) throw new Reject('you can only edit your own profile');
          if (deleted) throw new Reject('you cannot delete your own profile');
          if (!cur) throw new Reject('profile not found');
          data = { ...data };
          for (const f of TEAM_PROTECTED) {
            if (cur.data[f] === undefined) delete data[f]; else data[f] = cur.data[f];
          }
        }

        if (cur && c.baseVersion !== cur.version) {
          const incomingUp = String(data._up || data.updatedAt || '');
          const serverUp = String(cur.data._up || cur.data.updatedAt || '');
          if (!incomingUp || incomingUp <= serverUp) {
            await logEvent(client, user, mod, id, 'conflict-rejected', `base ${c.baseVersion} vs server ${cur.version}`);
            results.push({ module: mod, id, status: 'rejected', reason: 'newer version on server', record: outRecord(cur) });
            await client.query('release savepoint ch');
            continue;
          }
          await logEvent(client, user, mod, id, 'conflict-applied', `base ${c.baseVersion} vs server ${cur.version}, newer _up`);
        }

        if (mod === 'team') await syncUser(client, id, data, deleted);
        const stored = stripSecrets(deleted ? { ...data, _del: true } : data);
        const row = (await client.query(
          `insert into records(module, id, data, deleted, updated_by) values ($1,$2,$3,$4,$5)
           on conflict (module, id) do update set data=excluded.data, deleted=excluded.deleted,
             version=records.version+1, seq=nextval('change_seq'), updated_at=now(), updated_by=excluded.updated_by
           returning *`,
          [mod, id, stored, deleted, user && !user.system ? user.id : null])).rows[0];
        results.push({ module: mod, id, status: 'applied', record: outRecord(row) });
        await client.query('release savepoint ch');
      } catch (e) {
        await client.query('rollback to savepoint ch');
        if (!(e instanceof Reject)) throw e;
        if (e.kind !== 'bulk-delete-blocked') await logEvent(client, user, c && c.module, id, e.kind, e.message);
        const cur = c && MODULE_RE.test(String(c.module || '')) && id
          ? (await client.query('select * from records where module=$1 and id=$2', [c.module, id])).rows[0] : null;
        results.push({ module: c && c.module, id, status: 'rejected', reason: e.message, record: cur ? outRecord(cur) : null });
      }
    }
    await client.query('commit');
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
  return { results, seq: await currentSeq(pool) };
}

async function currentSeq(db) {
  return Number((await db.query('select coalesce(max(seq), 0) as s from records')).rows[0].s);
}

// Changes after `since`, oldest first. Deleted records are included so devices drop them.
async function pull(pool, since, limit = 2000) {
  const lim = Math.min(Math.max(Number(limit) || 2000, 1), 5000);
  const { rows } = await pool.query('select * from records where seq > $1 order by seq limit $2', [Number(since) || 0, lim + 1]);
  const more = rows.length > lim;
  const page = rows.slice(0, lim).map(outRecord);
  return { changes: page, nextSince: page.length ? page[page.length - 1].seq : Number(since) || 0, more };
}

module.exports = { push, pull, currentSeq, stripSecrets, RESTRICTED, TRIMMED, Reject };
