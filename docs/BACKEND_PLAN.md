# SwamiJet Backend Hardening Plan

Source of truth for the backend work. Living doc (shareable, with status tracker):
https://claude.ai/code/artifact/662e93c1-9b16-4bb9-b798-afb0f97a4588
Audit date: 2026-10-12. Work branch: `claude/eloquent-feynman-8y7xsy`.

## Current state (at audit)
- Released 5.9.40 (`version.json`, `sw.js`); `index.html:9891` APP_VERSION and `manifest.json` start_url still 5.9.36.
- Frontend: one ~1 MB `index.html`, plain JS (ES5-ish), no build, PWA (`sw.js`: network-first HTML/version.json, cache-first rest).
- Backend: Supabase project `cvcrffxonrmtyaklhgbl`, table `app_data` (key = module, value = JSON array blob). Anon key bundled in HTML.
- Also: Cloudinary unsigned preset `swamijet_unsigned` (cloud `dqiqlzont`), legacy Google Apps Script `SHEET_API_URL` (still called), WhatsApp/Maps links. Hosting: Cloudflare Pages.
- Local store: localStorage keys `sj3_<module>`; `DB.get/DB.set/DB.getRaw`. Modules = `CLOUD_KEYS` (index.html ~1609); object-valued keys = `OBJ_KEYS` (officeGps, paymentSettings).
- Roles: Owner/Director/Admin => isAdmin(); Accountant => isAcc(); everyone else staff.
- 23 pages (`#p-<name>`), navigated with `goPage(name)`. Offline smoke test: no JS errors.
- Sandbox network blocks supabase.co / jsdelivr / script.google.com (live DB not yet inspected).

## Audit findings
| # | Sev | Finding | Where |
|---|---|---|---|
| 1 | Critical | `admin`/`admin123` logs in as Admin even when no admin user exists (verified) | `doLoginLocal` ~10380 |
| 2 | Critical | RLS lets anon read+write all `app_data`; key is public | `supabase_setup.sql` |
| 3 | Critical | Passwords in synced `team` blob (plain or unsalted SHA-256); stored hash accepted as password | `passwordOk` ~10355 |
| 4 | Critical | Whole-blob read-merge-write per module: concurrent saves lose edits; tombstones dropped in newer mergeArr | `sbPushBulk`, `mergeArr` ~10230 |
| 5 | Critical | LWW and check-in times use device clock (`_up`) | DB.set wrapper ~1789, check-in |
| 6 | High | IDs = `Date.now()+rand(9999)`; plain `Date.now()` x6; default admin id 1 -> collisions | `uid()` |
| 7 | High | 4 stacked sync layers redefine cloudPull/cloudSend/DB.set/doLogin (~119 redefinitions) | throughout |
| 8 | High | Full pull every 30 s + on visibility change; localStorage ~5 MB cap | ~1845 |
| 9 | High | No backups/history; activity log is client-editable | backend |
| 10 | High | base64 > 2 KB blanked before push; failed Cloudinary upload => photo only on one phone | `cleanRecord` |
| 11 | Med | Version badge shows 5.9.36 | index.html:9891, manifest.json |
| 12 | Med | supabase-js `@2` unpinned; Google Sheets still called | index.html:432, 1577 |
| 13 | Med | Normalized tables in setup SQL unused | `supabase_setup.sql` |

## Principles
1. Protect data before changing anything (every write recoverable).
2. Server is authoritative for time, identity, permissions.
3. Replace one module at a time, each behind an on/off switch.
4. Every phase: measurable done test + tested rollback.

## Target architecture
Phone (screens unchanged -> IndexedDB local DB -> outbox queue with op IDs) <-> one sync engine (single-row upserts with row version, delta pull by server updated_at, realtime) <-> Supabase (Auth + profiles/roles in JWT; per-module tables with RLS; RPCs for check-in/approvals/salary lock/stock; private Storage; history + audit triggers; PITR + nightly off-site backup).

## Phases
- **Phase 0 - Protect data (1-2 d) [code done, migration awaiting owner]:** backup app_data; history trigger on app_data; wipe-guard trigger (reject >20% shrink / empty team); remove admin backdoor + hash-as-password; fix version mismatch; pin supabase-js; drop Google Sheets calls. Done: wiped module restorable, backdoor test fails. Rollback: drop triggers.
- **Phase 1 - Foundations (~3 d):** Supabase CLI migrations in repo; staging Supabase + Cloudflare preview; GitHub Actions (lint, Playwright E2E: per-role login, all pages, offline->online, two-device conflict; pgTAP RLS tests); client error log; min-client-version gate.
- **Phase 2 - Auth + RLS (~1 wk):** Supabase Auth with username->internal email; `profiles` roles in JWT; admin user mgmt via Edge Function; role x module x action RLS matrix with tests; anon gets nothing; offline token refresh; one-time temp passwords, passwords removed from blobs.
- **Phase 3 - Data model + server rules (1-2 wk):** table per module, UUID ids (+legacy_id), created_by/updated_by/server updated_at/version/deleted; RPCs: check-in (server time, geofence, selfie, one open per day), approvals (final), salary lock, stock >= 0; numeric money; Asia/Kolkata business day; audit triggers; idempotent migration script + reconciliation report (counts/totals per member-month). Done: zero diffs on staging copy.
- **Phase 4 - Sync engine (1-2 wk):** IndexedDB; outbox with idempotent op IDs; optimistic concurrency (row version) + conflict UI; per-entity conflict policy; delta pull + realtime (5-min fallback). Per-module flag rollout: notices/SOPs -> tasks/jobcards -> stock -> attendance -> payments/advances/salary; dual-write + nightly diff. Done: 7 days zero diff per module. Rollback: flag off.
- **Phase 5 - Media (3-4 d):** private buckets + signed URLs (or signed Cloudinary); upload queue, "photo pending" state; backfill embedded base64; resize + retention (DPDP Act).
- **Phase 6 - Ops (2-3 d):** Supabase Pro (PITR, no pause); nightly encrypted pg_dump via Actions + monthly restore drill; daily invariant checks + alerts; uptime; admin sync-status screen; runbooks; staged rollout staging -> admin -> all.
- **Phase 7 - Code cleanup:** split index.html into modules with Vite; retire legacy sync layers per module.

## Open decisions (owner)
- [ ] Network allowlist (supabase.co, jsdelivr, api.supabase.com) + Supabase access token + service-role key as env secrets
- [ ] Supabase Pro (~$25/mo)
- [ ] Staging project
- [ ] Media: Supabase Storage (recommended) vs Cloudinary
- [ ] Review role x module permission matrix
- [ ] Weekend for password cutover

## Progress log
| Date | Phase | Change |
|---|---|---|
| 2026-10-12 | 0 | v5.9.41: removed all 4 admin/admin123 login paths (2 also reset the admin password); stored hash no longer accepted; default admin only when cloud confirms empty team (`window.__sjCloudTeamEmpty`); versions aligned; supabase-js pinned 2.49.4; Google Sheets retired. Tests: `tests/phase0.test.cjs` (9 pass; 6 fail on 5.9.40) |
| 2026-10-12 | 0 | Migration `supabase/migrations/20261012000000_phase0_protect_data.sql` (schema `ops`: backup, history, wipe guard, restore, password reset, prune) tested on local PG16 via `supabase/tests/phase0_guard_test.sql`. **Not yet applied to production** (sandbox cannot reach Supabase); owner runs it per `docs/RUNBOOK.md` |
| 2026-10-12 | 0 | Remaining for Phase 0 done: owner applies migration; confirm no live account uses admin/admin123; deploy 5.9.41 |
