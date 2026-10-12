# Test SwamiJet on your own computer

Runs the full app + server + PostgreSQL on your PC at **http://localhost:8080**. Nothing here touches the live
Supabase data or the live app.

## 1. Get the code
Either `git clone https://github.com/omswamisamarthele-glitch/swamijet-team-app.git` then
`git checkout claude/eloquent-feynman-8y7xsy`, or download the ZIP of that branch:
https://github.com/omswamisamarthele-glitch/swamijet-team-app/archive/refs/heads/claude/eloquent-feynman-8y7xsy.zip
and unzip it. Open a terminal (Windows: PowerShell) **in that folder**.

## 2a. Easiest: with Docker Desktop
Install Docker Desktop (https://www.docker.com/products/docker-desktop/) and start it. Then:
```bash
docker compose -f docker-compose.local.yml up -d --build                              # first time takes a few minutes
docker compose -f docker-compose.local.yml exec app node server/scripts/seed-demo.js  # demo data (optional)
```
Open **http://localhost:8080**.

| Command | What it does |
|---|---|
| `docker compose -f docker-compose.local.yml logs -f app` | show server log |
| `docker compose -f docker-compose.local.yml down` | stop (data is kept) |
| `docker compose -f docker-compose.local.yml down -v` | stop and delete all local data (fresh start) |

## 2b. Without Docker
1. Install **Node.js 22 LTS** (https://nodejs.org) and **PostgreSQL 16** (https://www.postgresql.org/download/;
   on Windows remember the password you set for user `postgres`).
2. Create an empty database named `swamijet` (pgAdmin: right-click Databases > Create, or `createdb -U postgres swamijet`).
3. Copy `server/.env.example` to `server/.env` and put your postgres password in `DATABASE_URL`.
4. In the terminal:
   ```bash
   cd server
   npm install
   npm run seed-demo     # demo data (optional)
   npm start             # keep this window open; Ctrl+C stops the server
   ```
Open **http://localhost:8080**.

## 3. Logins
| Username | Password | Role |
|---|---|---|
| `localadmin` | `LocalTest#2026` | Admin (always created on a new database) |
| `owner` | `Owner#2026` | Admin (demo data) |
| `ravi` | `Ravi#2026` | Technician (demo data) |
| `priya` | `Priya#2026` | Accountant (demo data) |

## 4. Test with your real data (optional)
This only **reads** from Supabase; Supabase is not changed. The anon key is in Supabase Dashboard > Project Settings > API.
Afterwards everyone's real username and password work on your local copy.
```bash
# Docker:
docker compose -f docker-compose.local.yml exec -e SUPABASE_ANON_KEY="eyJ..." app node server/scripts/import-app-data.js https://cvcrffxonrmtyaklhgbl.supabase.co
# Without Docker (inside server/):
#   PowerShell:  $env:SUPABASE_ANON_KEY="eyJ..."; npm run import -- https://cvcrffxonrmtyaklhgbl.supabase.co
#   Mac/Linux:   SUPABASE_ANON_KEY="eyJ..." npm run import -- https://cvcrffxonrmtyaklhgbl.supabase.co
```

## 5. What to try
- [ ] Log in as each role; a wrong password and `admin` / `admin123` must be refused.
- [ ] Two "phones": a normal window and a private/incognito window, logged in as different users.
      Edit different records in each, wait a few seconds (or reload), both edits appear in both windows.
- [ ] As `ravi`: changing salary data or another member is refused and reverts on the next sync.
- [ ] As admin: add a member with a username and password, then log in as them in the other window.
- [ ] Deactivate that member: their window is logged out on its next sync.
- [ ] Offline: turn off Wi-Fi (or Docker/server), make an edit, turn it back on: it syncs.
- [ ] Reload the page: you stay logged in.

## Testing from a phone
On the same Wi-Fi, open `http://<your-PC-IP>:8080` (find the IP with `ipconfig` on Windows). Login and sync work,
but **camera, GPS check-in and install-to-home-screen need HTTPS**, which a plain local address does not have.
For a quick HTTPS address, install cloudflared and run `cloudflared tunnel --url http://localhost:8080`; it prints
an `https://...trycloudflare.com` link you can open on the phone (temporary, stops when you close it).
On the PC itself, `http://localhost:8080` is treated as secure, so the camera works there.
