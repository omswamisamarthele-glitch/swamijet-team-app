'use strict';

/** Blocks a username + IP after too many failed logins within a time window (in memory, per server process). */
class LoginRateLimiter {
  constructor({ maxFailures = 10, windowMs = 15 * 60 * 1000, clock = () => Date.now() } = {}) {
    this.maxFailures = maxFailures;
    this.windowMs = windowMs;
    this.clock = clock;
    this.failures = new Map();
  }

  isBlocked(key) {
    const f = this.failures.get(key);
    if (!f) return false;
    if (this.clock() - f.first > this.windowMs) { this.failures.delete(key); return false; }
    return f.count >= this.maxFailures;
  }

  recordFailure(key) {
    const f = this.failures.get(key);
    if (!f || this.clock() - f.first > this.windowMs) this.failures.set(key, { count: 1, first: this.clock() });
    else f.count++;
  }

  recordSuccess(key) { this.failures.delete(key); }
}

module.exports = { LoginRateLimiter };
