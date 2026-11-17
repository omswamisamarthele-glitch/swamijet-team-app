'use strict';
const { ChangeRejected } = require('../domain/errors');

const MODULE_NAME = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

/** Checks the shape of one change sent by a phone: { module, id, data, deleted, baseVersion }. */
class ChangeValidator {
  constructor({ maxRecordBytes = 3 * 1024 * 1024 } = {}) { this.maxRecordBytes = maxRecordBytes; }

  static isModuleName(name) { return MODULE_NAME.test(String(name || '')); }

  /** Returns the record id as text, or throws ChangeRejected('invalid'). */
  validate(change) {
    if (!change || typeof change !== 'object') throw new ChangeRejected('bad change', 'invalid');
    if (!ChangeValidator.isModuleName(change.module)) throw new ChangeRejected('bad module name', 'invalid');
    const id = String(change.id == null ? '' : change.id);
    if (!id || id.length > 100) throw new ChangeRejected('bad record id', 'invalid');
    if (change.data === null || typeof change.data !== 'object') throw new ChangeRejected('record data must be an object', 'invalid');
    if (Buffer.byteLength(JSON.stringify(change.data)) > this.maxRecordBytes) throw new ChangeRejected('record too large', 'invalid');
    return id;
  }
}

module.exports = { ChangeValidator };
