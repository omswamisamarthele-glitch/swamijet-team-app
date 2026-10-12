# Deploying SwamiJet on a VPS

One small Linux server runs everything: PostgreSQL, the SwamiJet server (which also serves the app),
Caddy for HTTPS, and a nightly backup. About $5/month; 1 vCPU and 1–2 GB RAM is enough.

## 1. Prepare the server (once)
1. Create an Ubuntu 24.04 VPS. Point a domain at it (DNS A record), e.g. `team.yourshop.in` → VPS IP.
   HTTPS is required: phones only allow camera, GPS and install-to-home-screen on HTTPS.
2. Log in over SSH and run:
   ```bash
   curl -fsSL https://get.docker.com | sh
   ufw allow 22 && ufw allow 80 && ufw allow 443 && ufw --force enable
   git clone https://github.com/omswamisamarthele-glitch/swamijet-team-app.git
   cd swamijet-team-app
   cp .env.example .env
   nano .env        # set DOMAIN and POSTGRES_PASSWORD (openssl rand -base64 32)
   docker compose up -d --build
   docker compose ps                     # all four services "Up"; app "healthy" after ~30 s
   curl https://YOUR-DOMAIN/api/health   # {"ok":true,...}
   ```

## 2. Move the data from Supabase (once)
The import reads the old `app_data` table directly. The anon key is in Supabase Dashboard > Project Settings > API.
```bash
docker compose exec -e SUPABASE_ANON_KEY='eyJ...' app \
  node server/scripts/import-app-data.js https://cvcrffxonrmtyaklhgbl.supabase.co
```
It prints how many records were imported and the logins it created from the team list. Everyone keeps
their current username and password. A login shown as `NO PASSWORD` needs one:
`docker compose exec app node server/scripts/reset-password.js <username> <new password>`.
Running the import again is safe: a record is only replaced by a copy with a newer `_up`.

The import keeps a raw copy in the container's /tmp (it contains password hashes). It disappears when the
container restarts; restart once you have checked the import: `docker compose restart app`.

## 3. Switch everyone over
1. Open `https://YOUR-DOMAIN`, log in as an admin, check Team, Attendance and Payments look right.
2. Send staff the new address (or point the old address at the VPS). On first open they log in once.
   Any edits a phone made offline are uploaded on that first login; older copies never overwrite newer server data.
3. When everyone is on the new server and the data is checked, **pause or delete the Supabase project**.
   Its access key is in this repository's history, so anyone could still read or change that copy until it is gone.

Keeping the app on Cloudflare Pages instead: set `CORS_ORIGINS=https://your-pages-site` in `.env`, and in
`index.html` set `window.SJ_API_BASE='https://YOUR-DOMAIN'` before the sjServerSync script. Serving the app from the
VPS (the default) is simpler.

## 4. Updates
```bash
cd swamijet-team-app && git pull && docker compose up -d --build
```
Database migrations run automatically on start. Phones get the "update available" prompt from version.json.

## 5. Backups
- A compressed backup is written to `./backups` at start-up and every 24 hours; 14 days are kept (`BACKUP_KEEP_DAYS`).
- **Copy backups off the VPS** (if the VPS is lost, so are local backups). For example, nightly from another machine:
  `rsync -a root@YOUR-VPS:swamijet-team-app/backups/ ./swamijet-backups/`
- Test a restore every month (see docs/RUNBOOK.md).
