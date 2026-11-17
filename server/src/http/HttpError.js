'use strict';
const { AppError } = require('../domain/errors');

/** An error with an HTTP status, raised by the HTTP layer itself (bad route, body too large ...). */
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }

  /** HTTP status for a domain error kind. */
  static STATUS_BY_KIND = Object.freeze({
    invalid: 400, 'bulk-delete-blocked': 400, denied: 400, unauthenticated: 401, forbidden: 403, 'rate-limited': 429,
  });

  /** Maps any error to { status, message }; unknown errors become a 500 with no detail for the client. */
  static from(error) {
    if (error instanceof HttpError) return { status: error.status, message: error.message };
    if (error instanceof AppError) return { status: HttpError.STATUS_BY_KIND[error.kind] || 400, message: error.message };
    return { status: 500, message: 'server error' };
  }
}

module.exports = { HttpError };
