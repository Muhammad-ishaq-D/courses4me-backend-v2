# Courses4Me Backend v2

Node.js + Express + MySQL API for the Courses4Me platform (customer portal
`courses4me.co.uk` and the admin panel `admin.courses4me.co.uk`).

Modules are brought online one at a time; only the modules listed as ready are
mounted in `src/app.js`.

| Module | Status |
| --- | --- |
| Authentication (customer, admin, portal password reset, social login, user management) | ready |
| Locations, Courses, Course-Locations, Course-Location-Dates | pending |
| Licenses | pending |
| Bookings, Stripe, booking cron | pending |
| Jobs (listings, applications) | pending |
| Reviews, Notifications, Settings, Dashboard, weekly report cron | pending |

## Setup

```bash
npm install
cp .env.example .env   # fill in DB_*, JWT_SECRET, OTP_SECRET, Cloudinary, SMTP, OAuth
npm run migrate        # creates every table on an empty database
npm run seed:admin -- --email admin@courses4me.co.uk --password 'Str0ng!Pass' --name "Site Admin"
npm run dev
```

`GET /health` answers as soon as the process is up (always 200; the `db` field reports
`up` or `down`). `npm run check` runs the dependency audit and the test suite.

## Database migrations

Schema is managed with [Knex migrations](https://knexjs.org/guide/migrations.html)
(`knexfile.js` is CLI-only; the app pool lives in `src/config/db.js`).

| Command | What it does |
| --- | --- |
| `npm run migrate` | Apply every pending migration in `database/migrations/` |
| `npm run migrate:status` | Show which migrations are applied / pending |
| `npm run migrate:make <name>` | Create a new migration file |

- `database/schema.sql` is the **baseline**. `00000000000000_baseline.js` runs it on an
  empty database and skips itself when `users` already exists, so `npm run migrate` is
  always safe against a live database.
- Every later schema change is a timestamped migration file. Never edit `schema.sql`
  by hand and never run ad-hoc `ALTER TABLE` on production.

### Schema conventions

- `snake_case` columns; models map rows to the camelCase keys the frontends use
  (`id` is also returned as `_id`).
- Instants are `DATETIME` in UTC (driver `timezone: 'Z'`, session `+00:00`) and serialise
  as ISO strings with `Z`. `DATE` columns (e.g. `users.dob`) are returned as `YYYY-MM-DD`.
- Every table has `created_at` / `updated_at` maintained by MySQL.
- Tables: `users`, `user_devices`, `user_activity_logs`, `password_resets`, `audit_logs`.

## Project layout

```
src/
  app.js                 express app: CORS, helmet, rate limits, mounted routes, error handler
  server.js              process bootstrap, DB check, cron init, graceful shutdown
  config/db.js           knex + mysql2 pool, db.query(sql, params), db.withTransaction(fn)
  config/passport.js     Google / Facebook strategies
  routes/                one router per module; body/query/params are Joi-validated
  controllers/           thin: validate → model/service → { success, message, data }
  models/                plain objects of raw-SQL functions
  services/              cross-cutting logic (tokenService, passwordResetService, loginLockoutService,
                         auditService, userStatsService, cronService)
  validators/            Joi schemas per module (+ common building blocks)
  middlewares/           authMiddleware (protect / authorize / optionalProtect), validateMiddleware,
                         errorMiddleware, rateLimiters, requestId, upload*
  utils/                 logger, tableExists, sendEmail, notifyAdmins, isEmailTemplateActive
database/                schema.sql baseline + knex migrations
scripts/                 create_admin.js, update_postman_*.js
tests/                   jest + supertest against an in-memory DB (never touches MySQL)
```

## Authentication

### Endpoints

| Method | Path | Access | Notes |
| --- | --- | --- | --- |
| POST | `/api/auth/register` | public | `{ name, email, password }`; password 8+ chars with uppercase, digit, symbol |
| POST | `/api/auth/login` | public | customer portal; admin/editor accounts are refused (403); locked accounts get 423 `ACCOUNT_LOCKED` |
| POST | `/api/auth/check-email` | public | `{ exists }` across users and bookings |
| GET | `/api/auth/me`, `/api/auth/profile` | user | full profile + `activityHistory` |
| PUT | `/api/auth/updatedetails`, `/api/auth/profile` | user | `name, email, phone, jobTitle, bio, profileImage` (base64 → Cloudinary) |
| PUT | `/api/auth/update-password` | user | `{ currentPassword, newPassword }`; bumps `tokenVersion` |
| GET | `/api/auth/counts` | admin | `{ counts: { customer, admin, editor, total } }` |
| GET | `/api/auth/users` | admin | `?search=&role=&status=`; each user has `activityHistory` + booking stats |
| PUT | `/api/auth/users/:id/status` | admin | `{ status, reason }` |
| DELETE | `/api/auth/users/:id/history` | admin | wipes timeline, leaves one audit entry |
| POST | `/api/admin/auth/login` | public | admin panel; a login from a new device raises an admin alert |
| POST | `/api/admin/auth/forgot-password` | public | emails a 6-digit OTP (10 min) |
| POST | `/api/admin/auth/verify-otp` | public | `{ code }` → `{ data: { resetToken } }` (single use, 10 min) |
| POST | `/api/admin/auth/reset-password` | public | `{ resetToken, newPassword }` |
| POST | `/api/portal/auth/forgot-password` | public | emails `FRONTEND_URL/reset-password?token=…` (10 min) |
| POST | `/api/portal/auth/reset-password` | public | `{ resetToken, newPassword }` (`token`/`password` also accepted) |
| GET | `/api/auth/google`, `/api/auth/facebook` | browser | `?redirect=/path`; callback appends `?token=` |

### Security rules

- **JWT** payload `{ id, role, tokenVersion }`, HS256, issuer `courses4me-api`, audience
  `courses4me`, valid 30 days. `protect` re-reads the user on every request: a
  `tokenVersion` mismatch (password changed/reset) or a `suspended`/`blocked` status
  rejects the token.
- **Passwords** are bcrypt (cost 10); policy 8–128 chars with uppercase, digit and symbol.
  Social-only accounts have `password_hash = NULL`.
- **Login lockout** (per account, on top of the per-IP limiter): `LOGIN_MAX_ATTEMPTS` (5)
  wrong passwords lock the account for `LOGIN_LOCK_MINUTES` (15) → 423 `ACCOUNT_LOCKED`.
  A successful login resets the counter.
- **OTPs and reset tokens** are stored only as HMAC-SHA256 (`OTP_SECRET`) hashes; consuming
  one is a single conditional `UPDATE`, so each can be used once. A new request invalidates
  earlier ones; max 15 OTP attempts per request. A token issued through the admin flow is
  refused on the portal endpoint and vice versa (checked before the token is consumed).
- **Forgot-password** always answers with the same generic 200 message, and the email is
  delivered in the background so the response time doesn't reveal whether the account
  exists. Max `RESET_MAX_PER_HOUR` (3) emails per account per hour. A delivery failure
  deletes the request row.
- **Password changes** (settings or reset) email the account owner a notice.
- **Rate limits** per IP: whole API `API_RATE_LIMIT` (300) / 15 min; login 10 / 15 min;
  forgot 10 / h; verify & reset 15 / 15 min.
- **Audit trail** (`audit_logs`): login success/failure/lockout/blocked, new admin device,
  registration, password change, reset requested/throttled/delivery-failed, OTP
  verify success/failure/too-many, reset-token rejected, reset completed, user status
  changed, history cleared — with user, actor, IP, user-agent and request id. Never
  passwords, OTPs, tokens or JWTs.
- **Request ids**: every response carries `X-Request-Id` (an incoming one from the proxy
  is honoured); error bodies echo it as `requestId`; morgan lines include `id=`.
- **Bodies**: JSON limited to 1 MB, except the two profile-update routes (10 MB, base64
  photos). Validation failures return 400
  `{ success:false, message:'Validation failed', errors:[{field,message}] }`; unknown
  body keys are stripped before they reach a query.
- **Email**: in production SMTP must be configured or sending fails; the Ethereal test
  inbox is only used outside production.
- **Headers**: helmet with HSTS in production, `Referrer-Policy: no-referrer`, no
  `X-Powered-By`. 500 responses never expose internal messages in production.
- **CORS**: `https://*.courses4me.co.uk`, `FRONTEND_URL`, `ADMIN_FRONTEND_URL`, `DEV_ORIGINS`;
  localhost only when `NODE_ENV !== production`.
- **Dependencies**: `npm audit --omit=dev` is clean; run `npm run check` before deploying.

### Cross-module tables

`utils/tableExists.js` lets auth run before later modules are online: booking stats on
the Users page are zero until `bookings` exists; admin alerts (`notifyAdmins`) and the
`passwordReset` email toggle (`isEmailTemplateActive`) are no-ops / fail-open until
`notifications` and `settings` exist.

## Authorization model

| Role | Access |
| --- | --- |
| `admin` | Admin panel, user management, every admin endpoint |
| `editor` | Admin panel login; content permissions are granted per route |
| `customer` | Portal: own profile, bookings, reviews |

Public signup creates `customer` accounts only; admins/editors come from `npm run seed:admin`
(pass `--force` to promote an existing account and replace its password).

## Tests

```bash
npm test
```

Tests mock `src/config/db` with an in-memory implementation (`tests/helpers/mockDb.js`)
and never connect to MySQL.

## Postman

`postman_collection.json` (Postman v2.1) is generated per module:

```bash
npm run postman:auth    # scripts/update_postman_auth.js — folders 0–5
```

Set `baseUrl`, `testEmail`/`testPassword`, `adminEmail`/`adminPassword`. Login requests
store `token`/`adminToken`; *Verify OTP* stores `reset_token`. Test accounts only.

## Operational notes

- Logging: `src/utils/logger.js` (`LOG_LEVEL=debug|info|warn|error`); requests via morgan.
- Cron (`src/services/cronService.js`, UTC): daily purge of password-reset rows older than
  24 h. `DISABLE_CRON=true` turns scheduling off.
- Transient MySQL socket resets are retried once by `db.query`; idle pool connections are
  recycled every 30 s for remote hosts.
