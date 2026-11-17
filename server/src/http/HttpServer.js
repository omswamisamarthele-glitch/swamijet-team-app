'use strict';
const http = require('http');
const { HttpError } = require('./HttpError');
const { Request } = require('./Request');

/**
 * The HTTP front: /api/* goes to the router (JSON in, JSON out, CORS for configured origins),
 * everything else to the app's static files. Errors become JSON { error } with the mapped status.
 */
class HttpServer {
  constructor({ router, staticFiles, config, logger = console }) {
    Object.assign(this, { router, staticFiles, config, logger });
    this.handle = this.handle.bind(this);
    this.server = null;
  }

  static send(res, status, body) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(body));
  }

  /** The node:http request listener (also used directly by tests). */
  async handle(rawReq, res) {
    this.#securityHeaders(res);
    const req = new Request(rawReq, this.config);
    try {
      if (req.path.startsWith('/api/')) {
        this.#cors(req, res);
        if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
        const route = this.router.find(req.method, req.path);
        if (!route) throw new HttpError(404, 'not found');
        return HttpServer.send(res, 200, await route(req));
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'method not allowed');
      return this.staticFiles.serve(req, res, () => HttpServer.send(res, 404, { error: 'not found' }));
    } catch (e) {
      const { status, message } = HttpError.from(e);
      if (status === 500) this.logger.error(new Date().toISOString(), req.method, req.path, e);
      return HttpServer.send(res, status, { error: message });
    }
  }

  listen(port, host) {
    return new Promise((resolve, reject) => {
      this.server = http.createServer(this.handle);
      this.server.once('error', reject);
      this.server.listen(port, host, () => resolve(this.server));
    });
  }

  close() { return new Promise(resolve => (this.server ? this.server.close(() => resolve()) : resolve())); }

  #securityHeaders(res) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  }

  #cors(req, res) {
    const origin = req.header('origin');
    if (!origin || !this.config.corsOrigins.includes(origin)) return;
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Max-Age', '600');
  }
}

module.exports = { HttpServer };
