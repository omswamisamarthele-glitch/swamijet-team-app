#!/bin/bash
# Pull the latest code and restart. Usage, as root: bash deploy/update.sh
set -euo pipefail
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$APP_DIR"
git pull --ff-only
(cd server && npm ci --omit=dev --no-audit --no-fund)
systemctl restart swamijet
sleep 2
curl -fsS http://127.0.0.1:8080/api/health && echo " updated"
