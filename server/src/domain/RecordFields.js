'use strict';

/** Helpers for the fields of an app record (a plain object from the phone). */
class RecordFields {
  /** Never stored or sent: passwords live only in users.pw_*. */
  static SECRET = Object.freeze(['password', 'pass', 'pw']);

  static withoutSecrets(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return data;
    const out = { ...data };
    for (const f of RecordFields.SECRET) delete out[f];
    return out;
  }

  /** The password typed into a Team record, if any. */
  static password(data) {
    if (!data || typeof data !== 'object') return '';
    for (const f of RecordFields.SECRET) if (typeof data[f] === 'string' && data[f].trim()) return data[f].trim();
    return '';
  }

  /** Not soft-deleted and not deactivated. */
  static isLive(data) { return !!data && data._del !== true && data.active !== false; }

  /** When the phone last changed it (ISO text), used only to break ties with an outdated copy. */
  static updatedAt(data) { return String((data && (data._up || data.updatedAt)) || ''); }
}

module.exports = { RecordFields };
