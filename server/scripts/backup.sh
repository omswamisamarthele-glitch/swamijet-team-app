#!/bin/sh
# Nightly database backup with retention. Needs pg_dump and DATABASE_URL.
# BACKUP_DIR (default /backups), BACKUP_KEEP_DAYS (default 14).
set -eu
dir="${BACKUP_DIR:-/backups}"; keep="${BACKUP_KEEP_DAYS:-14}"
mkdir -p "$dir"
f="$dir/swamijet-$(date -u +%Y%m%d-%H%M%S).sql.gz"
pg_dump --no-owner --no-privileges "$DATABASE_URL" | gzip -9 > "$f.tmp" && mv "$f.tmp" "$f"
find "$dir" -name 'swamijet-*.sql.gz' -mtime +"$keep" -delete
echo "backup written: $f ($(du -h "$f" | cut -f1))"
