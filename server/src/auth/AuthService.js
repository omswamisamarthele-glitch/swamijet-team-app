'use strict';
const crypto = require('crypto');
const { PasswordHasher } = require('./PasswordHasher');
const { Roles } = require('../domain/Roles');
const { ValidationError, AuthenticationError, TooManyAttemptsError } = require('../domain/errors');

const TOUCH_AFTER_MS = 5 * 60 * 1000;

/** Logins and sessions: checks passwords, issues and resolves bearer tokens, manages admin logins. */
class AuthService {
  constructor({ users, sessions, hasher, rateLimiter, sessionDays = 30, logger = console }) {
    Object.assign(this, { users, sessions, hasher, rateLimiter, sessionDays, logger });
  }

  /** What a phone may know about a login. */
  static toPublic(user) {
    return { userId: String(user.id), memberId: user.member_id, username: user.username, name: user.name, role: user.role };
  }

  async login({ username, password, ip = '', userAgent = '' }) {
    const name = Roles.normalizeUsername(username);
    if (!name || !password) throw new ValidationError('username and password required');
    const key = `${ip}|${name}`;
    if (this.rateLimiter.isBlocked(key)) throw new TooManyAttemptsError('too many attempts; wait 15 minutes');
    const user = await this.users.findActiveByUsername(name);
    const check = user ? await this.hasher.verify(user, password) : { ok: false };
    if (!check.ok) {
      this.rateLimiter.recordFailure(key);
      throw new AuthenticationError('invalid username or password');
    }
    this.rateLimiter.recordSuccess(key);
    if (check.upgrade) await this.users.setScrypt(user.id, await this.hasher.hash(password));
    const token = crypto.randomBytes(32).toString('base64url');
    await this.sessions.create(PasswordHasher.sha256Hex(token), user.id, this.sessionDays, userAgent);
    return { token, user: AuthService.toPublic(user) };
  }

  /** The active user for an "Authorization: Bearer <token>" header, or null. */
  async authenticate(authorizationHeader) {
    const m = /^Bearer\s+(\S+)$/i.exec(authorizationHeader || '');
    if (!m) return null;
    const user = await this.sessions.findUser(PasswordHasher.sha256Hex(m[1]));
    if (user && Date.now() - new Date(user.last_seen_at).getTime() > TOUCH_AFTER_MS) {
      this.sessions.touch(user.token_hash).catch(() => {});
    }
    return user;
  }

  async requireUser(authorizationHeader) {
    const user = await this.authenticate(authorizationHeader);
    if (!user) throw new AuthenticationError();
    return user;
  }

  async logout(authorizationHeader) {
    const user = await this.authenticate(authorizationHeader);
    if (user) await this.sessions.delete(user.token_hash);
  }

  /** First run only: an admin login from settings while the database has no users. Returns the username or null. */
  async bootstrapAdmin(username, password) {
    const name = Roles.normalizeUsername(username);
    if (!name || !password || (await this.users.countAll()) > 0) return null;
    if (String(password).length < 8) throw new ValidationError('BOOTSTRAP_ADMIN_PASSWORD must be at least 8 characters');
    await this.users.insert({ username: name, name: 'Admin', role: 'Admin', pwScrypt: await this.hasher.hash(password) });
    this.logger.log(`bootstrap admin "${name}" created`);
    return name;
  }

  /** An admin login with no Team record (recovery or a fresh install). */
  async createAdmin(username, password, displayName = 'Admin') {
    const name = Roles.normalizeUsername(username);
    if (!name || String(password || '').length < 8) throw new ValidationError('username and a password of at least 8 characters required');
    await this.users.insert({ username: name, name: displayName, role: 'Admin', pwScrypt: await this.hasher.hash(password) });
    return name;
  }

  /** New password, login re-activated, signed out everywhere. Returns false if there is no such username. */
  async resetPassword(username, password) {
    const name = Roles.normalizeUsername(username);
    if (String(password || '').length < 6) throw new ValidationError('password must be at least 6 characters');
    const id = await this.users.resetPassword(name, await this.hasher.hash(password));
    if (!id) return false;
    await this.sessions.deleteForUser(id);
    return true;
  }
}

module.exports = { AuthService };
