# Tests

## Browser tests (`phase0.test.cjs`)
All cloud hosts are blocked inside the test, so it never touches production data.
```bash
npm i -D playwright      # or point NODE_PATH at an existing install
npx playwright install chromium
node tests/phase0.test.cjs
```
In the Claude cloud sandbox:
`NODE_PATH=/opt/node-tools/node_modules PW_CHROMIUM=/opt/pw-browsers/chromium-1194/chrome-linux/chrome node tests/phase0.test.cjs`

## Database tests (`../supabase/tests/phase0_guard_test.sql`)
Run only against a scratch Postgres database named `swamijet_test` (the script refuses any other name):
```bash
createdb swamijet_test
psql -d swamijet_test -c "create role anon nologin; create role authenticated nologin; create schema extensions;"
psql -d swamijet_test -f supabase_setup.sql
psql -d swamijet_test -c "grant usage on schema public to anon; grant select, insert, update on public.app_data to anon;"
psql -d swamijet_test -f supabase/migrations/20261012000000_phase0_protect_data.sql
psql -d swamijet_test -f supabase/tests/phase0_guard_test.sql   # prints ALL PASSED
```
