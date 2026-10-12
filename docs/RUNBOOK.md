# SwamiJet Runbook (VPS)

Run as root. Scripts run as the service user from the server folder:
`cd /opt/swamijet/server` then `sudo -u swamijet node scripts/<script>.js ...`.
Database shell: `sudo -u postgres psql swamijet`.

## Health and logs
```bash
systemctl status swamijet            # service state
journalctl -u swamijet -n 100        # server log
curl -s http://127.0.0.1:8080/api/health
systemctl restart swamijet
```

## Logins
| Task | Command (in /opt/swamijet/server) |
|---|---|
| Reset a password (also signs them out everywhere) | `sudo -u swamijet node scripts/reset-password.js ravi NewPass123` |
| Create an extra admin login (recovery) | `sudo -u swamijet node scripts/create-admin.js boss 'LongPassword#1'` |
| List logins | `sudo -u postgres psql swamijet -c "select username, role, active from users order by username"` |
| Sign everyone out | `sudo -u postgres psql swamijet -c "delete from sessions"` |

Day to day, admins manage members in the app (Team page): adding a member creates their login, changing a
password changes it on the server, deactivating or deleting a member signs them out.

## Refused or blocked changes
The server refuses edits based on an older copy (the newer server copy is kept and sent back), staff editing
other members or salary data, and deleting more than 20% of a module's records in one go.
```bash
sudo -u postgres psql swamijet -c "select at, kind, module, record_id, detail from sync_events order by at desc limit 30"
```

## Undo a change to one record
Every overwritten version is kept in `records_history`.
```bash
sudo -u swamijet node scripts/restore-record.js attendance 1712345678901                      # list versions
sudo -u swamijet node scripts/restore-record.js attendance 1712345678901 2026-10-12T09:00:00Z  # restore
```

## Backups
```bash
ls -lh /var/backups/swamijet/                                   # nightly files
sudo -u swamijet env BACKUP_DIR=/var/backups/swamijet sh scripts/backup.sh   # take one now
```
Restore the whole database:
```bash
systemctl stop swamijet
sudo -u postgres psql -c "drop database swamijet" -c "create database swamijet owner swamijet"
# restore as the app's own database user, so it owns the tables again
gunzip -c /var/backups/swamijet/swamijet-YYYYMMDD-HHMMSS.sql.gz | sudo -u swamijet psql -q "$(sed -n 's/^DATABASE_URL=//p' /opt/swamijet/server/.env)"
systemctl start swamijet
```
Monthly restore test (does not touch live data):
```bash
sudo -u postgres createdb restore_check
gunzip -c "$(ls -t /var/backups/swamijet/*.sql.gz | head -1)" | sudo -u postgres psql -q restore_check
sudo -u postgres psql restore_check -c "select module, count(*) from records group by 1 order by 1"
sudo -u postgres dropdb restore_check
```

## Housekeeping
History and old events are kept 180 days. Monthly: `sudo -u swamijet node scripts/prune-history.js`.
