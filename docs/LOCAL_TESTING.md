# Test SwamiJet on your own computer (no Docker)

You need two free programs: **Node.js** and **PostgreSQL**. Then four commands. The app runs at
**http://localhost:8080**. Nothing here touches the live Supabase data or the live app.

## 1. Install (once)
1. **Node.js 22 LTS**: https://nodejs.org (Windows: the `.msi` installer, all defaults).
2. **PostgreSQL 16**: https://www.postgresql.org/download/ (Windows: "Download the installer").
   During install it asks for a password for the user `postgres`. **Write it down.** Keep port `5432`.
   Stack Builder at the end is not needed; close it.

## 2. Get the code
Download and unzip:
https://github.com/omswamisamarthele-glitch/swamijet-team-app/archive/refs/heads/claude/eloquent-feynman-8y7xsy.zip
Use exactly this link: the green "Code > Download ZIP" button on GitHub gives the `main` branch, which is the
old live app and has no server in it.
Windows "Extract All" often makes a folder inside a folder with the same name. Open the **inner** one: the
folder that directly contains `index.html`, `package.json`, `start-windows.bat` and a `server` folder.
Opening the outer one gives `Missing script: "start"`. Windows: click the address bar of that folder,
type `powershell`, press Enter. A terminal opens in the right place.

## 3. Set up and start
```
npm run setup
```
The first time this creates `server\.env` and probably says the password was refused. Open `server\.env` in
Notepad, change the second `postgres` in this line to your PostgreSQL password, and save:
```
DATABASE_URL=postgres://postgres:YOUR-PASSWORD@localhost:5432/swamijet
```
Then:
```
npm run setup      # again: creates the swamijet database, ends with "Setup done"
npm run demo       # optional: demo team, attendance, task, notice
npm start          # keep this window open; Ctrl+C stops the server
```
Open **http://localhost:8080** in Chrome.

## Every time after that (also after closing the window or restarting the PC)
The app only works **while the server window is open**. Closing that window (or restarting the PC) stops the
server, and the browser then shows "This site can't be reached" / `ERR_CONNECTION_REFUSED`.
To start it again, either:
- **Windows: double-click `start-windows.bat`** in the SwamiJet folder. It checks the setup, starts the server
  and opens http://localhost:8080 by itself. Keep its black window open (you can minimise it).
- or open PowerShell in the SwamiJet folder and run `npm start`, then open http://localhost:8080.

You stay logged in, and edits made earlier are still there.

If your password contains `@`, `#`, `/` or `:`, write it URL-encoded
(`@` = `%40`, `#` = `%23`, `/` = `%2F`, `:` = `%3A`).

## 4. Logins
| Username | Password | Role |
|---|---|---|
| `localadmin` | `LocalTest#2026` | Admin (created by setup) |
| `owner` | `Owner#2026` | Admin (demo) |
| `ravi` | `Ravi#2026` | Technician (demo) |
| `priya` | `Priya#2026` | Accountant (demo) |

## 5. What to try
- [ ] Log in as each role. A wrong password and `admin` / `admin123` must be refused.
- [ ] Two "phones": a normal Chrome window and an Incognito window (Ctrl+Shift+N), different users.
      Change different records in each; within a few seconds (or after a reload) both changes show in both.
- [ ] As `ravi`: changing salary data or another member is refused and goes back on the next sync.
- [ ] As admin: Team > add a member with a username and password, then log in as them in the other window.
- [ ] Deactivate that member: their window logs out on its next sync.
- [ ] Stop the server (Ctrl+C), make a change, start it again (`npm start`): the change syncs.
- [ ] Reload the page: you stay logged in.

## Test with your real data (optional)
This only **reads** from Supabase; Supabase is not changed. The anon key is in Supabase Dashboard >
Project Settings > API. Afterwards everyone's real username and password work on your local copy.
In the `server` folder:
```
# PowerShell
$env:SUPABASE_ANON_KEY="eyJ..."; npm run import -- https://cvcrffxonrmtyaklhgbl.supabase.co
# Mac / Linux
SUPABASE_ANON_KEY="eyJ..." npm run import -- https://cvcrffxonrmtyaklhgbl.supabase.co
```

## Start again from empty
In pgAdmin (installed with PostgreSQL) delete the database `swamijet`, or run
`psql -U postgres -c "drop database swamijet"`, then `npm run setup` again.

## Common problems
| Message | Fix |
|---|---|
| Browser: "This site can't be reached" / `ERR_CONNECTION_REFUSED` | The server is not running: double-click `start-windows.bat` (or `npm start`) and keep that window open |
| `Missing script: "start"` or `Could not read package.json` | Wrong folder, or the `main` ZIP. Go into the folder that contains `package.json` and `server` (see step 2); type `dir` to check |
| `Packages are not installed yet` | Run `npm run setup` first |
| `'npm' is not recognized` | Node.js is not installed, or open a new PowerShell window after installing |
| `PostgreSQL refused the username/password` | Fix the password in `server\.env` (step 3) |
| `Cannot reach PostgreSQL` | PostgreSQL is not running: Windows > Services > postgresql-x64-16 > Start |
| `Port 8080 is already in use` | Change `PORT=8080` in `server\.env` to e.g. `8090` and open http://localhost:8090 |

## Testing from a phone
On the same Wi-Fi, open `http://<your-PC-IP>:8080` (find the IP with `ipconfig`). Login and sync work, but
**camera, GPS check-in and install-to-home-screen need HTTPS**. For a temporary HTTPS link, install cloudflared
and run `cloudflared tunnel --url http://localhost:8080`; open the `https://...trycloudflare.com` link it prints.
On the PC itself `http://localhost:8080` counts as secure, so the camera works there.
