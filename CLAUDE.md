# SwamiJet Team App

Single-file PWA (`index.html`, ~1 MB plain JS) for Om Swami Samarth Electrical & CCTV House: attendance, tasks, job cards, payroll, stock, payments. Backend: Supabase `app_data` JSON blobs. Hosted on Cloudflare Pages.

## Active work: backend hardening
**Read `docs/BACKEND_PLAN.md` before any backend, sync, auth or data change.** It holds the audit findings, the 8-phase plan (0-7), done tests, rollbacks and open decisions. Shared doc: https://claude.ai/code/artifact/662e93c1-9b16-4bb9-b798-afb0f97a4588
- Work on branch `claude/eloquent-feynman-8y7xsy`.
- After finishing any step, update the Progress log and decision checkboxes in `docs/BACKEND_PLAN.md`.
- Phases go in order; Phase 0 (protect data) comes before any schema or sync change.

## Conventions
- Bump version in all of: `version.json`, `sw.js` (APP_VERSION + CACHE), `index.html` (badge + update-script APP_VERSION ~9891), `manifest.json` start_url.
- Many functions are redefined by later patch blocks; the LAST definition wins. Grep all definitions before editing one.
- Never clear localStorage/IndexedDB in update code; business data lives there.

## Testing
Serve with `python3 -m http.server 8765` and drive with Playwright (`/opt/node-tools/node_modules/playwright`, Chromium at `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`): load, log in, `goPage()` each of the 23 `.page` ids, collect page errors.
