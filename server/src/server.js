'use strict';
// Entry point: `npm start` / systemd run this file. All wiring lives in App.
const { Config } = require('./config/Config');
const { Database } = require('./db/Database');
const { App } = require('./App');

async function main() {
  const config = Config.fromEnv();
  const app = new App(config);
  try {
    await app.start();
  } catch (e) {
    if (e.code === 'EADDRINUSE') console.error(`Port ${config.port} is already in use. Set another PORT in server/.env.`);
    else console.error('Could not start: ' + Database.explainError(e, config.databaseUrl));
    process.exit(1);
  }
  const stop = () => app.stop().then(() => process.exit(0));
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

if (require.main === module) main();

module.exports = { main };
