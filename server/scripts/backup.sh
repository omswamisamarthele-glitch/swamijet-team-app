#!/bin/sh
# Database backup with retention. Uses DATABASE_URL, or reads it from server/.env.
# BACKUP_DIR (default: <repo>/backups), BACKUP_KEEP_DAYS (default 14).
set -eu
here="$(cd "$(dirname "$0")" && pwd)"
if [ -z "${DATABASE_URL:-}" ] && [ -f "$here/../.env" ]; then
  DATABASE_URL="$(sed -n 's/^DATABASE_URL=//p' "$here/../.env" | tail -1)"
fi
: "${DATABASE_URL:?DATABASE_URL not set and not found in server/.env}"
dir="${BACKUP_DIR:-$here/../../backups}"; keep="${BACKUP_KEEP_DAYS:-14}"
mkdir -p "$dir"
f="$dir/swamijet-$(date -u +%Y%m%d-%H%M%S).sql.gz"
pg_dump --no-owner --no-privileges "$DATABASE_URL" | gzip -9 > "$f.tmp" && mv "$f.tmp" "$f"
find "$dir" -name 'swamijet-*.sql.gz' -mtime +"$keep" -delete
echo "backup written: $f ($(du -h "$f" | cut -f1))"
