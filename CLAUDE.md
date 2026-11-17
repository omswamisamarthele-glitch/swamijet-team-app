# SwamiJet Team App

PWA (`index.html`, ~1 MB plain JS) for Om Swami Samarth Electrical & CCTV House: attendance, tasks, job cards,
payroll, stock, payments. Backend: own server in `server/` (Node.js + PostgreSQL). **No Docker** (owner's choice):
local = `npm run setup` / `npm start`; VPS = `deploy/install-ubuntu.sh` (Ubuntu packages, systemd, Caddy, cron backup).
**Supabase is no longer used** (removed in 5.9.42).

## Active work
**Read `docs/BACKEND_PLAN.md` first** for any backend, sync, auth or data change: architecture, how sync works,
findings status, next phases, open decisions. Shared doc: https://claude.ai/code/artifact/662e93c1-9b16-4bb9-b798-afb0f97a4588
- Branch `claude/eloquent-feynman-8y7xsy`. After each step update the Progress log in `docs/BACKEND_PLAN.md`.
- Deploy guide `docs/DEPLOY.md`; operations `docs/RUNBOOK.md`; owner's local test guide `docs/LOCAL_TESTING.md`.

## Code map
**Architecture and OOP rules: `docs/ARCHITECTURE.md` (follow it for all new code).**
- `index.html`: the app. Many functions are redefined by later patch blocks; the LAST definition wins. Grep all
  definitions before editing one. The `<script id="sjServerSync">` block at the end (classes: SwamiJetClient,
  LocalStore, ApiClient, SyncSnapshot, SyncEngine, SessionManager, StatusView, LegacyBridge) owns login and sync
  and overrides cloudPull/cloudSend/cloudFlush/cloudQueuePush/doLogin/doLogout. `window.DB` exists only after startApp().
  No `static x =` fields or `#private` members in that layer (older iPhone Safari).
- Local data: localStorage `sj3_<module>` (modules = `window.CLOUD_KEYS`), sync state `sj_meta_<module>`,
  `sj_sync_since`, `sj_token`, `sj_user`.
- Server `server/src`: `App.js` wires everything (constructor injection); `http/` (HttpServer, Router, controllers),
  `auth/`, `sync/`, `history/`, `import/` (services and rules), `repositories/` (all SQL), `db/` (Database, Migrator),
  `domain/` (errors, Roles, RecordFields), `config/Config.js`. Entry `src/server.js`. CLI scripts use `scripts/lib/runScript.js`.
  Migrations `server/db/migrations/*.sql` (applied on start).

## Conventions
- Version bump in all of: `version.json`, `sw.js` (APP_VERSION + CACHE), `index.html` (badge, APP_VERSION ~9891,
  4x FIX_VERSION), `manifest.json` start_url. The e2e test checks the badge.
- Never clear localStorage business data in update code.
- New DB changes = a new numbered migration file; never edit an applied one.

## Testing (see `tests/README.md`)
- Local PostgreSQL 16: start with
  `su postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D /var/tmp/sjpg/data -o '-p 55432 -k /var/tmp/sjpg -h 127.0.0.1' -l /var/tmp/sjpg/log start"`
  (initdb into /var/tmp/sjpg/data first if missing). Test DB names must end in `_test`.
- Server (unit + API): `cd server && npm ci && TEST_DATABASE_URL=postgres://postgres@127.0.0.1:55432/swamijet_srv_test npm test`
- E2E: `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:55432/swamijet_e2e_test NODE_PATH=/opt/node-tools/node_modules PW_CHROMIUM=$(ls -d /opt/pw-browsers/chromium-*/chrome-linux*/chrome | tail -1) node tests/app.e2e.test.cjs`
- Server must keep working on Node 18 (Ubuntu 24.04's nodejs package). Do not add Docker files back.
