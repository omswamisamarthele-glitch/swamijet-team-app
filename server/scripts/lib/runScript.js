'use strict';
const { Config } = require('../../src/config/Config');
const { Database } = require('../../src/db/Database');

/** Thrown by a script for wrong arguments: prints the message and exits with code 2. */
class UsageError extends Error {}

/**
 * Runs a CLI script against a fully wired App: main(app, args). Prints plain-language errors,
 * always closes the database, and sets the exit code.
 */
async function runScript(main) {
  const { App } = require('../../src/App');
  const config = Config.fromEnv();
  let app = null;
  try {
    app = new App(config);
    await main(app, process.argv.slice(2));
  } catch (e) {
    if (e instanceof UsageError) { console.error(e.message); process.exitCode = 2; }
    else { console.error(Database.explainError(e, config.databaseUrl)); process.exitCode = 1; }
  } finally {
    if (app) await app.database.close().catch(() => {});
  }
}

module.exports = { runScript, UsageError };
