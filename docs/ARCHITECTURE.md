# SwamiJet Architecture

How the code is organised and the rules new code follows. The plan and its phases are in `docs/BACKEND_PLAN.md`.

```
Phone (index.html screens, unchanged)
  └─ sjServerSync layer (classes, end of index.html)      localStorage: sj3_<module>, sj_meta_<module>, sj_token
        │  HTTPS JSON  /api/auth/*  /api/sync
        ▼
Server (server/src, Node.js, one dependency: pg)
  http/          HttpServer → Router → Controllers          (thin: read request, call a service, return JSON)
  auth/ sync/ history/ import/   Services + rules           (all business rules live here)
  repositories/  one class per table                        (all SQL lives here)
  db/            Database (pool, transactions), Migrator
  App.js         composition root: builds and wires everything
        ▼
PostgreSQL: records, records_history, users, sessions, sync_events, schema_migrations
```

## Server: one responsibility per class

| Layer | Classes | Responsibility |
|---|---|---|
| Composition | `App` | Builds every object once from `Config` and injects dependencies. The server (`server.js`), CLI scripts (`scripts/lib/runScript.js`) and tests all start from `App`. |
| Config | `Config` | Immutable settings from environment variables (plus `server/.env` locally). |
| HTTP | `HttpServer`, `Router`, `Request`, `StaticFiles`, `HttpError` | Routing, body parsing, CORS, security headers, mapping domain errors to status codes. |
| Controllers | `AuthController`, `SyncController`, `AdminController`, `HealthController` | One per API area; each registers its own routes (`routes(router)`). |
| Services | `AuthService`, `SyncService`, `HistoryService`, `LegacyImporter` | Use cases: login/sessions, push/pull, restore/prune, Supabase import. |
| Rules | `AccessPolicy`, `WipeGuard`, `ChangeValidator`, `TeamLoginSync`, `Roles`, `RecordFields` | Who may write what; bulk-delete guard; change shape; Team record → login; role and field helpers. |
| Security | `PasswordHasher`, `LoginRateLimiter` | scrypt hashes (+ legacy SHA-256 upgrade); failed-login limit. |
| Data access | `UserRepository`, `SessionRepository`, `RecordRepository`, `SyncEventRepository`, `HistoryRepository` (base `Repository`) | All SQL. `repo.with(tx)` gives the same repository inside a transaction. |
| Database | `Database`, `Transaction`, `Migrator` | Pool, `transaction(work)`, `tx.savepoint(work)`, numbered SQL migrations. |
| Errors | `AppError` → `ValidationError`, `AuthenticationError`, `ForbiddenError`, `TooManyAttemptsError`, `ChangeRejected` | Expected failures carry a `kind`; only `HttpError.from` knows HTTP status codes. |

## Rules for new code
1. **Dependencies point inward:** controllers → services/rules → repositories → database. A repository never calls a service; a service never touches `req`/`res`.
2. **SQL only in repositories.** Business rules only in services/rule classes. Controllers stay thin.
3. **Constructor injection, no hidden globals.** A class receives what it uses (`new SyncService({ records, policy, ... })`); only `App` creates objects. This keeps each class testable with fakes (see `server/test/unit.test.js`).
4. **Transactions:** `database.transaction(async tx => ...)` and `repo.with(tx)`; per-item isolation with `tx.savepoint(...)`.
5. **Errors:** throw a domain error (`ValidationError`, `ChangeRejected`, ...), never an HTTP status from a service.
6. **Config, not constants:** limits and toggles come from `Config` or constructor options (e.g. `new AccessPolicy({ restrictedModules })`).
7. **Database changes** = a new numbered file in `server/db/migrations/`; never edit an applied one.
8. **Node 18 compatible** (Ubuntu 24.04's package): CommonJS, no dependencies beyond `pg` without a reason.

### Recipes
- **New API endpoint:** add a method to a service (or a new service), a controller method plus `router.add(...)` in its `routes()`, and mount the controller in `App`. Add an API test.
- **New write rule:** extend `AccessPolicy` (or pass options from `App`); unit-test it with plain objects.
- **New table (plan Phase 3, per-module tables):** migration + repository + service; wire in `App`. `SyncService` keeps the same push/pull contract, so phones do not change.

## Phone sync layer (`<script id="sjServerSync">` in index.html)

| Class | Responsibility |
|---|---|
| `SwamiJetClient` | Composition: builds the objects below and starts them. |
| `LocalStore` | Everything kept in localStorage (data, sync meta, token, server address); marks its own writes. |
| `ApiClient` | JSON calls to `/api` with the session token; `ApiError` carries the HTTP status. |
| `SyncSnapshot` | One sync's working copy of the modules: find/apply/remove records, list local changes. |
| `SyncEngine` | One sync cycle at a time: push changes in batches, then pull pages; scheduling; flush on close. |
| `SessionManager` | Login, entering the app as the user, logout, expiry, start-up session restore. |
| `StatusView` | Header sync pill, toasts, refreshing the open page. |
| `LegacyBridge` | Points the older code's entry points (`cloudPull`, `doLogin`, ...) at these classes; storage watcher, timers, page events. |
| `RecordHash` | Fingerprint of a record to notice local edits. |

No class fields marked `static x = ...` and no `#private` members in this layer (older iPhone Safari does not support them); constants are assigned after the class.

The rest of `index.html` (the screens) predates this structure; splitting it into modules is plan Phase 7.

## Scaling notes
- The server keeps no state between requests except `LoginRateLimiter` (in memory). Sessions and data are in PostgreSQL, so more server processes can run behind Caddy once the limiter moves to the database.
- Pull is incremental by change `seq` (indexed); push is one transaction per request with a savepoint per record.
- `records` holds every module as JSON rows. Per-module tables (Phase 3) replace `RecordRepository` behind the same `SyncService` contract.

## Tests
| Suite | What | Needs |
|---|---|---|
| `server/test/unit.test.js` | Rule and security classes with fakes | nothing |
| `server/test/api.test.js` | HTTP API end to end | PostgreSQL (`TEST_DATABASE_URL`, name ends in `_test`) |
| `tests/app.e2e.test.cjs` | Server + database + the app in Chromium, several phones | PostgreSQL + Playwright |
