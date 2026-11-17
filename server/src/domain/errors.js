'use strict';

/** Base class for expected failures; `kind` says what went wrong, the HTTP layer maps it to a status code. */
class AppError extends Error {
  constructor(message, kind) { super(message); this.name = this.constructor.name; this.kind = kind; }
}
class ValidationError extends AppError { constructor(message) { super(message, 'invalid'); } }
class AuthenticationError extends AppError { constructor(message = 'login required') { super(message, 'unauthenticated'); } }
class ForbiddenError extends AppError { constructor(message) { super(message, 'forbidden'); } }
class TooManyAttemptsError extends AppError { constructor(message) { super(message, 'rate-limited'); } }

/**
 * One change refused by the sync rules. It never fails the whole request: the change is reported back
 * as rejected, with `kind` as its code (denied | invalid | bulk-delete-blocked).
 */
class ChangeRejected extends AppError {
  constructor(message, kind = 'denied') { super(message, kind); }
}

module.exports = { AppError, ValidationError, AuthenticationError, ForbiddenError, TooManyAttemptsError, ChangeRejected };
