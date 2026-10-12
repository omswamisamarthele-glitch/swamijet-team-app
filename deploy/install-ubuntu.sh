#!/bin/bash
# Installs SwamiJet on a fresh Ubuntu 24.04 VPS using only Ubuntu packages (no Docker).
# Usage, as root, from the cloned repository (e.g. /opt/swamijet):
#   bash deploy/install-ubuntu.sh team.example.com
# Safe to run again: keeps an existing server/.env and database.
set -euo pipefail
DOMAIN="${1:?usage: bash deploy/install-ubuntu.sh <your-domain>}"
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BACKUP_DIR=/var/backups/swamijet
[ "$(id -u)" = 0 ] || { echo "run as root (sudo)"; exit 1; }

echo "== packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q nodejs npm postgresql caddy openssl curl
node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 18 ? 0 : 1)' || { echo "Node.js 18+ required"; exit 1; }
systemctl enable --now postgresql

echo "== service user and folders"
id swamijet >/dev/null 2>&1 || useradd --system --home-dir "$APP_DIR" --shell /usr/sbin/nologin swamijet
install -d -o swamijet -g swamijet -m 700 "$BACKUP_DIR"
touch /var/log/swamijet-backup.log && chown swamijet /var/log/swamijet-backup.log

echo "== database"
ENV_FILE="$APP_DIR/server/.env"
if [ ! -f "$ENV_FILE" ]; then
  PW="$(openssl rand -hex 24)"
  sudo -u postgres psql -qtc "select 1 from pg_roles where rolname='swamijet'" | grep -q 1 \
    && sudo -u postgres psql -qc "alter role swamijet password '$PW'" \
    || sudo -u postgres psql -qc "create role swamijet login password '$PW'"
  cat > "$ENV_FILE" <<ENV
DATABASE_URL=postgres://swamijet:$PW@127.0.0.1:5432/swamijet
PORT=8080
HOST=127.0.0.1
TRUST_PROXY=1
ENV
fi
chown swamijet "$ENV_FILE" && chmod 600 "$ENV_FILE"
sudo -u postgres psql -qtc "select 1 from pg_database where datname='swamijet'" | grep -q 1 \
  || sudo -u postgres createdb -O swamijet swamijet

echo "== app"
(cd "$APP_DIR/server" && npm ci --omit=dev --no-audit --no-fund)
(cd "$APP_DIR/server" && sudo -u swamijet node scripts/setup.js)

echo "== service"
sed "s#__APP_DIR__#$APP_DIR#" "$APP_DIR/deploy/swamijet.service" > /etc/systemd/system/swamijet.service
systemctl daemon-reload
systemctl enable swamijet
systemctl restart swamijet

echo "== https (caddy)"
sed "s#{\$DOMAIN}#$DOMAIN#" "$APP_DIR/deploy/Caddyfile" > /etc/caddy/Caddyfile
systemctl enable caddy
systemctl restart caddy

echo "== nightly backup (02:30)"
echo "30 2 * * * swamijet BACKUP_DIR=$BACKUP_DIR sh $APP_DIR/server/scripts/backup.sh >> /var/log/swamijet-backup.log 2>&1" > /etc/cron.d/swamijet-backup

echo "== firewall"
if command -v ufw >/dev/null; then ufw allow OpenSSH >/dev/null; ufw allow 80 >/dev/null; ufw allow 443 >/dev/null; ufw --force enable >/dev/null; fi

sleep 2
curl -fsS http://127.0.0.1:8080/api/health && echo
echo "Done. Open https://$DOMAIN"
echo "Create the first admin:  cd $APP_DIR/server && sudo -u swamijet node scripts/create-admin.js <username> '<password>'"
echo "Or import from Supabase: see docs/DEPLOY.md"
