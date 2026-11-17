'use strict';
const crypto = require('crypto');

/** scrypt password hashes ("scrypt$N$r$p$salt$hash"), plus checking the old app's unsalted SHA-256 hashes. */
class PasswordHasher {
  constructor({ N = 16384, r = 8, p = 1, keyLength = 64 } = {}) {
    Object.assign(this, { N, r, p, keyLength });
  }

  static sha256Hex(text) { return crypto.createHash('sha256').update(String(text)).digest('hex'); }
  static isLegacyHash(value) { return /^[0-9a-f]{64}$/i.test(String(value || '')); }

  async hash(password) {
    const salt = crypto.randomBytes(16);
    const key = await this.#scrypt(String(password).trim(), salt, this.N, this.r, this.p);
    return ['scrypt', this.N, this.r, this.p, salt.toString('base64'), key.toString('base64')].join('$');
  }

  /** -> { ok, upgrade }; upgrade is true when only the old SHA-256 hash matched and should become scrypt. */
  async verify(user, password) {
    const typed = String(password || '').trim();
    if (!typed) return { ok: false };
    if (user.pw_scrypt) {
      const [, N, r, p, salt, hash] = user.pw_scrypt.split('$');
      const key = await this.#scrypt(typed, Buffer.from(salt, 'base64'), Number(N), Number(r), Number(p));
      return { ok: PasswordHasher.#safeEqual(key.toString('base64'), hash) };
    }
    if (user.pw_legacy_sha256) {
      return { ok: PasswordHasher.#safeEqual(PasswordHasher.sha256Hex(typed), user.pw_legacy_sha256.toLowerCase()), upgrade: true };
    }
    return { ok: false };
  }

  #scrypt(password, salt, N, r, p) {
    return new Promise((resolve, reject) =>
      crypto.scrypt(password, salt, this.keyLength, { N, r, p, maxmem: 64 * 1024 * 1024 }, (e, k) => (e ? reject(e) : resolve(k))));
  }

  static #safeEqual(a, b) {
    const x = Buffer.from(String(a)), y = Buffer.from(String(b));
    return x.length === y.length && crypto.timingSafeEqual(x, y);
  }
}

module.exports = { PasswordHasher };
