'use strict';
const { Roles } = require('../domain/Roles');

/**
 * Moves the old app_data blobs (one JSON array per module, as Supabase stored them) into server records,
 * through SyncService so the same rules apply as for phones (Team passwords become logins, secrets stripped).
 * Without overwrite, a record already on the server is replaced only if the imported copy has a newer _up.
 */
class LegacyImporter {
  constructor({ sync, records, batchSize = 500 }) { Object.assign(this, { sync, records, batchSize }); }

  /** Accepts {"team":[...], ...} or app_data rows [{key, value}], where value may be JSON text. */
  static normalize(raw) {
    const out = {};
    if (Array.isArray(raw)) {
      for (const row of raw) {
        if (!row || !row.key) continue;
        out[row.key] = typeof row.value === 'string' ? JSON.parse(row.value) : row.value;
      }
    } else Object.assign(out, raw);
    return out;
  }

  /** Reads app_data straight from a Supabase project with its anon key. */
  static async fetchFromSupabase(projectUrl, anonKey) {
    const r = await fetch(projectUrl.replace(/\/+$/, '') + '/rest/v1/app_data?select=key,value',
      { headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` } });
    if (!r.ok) throw new Error(`Supabase read failed: ${r.status} ${(await r.text()).slice(0, 200)}`);
    return r.json();
  }

  /** Team first (so logins exist), then the other modules. Calls onModule(name, count) and onRejected(result). */
  async import(raw, { overwrite = false, onModule = () => {}, onRejected = () => {} } = {}) {
    const data = LegacyImporter.normalize(raw);
    const versions = new Map((await this.records.versions()).map(r => [`${r.module}\u0000${r.id}`, r.version]));
    const modules = Object.keys(data).sort((a, b) => (a === 'team' ? -1 : b === 'team' ? 1 : a.localeCompare(b)));
    const totals = { imported: 0, rejected: 0, skipped: 0 };
    for (const module of modules) {
      const { changes, skipped } = this.#changesFor(module, data[module], versions, overwrite);
      if (!changes) continue;
      totals.skipped += skipped;
      for (let i = 0; i < changes.length; i += this.batchSize) {
        const { results } = await this.sync.push(Roles.SYSTEM, changes.slice(i, i + this.batchSize), { confirmBulkDelete: true });
        for (const r of results) {
          if (r.status === 'applied') totals.imported++;
          else { totals.rejected++; onRejected(r); }
        }
      }
      onModule(module, changes.length);
    }
    return totals;
  }

  #changesFor(module, value, versions, overwrite) {
    const changes = [];
    let skipped = 0;
    const add = (id, rec) => changes.push({
      module, id: String(id), data: rec, deleted: rec._del === true,
      // overwrite claims the current server version, so the imported copy always wins
      baseVersion: overwrite ? versions.get(`${module}\u0000${id}`) : null,
    });
    if (Array.isArray(value)) {
      for (const rec of value) {
        if (!rec || typeof rec !== 'object' || rec.id == null || rec.id === '') { skipped++; continue; }
        add(rec.id, rec);
      }
    } else if (value && typeof value === 'object') add('_', value);
    else return { changes: null, skipped };
    return { changes, skipped };
  }
}

module.exports = { LegacyImporter };
