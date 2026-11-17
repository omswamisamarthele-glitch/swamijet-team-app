'use strict';

/** Exact "METHOD /path" routes to async handlers (request) => response body. */
class Router {
  constructor() { this.routes = new Map(); }

  add(method, path, handler) {
    this.routes.set(`${method} ${path}`, handler);
    return this;
  }

  /** Lets a controller register its own routes: controller.routes(router). */
  mount(controller) {
    controller.routes(this);
    return this;
  }

  find(method, path) { return this.routes.get(`${method} ${path}`) || null; }
}

module.exports = { Router };
