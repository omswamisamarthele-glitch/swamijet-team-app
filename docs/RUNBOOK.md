# SwamiJet Runbook

All commands run on the VPS in the `swamijet-team-app` folder.
`app` = `docker compose exec app node server/scripts/<script>`; `sql` = `docker compose exec db psql -U swamijet -d swamijet`.

## Health and logs
```bash
docker compose ps
curl https://YOUR-DOMAIN/api/health
docker compose logs --tail 100 app
```

## Logins
| Task | Command |
|---|---|
| Reset a password (also signs them out everywhere) | `docker compose exec app node server/scripts/reset-password.js ravi NewPass123` |
| Create an extra admin login (recovery) | `docker compose exec app node server/scripts/create-admin.js boss 'LongPassword#1'` |
| List logins | `docker compose exec db psql -U swamijet -d swamijet -c "select username, role, active from users order by username"` |
| Sign everyone out | `docker compose exec db psql -U swamijet -d swamijet -c "delete from sessions"` |

Day to day, admins manage members in the app (Team page): adding a member creates their login, changing a
password changes it on the server, and deactivating or deleting a member signs them out immediately.

## Refused or blocked changes
The server refuses: edits based on an older copy (the newer server copy is kept and sent back to the phone),
staff editing other members or salary data, and deleting more than 20% of a module's records in one go.
```bash
docker compose exec db psql -U swamijet -d swamijet -c "select at, kind, module, record_id, detail from sync_events order by at desc limit 30"
```

## Undo a change to one record
Every overwritten version is kept in `records_history`.
```bash
docker compose exec app node server/scripts/restore-record.js attendance 1712345678901          # list versions
docker compose exec app node server/scripts/restore-record.js attendance 1712345678901 2026-10-12T09:00:00Z
```
Phones pick up the restored version on their next sync.

## Restore the whole database from a backup
```bash
ls backups/                                   # pick a file
docker compose stop app
docker compose exec db psql -U swamijet -d postgres -c "drop database swamijet" -c "create database swamijet owner swamijet"
gunzip -c backups/swamijet-YYYYMMDD-HHMMSS.sql.gz | docker compose exec -T db psql -U swamijet -d swamijet
docker compose start app
```
Monthly restore test (does not touch live data):
```bash
docker compose exec db psql -U swamijet -d postgres -c "create database restore_check"
gunzip -c backups/$(ls backups | tail -1) | docker compose exec -T db psql -q -U swamijet -d restore_check
docker compose exec db psql -U swamijet -d restore_check -c "select module, count(*) from records group by 1 order by 1"
docker compose exec db psql -U swamijet -d postgres -c "drop database restore_check"
```

## Housekeeping
History and old events are kept 180 days. Run monthly (or add to cron):
`docker compose exec app node server/scripts/prune-history.js`
