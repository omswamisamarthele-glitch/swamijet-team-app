'use strict';
const { HttpError } = require('./HttpError');

/** Wraps an incoming request: URL, JSON body (size-limited), client IP, headers. */
class Request {
  constructor(req, { maxBodyBytes, trustProxy }) {
    this.raw = req;
    this.method = req.method;
    this.url = new URL(req.url, 'http://localhost');
    this.path = this.url.pathname;
    this.maxBodyBytes = maxBodyBytes;
    this.trustProxy = trustProxy;
  }

  header(name) { return this.raw.headers[name.toLowerCase()]; }
  query(name) { return this.url.searchParams.get(name); }
  get authorization() { return this.header('authorization'); }
  get userAgent() { return this.header('user-agent') || ''; }

  get ip() {
    const forwarded = this.trustProxy ? String(this.header('x-forwarded-for') || '').split(',')[0].trim() : '';
    return forwarded || this.raw.socket.remoteAddress || '';
  }

  json() {
    return new Promise((resolve, reject) => {
      let size = 0; const chunks = [];
      this.raw.on('data', c => {
        size += c.length;
        if (size > this.maxBodyBytes) { reject(new HttpError(413, 'request too large')); this.raw.destroy(); return; }
        chunks.push(c);
      });
      this.raw.on('end', () => {
        if (!chunks.length) return resolve({});
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch { reject(new HttpError(400, 'invalid JSON')); }
      });
      this.raw.on('error', reject);
    });
  }
}

module.exports = { Request };
