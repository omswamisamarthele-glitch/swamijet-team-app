'use strict';
const { AuthService } = require('../../auth/AuthService');

/** /api/auth/*: login, logout, who am I. */
class AuthController {
  constructor({ auth }) { this.auth = auth; }

  routes(router) {
    router.add('POST', '/api/auth/login', req => this.login(req));
    router.add('POST', '/api/auth/logout', req => this.logout(req));
    router.add('GET', '/api/auth/me', req => this.me(req));
  }

  async login(req) {
    const body = await req.json();
    return this.auth.login({ username: body.username, password: body.password, ip: req.ip, userAgent: req.userAgent });
  }

  async logout(req) {
    await this.auth.logout(req.authorization);
    return { ok: true };
  }

  async me(req) {
    return { user: AuthService.toPublic(await this.auth.requireUser(req.authorization)) };
  }
}

module.exports = { AuthController };
