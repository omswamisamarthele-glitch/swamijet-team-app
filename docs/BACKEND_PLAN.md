# SwamiJet Backend Plan

Source of truth for backend work. Shared doc (overview + status tracker):
https://claude.ai/code/artifact/662e93c1-9b16-4bb9-b798-afb0f97a4588
Work branch: `claude/eloquent-feynman-8y7xsy`.

## Decision (2026-10-12)
Supabase is dropped. The owner chose **own server on a VPS with PostgreSQL**. Built in v5.9.42:
- `server/` Node.js 22 + `pg` (only dependency), plain `node:http`. Serves the app and `/api/*`.
- PostgreSQL 16: `records` (one row per app record, server version + change `seq`), `records_history`
  (trigger keeps every overwritten version), `users`, `sessions`, `sync_events`, `schema_migrations`.
- Deploy (no Docker, owner's choice): `deploy/install-ubuntu.sh` = Ubuntu packages (nodejs, postgresql, caddy), systemd
  service on 127.0.0.1:8080, Caddy HTTPS, cron `pg_dump` backup. Guide: `docs/DEPLOY.md`. Local: `npm run setup` / `npm start`.
- Ops: `docs/RUNBOOK.md`. Import from Supabase: `server/scripts/import-app-data.js` (file or live Supabase URL).

## How it works now
- **Login** on the server (`POST /api/auth/login`), scrypt hashes, 30-day bearer sessions (sha256 stored), 10 fails/15 min limit.
  Legacy app SHA-256 and plain-text passwords from the team list are accepted once and upgraded to scrypt.
  Team records drive logins: username/password/role/active in a `team` record update `users`; passwords are stripped
  from records and never sent to phones. Deactivating/deleting a member deletes their sessions.
- **Sync** (`GET/POST /api/sync`), app layer `<script id="sjServerSync">` at the end of `index.html` (overrides older layers):
  phones keep data in localStorage `sj3_<module>` as before; `sj_meta_<module>` = {id: [serverVersion, hash]};
  `sj_sync_since` = last change seq. Cycle = push changed/removed records (with baseVersion), then pull `seq > since`.
  Server rule: stale base is applied only if its `_up` is newer than the server copy, else rejected and the server copy
  returned. Identical copies are no-ops (first sync of every phone re-sends everything).
  Object modules (officeGps, paymentSettings) sync as record id `_`. Trimmed modules (activityLog, notifications,
  scoreCache) never delete on the server when trimmed locally.
- **Permissions (basic)**: admin roles (Owner/Director/Admin/superadmin) everything; Accountant also salary/payment
  settings modules; staff may edit only their own team record (role/active/pay fields protected) and not
  `salaryPayments, salaryLocks, salaryOverrides, salHist, paymentSettings, userPermissions, officeGps`.
  **Reads are not filtered yet**: every logged-in user receives all records (same as before).
- **Wipe guard**: one request may not delete >20% of a module's live records (min 10) unless an admin confirms.
- Service worker never caches `/api/` or cross-origin requests.

## Audit findings status
| # | Finding | Status |
|---|---|---|
| 1 | admin/admin123 backdoor (4 code paths) | Fixed 5.9.41; login now server-only |
| 2 | Public read/write database | Fixed by own server: every API call needs a session |
| 3 | Passwords in synced data; hash accepted as password | Fixed: scrypt on server, stripped from records |
| 4 | Whole-blob overwrites lose edits | Fixed: per-record sync with versions |
| 5 | Device clock decides | Partly: server versions decide ordering; `_up` only breaks stale-copy ties. Check-in time still from phone (Phase 3) |
| 6 | ID collisions (`Date.now()+rand`) | Open (Phase 3) |
| 7 | Stacked sync layers | Neutralised (sjServerSync overrides); dead code removal in Phase 7 |
| 8 | Full download every 30 s | Fixed: incremental pull by `seq`. 5 MB localStorage cap still open (Phase 4) |
| 9 | No backups/history | Fixed: nightly pg_dump + per-record history. Off-site copy still manual |
| 10 | Photos blanked before upload | Fixed: records up to 3 MB stored as-is. Cloudinary still used for uploads (Phase 5) |
| 11–13 | Version drift, unpinned CDN, unused tables | Fixed (Supabase SDK removed) |

## Next phases
- **Go-live (owner + Claude):** VPS + domain; `docker compose up`; import from Supabase; check data; switch staff;
  delete Supabase project (its key is in git history).
- **Phase 1 Foundations:** GitHub Actions running `server` tests + `tests/app.e2e.test.cjs`; staging compose project;
  client error reporting endpoint; uptime monitor; automated off-site backups.
- **Phase 2 Permissions:** role × module × action matrix reviewed by owner; server-side read filtering
  (staff see only their own salary/advances/attendance history as agreed).
- **Phase 3 Server rules:** check-in/out endpoint with server time, office geofence, selfie required, one open
  check-in per day; approvals final; salary lock enforced; stock never negative; collision-free ids for new records.
- **Phase 4 Sync:** server-sent events for instant updates; IndexedDB instead of localStorage; conflict screen.
- **Phase 5 Media:** photos/files stored by the server (disk or S3-compatible) with signed links; retire Cloudinary
  unsigned preset; retention schedule (DPDP Act).
- **Phase 7 Cleanup:** delete old Supabase/Sheets layers from `index.html`; split into modules (Vite).

## Open decisions (owner)
- [ ] VPS provider + domain name
- [ ] Phase 2 permission matrix (Claude drafts from the code)
- [ ] Media storage: VPS disk vs S3-compatible bucket
- [ ] Login by username (current) or mobile number

## Progress log
| Date | Change |
|---|---|
| 2026-10-12 | Audit + plan written |
| 2026-10-12 | v5.9.41 Phase 0: removed 4 admin/admin123 paths, hash-as-password, versions aligned, Sheets retired |
| 2026-10-12 | Owner chose own VPS + PostgreSQL. v5.9.42: `server/`, sjServerSync layer, Docker deploy, import script; Supabase SDK, keys and Phase 0 Supabase SQL removed. Tests: server 13/13, e2e 12/12 (two-phone sync, conflicts, permissions, import, session), full compose stack + backup + restore checked locally. **Not deployed yet.** |
| 2026-10-12 | Local testing kit: `docker-compose.local.yml` (http://localhost:8080), `server/.env` support, `server/scripts/seed-demo.js`, guide `docs/LOCAL_TESTING.md`. Both routes (Docker / plain Node) verified; browser walkthrough OK. Note: calling `goPage()` directly leaves pages with inline display:none; real nav buttons work. E2E 'all pages' check only checks the `.on` class. |
| 2026-10-12 | Docker removed (owner: keep it simple). `npm run setup` creates .env + database; VPS via `deploy/install-ubuntu.sh`. Fresh-PC test (password-protected PostgreSQL, code from GitHub ZIP, guide followed literally) found and fixed 2 bugs: (1) edits were not uploaded automatically and other phones only updated on reload, because older code calls private copies of cloudQueuePush; fix = sjServerSync watches localStorage writes + 20 s sync timer (edit now reaches another phone in ~2-12 s); (2) a record the server refused for permissions stayed on the phone; now removed (server returns `code`). E2E now 13 checks incl. automatic sync with no manual calls and real menu navigation. |
| 2026-10-12 | v5.9.44: status shows "Offline - Pending Sync" (not "Sync Failed") when the server cannot be reached. Fresh-PC run from the GitHub ZIP passed the whole LOCAL_TESTING checklist (wrong password/admin123 refused, 4 role logins, two-window auto sync ~2 s, staff edits refused + reverted, member added via real Team form logs in elsewhere, deleted member logged out by itself, offline edit synced 7 s after server restart, reload keeps login, no JS errors; clear messages for port in use / PostgreSQL down). VPS: `install-ubuntu.sh` run in a clean Ubuntu 24.04 container (Ubuntu's Node 18.19 / PostgreSQL 16 / Caddy 2.6; systemd emulated); fixes: real PostgreSQL port detected, start-up health check waits and fails loudly. |
| 2026-10-13 | Owner: "localhost doesn't open again". Reproduced: after the server window is closed the browser shows ERR_CONNECTION_REFUSED; after `npm start` the app opens, still logged in and synced (tested with a persistent browser profile). Added `start-windows.bat` (double-click: setup check, start server, open browser; not runnable in the sandbox, written with basic cmd commands) + `.gitattributes` (CRLF for .bat). Service worker registers only on https, so localhost has no offline shell; the VPS (https) does. |
| 2026-10-13 | Owner got `Missing script: "start"` locally. Reproduced: running npm in the outer folder of a Windows double-extracted ZIP picks up some other package.json higher up (the `main` ZIP has no package.json at all). Guide now says which ZIP and which folder; `npm start` before setup now says "run npm run setup" instead of a "Cannot find module 'pg'" stack trace. Not done (owner did not ask): any cloud host; owner said not to pick hosting on my own. |
