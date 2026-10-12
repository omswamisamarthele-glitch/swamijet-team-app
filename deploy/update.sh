#!/bin/bash
# Pull the latest code and restart. Usage, as root: bash deploy/update.sh
set -euo pipefail
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$APP_DIR"
git pull --ff-only
(cd server && npm ci --omit=dev --no-audit --no-fund)
systemctl restart swamijet
for i in $(seq 1 30); do curl -fsS http://127.0.0.1:8080/api/health >/dev/null 2>&1 && break; sleep 1; done
curl -fsS http://127.0.0.1:8080/api/health || { echo; echo "Service did not start: journalctl -u swamijet -n 50"; exit 1; }
echo " updated"
