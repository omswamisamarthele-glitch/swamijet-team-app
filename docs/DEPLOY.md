# Deploying SwamiJet on a VPS (no Docker)

One small Ubuntu server runs everything with Ubuntu's own packages: PostgreSQL, Node.js (the SwamiJet server,
which also serves the app), Caddy for HTTPS, and a nightly backup. About $5/month; 1 vCPU / 1 GB RAM is enough.

## 1. Install (once, about 5 minutes)
1. Create an **Ubuntu 24.04** VPS. Point a domain at it (DNS A record), e.g. `team.yourshop.in` → VPS IP.
   HTTPS is required: phones only allow camera, GPS and install-to-home-screen on HTTPS.
2. SSH in as root and run:
   ```bash
   git clone -b claude/eloquent-feynman-8y7xsy https://github.com/omswamisamarthele-glitch/swamijet-team-app.git /opt/swamijet
   bash /opt/swamijet/deploy/install-ubuntu.sh team.yourshop.in
   ```
   The script installs the packages, creates the `swamijet` database with a random password (saved in
   `/opt/swamijet/server/.env`), starts the `swamijet` service, sets up HTTPS, a 02:30 nightly backup to
   `/var/backups/swamijet`, and the firewall (SSH, 80, 443). It ends by printing `{"ok":true,...}`.
   Running it again is safe.

## 2. Move the data from Supabase (once)
The anon key is in Supabase Dashboard > Project Settings > API.
```bash
cd /opt/swamijet/server
sudo -u swamijet env SUPABASE_ANON_KEY='eyJ...' node scripts/import-app-data.js https://cvcrffxonrmtyaklhgbl.supabase.co
```
It prints the number of records imported and the logins created from the team list. Everyone keeps their
current username and password. A login shown as `NO PASSWORD` needs one:
`sudo -u swamijet node scripts/reset-password.js <username> <new password>`.
Running the import again is safe (a record is only replaced by a copy with a newer `_up`).
It keeps a raw copy in /tmp (contains password hashes); delete it when done: `rm /tmp/supabase-export-*.json`.

No Supabase data to bring? Create the first admin instead:
`sudo -u swamijet node scripts/create-admin.js <username> '<password>'`.

## 3. Switch everyone over
1. Open `https://YOUR-DOMAIN`, log in as an admin, check Team, Attendance and Payments.
2. Send staff the new address. On first open each person logs in once. Edits a phone made offline are uploaded
   then; older copies never overwrite newer server data.
3. When everyone is on the new server and the data is checked, **pause or delete the Supabase project**.
   Its access key is in this repository's history, so anyone could still read or change that copy until it is gone.

## 4. Updates
```bash
bash /opt/swamijet/deploy/update.sh
```
Pulls the latest code, installs packages, restarts; database changes apply automatically on start.
Phones get the "update available" prompt from version.json.

## 5. Backups
- Nightly at 02:30 to `/var/backups/swamijet`, 14 days kept. Log: `/var/log/swamijet-backup.log`.
- **Copy them off the VPS** (a lost VPS takes its backups with it), e.g. nightly from another machine:
  `rsync -a root@YOUR-VPS:/var/backups/swamijet/ ./swamijet-backups/`
- Test a restore monthly (docs/RUNBOOK.md).
