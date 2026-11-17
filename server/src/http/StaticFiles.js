'use strict';
const fs = require('fs');
const path = require('path');

/** Serves the app's own files (and nothing else) from the app folder. */
class StaticFiles {
  static FILES = Object.freeze(['index.html', 'sw.js', 'manifest.json', 'version.json', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png']);
  static NO_CACHE = Object.freeze(['index.html', 'sw.js', 'version.json', 'manifest.json']);
  static TYPES = Object.freeze({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8', '.png': 'image/png' });

  constructor({ appDir }) { this.appDir = appDir; }

  /** Returns false when the path is not one of the app's files (the caller answers 404). */
  serve(request, res, sendNotFound) {
    const name = request.path === '/' ? 'index.html' : request.path.replace(/^\/+/, '');
    if (!StaticFiles.FILES.includes(name)) return sendNotFound();
    const file = path.join(this.appDir, name);
    fs.stat(file, (err, stat) => {
      if (err) return sendNotFound();
      res.writeHead(200, {
        'Content-Type': StaticFiles.TYPES[path.extname(name)] || 'application/octet-stream',
        'Content-Length': stat.size,
        'Cache-Control': StaticFiles.NO_CACHE.includes(name) ? 'no-cache' : 'public, max-age=86400',
      });
      if (request.method === 'HEAD') return res.end();
      fs.createReadStream(file).pipe(res);
    });
  }
}

module.exports = { StaticFiles };
