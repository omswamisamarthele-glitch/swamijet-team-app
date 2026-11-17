'use strict';
// Applies pending database migrations. Usage: npm run migrate
const { runScript } = require('./lib/runScript');

runScript(async app => {
  const applied = await app.migrator.run();
  console.log(applied.length ? `applied: ${applied.join(', ')}` : 'database is up to date');
});
