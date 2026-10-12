# Tests

Both suites need PostgreSQL and a database whose name ends in `_test` (it is wiped).

## Server API tests
```bash
cd server && npm install
TEST_DATABASE_URL=postgres://postgres@127.0.0.1:5432/swamijet_srv_test npm test
```

## End-to-end (server + database + the app in headless Chromium, several "phones")
```bash
npm i -g playwright && npx playwright install chromium   # or reuse an existing install via NODE_PATH
TEST_DATABASE_URL=postgres://postgres@127.0.0.1:5432/swamijet_e2e_test node tests/app.e2e.test.cjs
```
In the Claude cloud sandbox: local PostgreSQL 16 is at `/usr/lib/postgresql/16/bin`; run Playwright with
`NODE_PATH=/opt/node-tools/node_modules PW_CHROMIUM=/opt/pw-browsers/chromium-1194/chrome-linux/chrome`.
Cloud hosts (old Supabase, CDN, Sheets, Cloudinary) are blocked inside the tests.
