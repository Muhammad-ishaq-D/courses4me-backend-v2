# Courses4Me Backend v2

Node.js + Express + MySQL API for the Courses4Me platform (customer portal
`courses4me.co.uk` and the admin panel `admin.courses4me.co.uk`).

Modules are brought online one at a time; only the modules listed as ready are
mounted in `src/app.js`.

| Module | Status |
| --- | --- |
| Authentication (customer, admin, portal password reset, social login, user management) | ready |
| Courses | ready |
| Locations and course scheduling (course-locations, dates) | ready |
| Bookings, payments (Stripe) and the payment-window job | ready |
| Settings, notifications, dashboard and the weekly report | ready |
| Licences (bookable, with their own venues) | ready |
| Jobs (vacancies and applications) | ready |
| Reviews | ready |
| Blog (articles for the public site) | ready |

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
| `npm run import:legacy:dry` | Load the previous records, then roll it back (see below) |
| `npm run import:legacy` | Load the previous records |

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
- Tables: `users`, `user_devices`, `user_activity_logs`, `password_resets`, `audit_logs`,
  `courses`, `course_list_items`, `course_venues`, `course_venue_schedules`,
  `locations`, `location_facilities`, `location_gallery`, `course_locations`,
  `course_location_dates`, `course_location_date_timings`, `bookings`,
  `booking_extension_history`, `booking_reschedule_history`, `booking_attendance`,
  `booking_certificates`, `settings`, `notifications`, `licenses`, `license_list_items`,
  `license_application_steps`, `license_pricing_breakdown`, `license_related_courses`,
  `license_venues`, `license_venue_schedules`, `job_listings`, `job_listing_requirements`,
  `job_applications`, `reviews`, `blogs`, `blog_blocks`, `blog_block_items`.

## Importing the previous data

Two scripts move the live records across. They are run once, in order, and can be
repeated at any time.

**1. Take a snapshot** — in the previous backend, which is where that database is
configured:

```bash
cd ../courses4me-backend
node scripts/export_for_mysql.js          # writes ../legacy-export/*.json
```

Each collection becomes one JSON file, with record ids as plain 24-character strings
and dates as ISO strings. `_manifest.json` records where the snapshot came from and
when it was taken.

**2. Load it** — here:

```bash
npm run import:legacy:dry                 # do the whole import, then undo it
npm run import:legacy                     # keep it
```

| Option | What it does |
| --- | --- |
| `--dir <path>` | where the snapshot is (default `../legacy-export`) |
| `--dry-run` | run the whole import inside a transaction, roll it back, print the summary |
| `--only a,b` | import only these groups |

Groups run in the order their references require: `users`, `locations`, `courses`,
`courseLocations`, `courseLocationDates`, `licenses`, `bookings`, `jobListings`,
`jobApplications`, `reviews`, `notifications`, `settings`.

### What makes it safe

- **All of it, or none of it.** The run is one transaction. A value that will not fit
  or a reference that cannot be resolved aborts everything, so the database is never
  left half-migrated. `--dry-run` performs every real insert and then rolls back, so
  what it reports is exactly what a real run would do.
- **Repeatable.** Every record keeps its previous id in `legacy_id` (unique on every
  top-level table). A second run finds that row and updates it instead of inserting a
  duplicate, so you can re-import after a fresher snapshot. Child rows — list items,
  facilities, timings, requirements — are replaced as a set, so they never stack up.
- **Accounts are never overwritten.** An address that already exists here is linked to
  its previous id and otherwise left alone: the password and profile in this database
  are the current ones. The summary counts these as `linked`.
- **Values that do not fit are reported, not silently dropped.** A category or status
  this database does not list falls back to the column default and the run prints a
  line naming the record.
- **A dropped connection is retried, not fatal.** The link to the database is remote
  and occasionally resets mid-run. Because the whole import is one transaction, a
  reset leaves nothing behind, so the script simply starts over — up to four attempts.
  Only a real data problem stops it.

Not carried over: `passwordresets` (one-time codes that expire within the hour, and
the reset flow here hashes them differently) and `geocodecaches` (a lookup cache,
rebuilt on demand).

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
                         auditService, userStatsService, courseSessionService, licenseLookupService,
                         seatService, bookingService, bookingEmailService, bookingExpiryService,
                         stripeService, dashboardService, weeklyReportService, cronService)
                         NOTE: DATE columns are written through each model's toSqlDate() so a
                         server time zone can never move a calendar date to the day before.
  validators/            Joi schemas per module (+ common building blocks)
  middlewares/           authMiddleware (protect / authorize / optionalProtect), validateMiddleware,
                         errorMiddleware, rateLimiters, requestId, parseJsonBody, upload*
  utils/                 logger, sendEmail, notifyAdmins, isEmailTemplateActive
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

### Cross-module lookups

`GET /courses/:id` also answers for a licence id: the licence is matched to the course that
teaches it by a keyword in its title, and the licence itself is returned when nothing matches
(`services/licenseLookupService.js`). Every table a module reads now exists, so the temporary
`tableExists` probe has been removed.

## Courses

### Endpoints

| Method | Path | Access | Notes |
| --- | --- | --- | --- |
| GET | `/api/courses` | public | `?category=&status=&search=&location=`; non-admins only ever see `Published` |
| GET | `/api/courses/stats/categories` | public | `[{ _id: category, count }]`; published only unless admin |
| GET | `/api/courses/:id` | public | 403 when the course is not published and the caller is not an admin |
| POST | `/api/courses` | admin | required: `title`, `category`, `duration`, `shortDescription`, `fullDescription`, `pricing.basePrice` |
| PUT | `/api/courses/:id` | admin | partial update (see below) |
| DELETE | `/api/courses/:id` | admin | removes the course and its children |

### Shape and storage

- A course row keeps the scalars; `pricing`, `instructor` and `guarantee` are flattened into
  prefixed columns and rebuilt as nested objects in the response.
- The four display lists (`highlights`, `learningPoints`, `targetAudience`, `requirements`)
  share `course_list_items`, told apart by `type` and kept in order by `position`.
- `locations[]` are rows in `course_venues`, each with its `schedules[]` in
  `course_venue_schedules` (`ON DELETE CASCADE` both ways).
- `sessions` is a read-only array: the venue schedules flattened, plus the dates of the
  scheduling module (`course_locations` → `course_location_dates`) on the listing endpoint,
  where a date belonging to a disabled location is left out.
- **Partial updates:** scalars change only when sent. A list or `locations` is replaced only
  when the payload contains it, so omitting one keeps what is stored.
- **Venue postcodes are geocoded server-side** (postcodes.io): the stored postcode is the
  normalised one, latitude/longitude are filled in, and a postcode whose area does not match
  the venue name is rejected with 400.
- Both payload styles work: JSON, or `multipart/form-data` with `thumbnail` /
  `instructorPhoto` files (nested fields then arrive as JSON strings and are parsed by
  `parseJsonBody`).

## Locations and course scheduling

A **location** is a venue. A **course-location** is one course offered at that venue, with its
own price and deposit terms, and it owns the **dates** (sessions) students book.

### Endpoints

| Method | Path | Access | Notes |
| --- | --- | --- | --- |
| GET | `/api/locations` | public | `?search=&status=&page=&limit=` (20 per page); adds `linkedCoursesCount` |
| GET | `/api/locations/:id` | public | `linkedCoursesCount` here counts every link, whatever its status |
| GET | `/api/locations/:id/courses` | public | the links of a venue, each with a short course summary |
| POST | `/api/locations` | admin | required: `name`, `addressLine1`, `city`, `postcode` |
| PUT | `/api/locations/:id` | admin | partial; `facilities` / `gallery` are replaced only when sent |
| PATCH | `/api/locations/:id/status` | admin | `{}` flips the status, `{ status }` sets it |
| GET | `/api/course-locations` | public | active links of published courses, with location, course and dates |
| GET | `/api/course-locations/course/:courseId` | public | `?activeOnly=true` hides inactive links and disabled venues |
| GET | `/api/course-locations/:id` | public | one link with its dates |
| POST | `/api/course-locations/course/:courseId` | admin | required: `locationId`, `price`; `dates` optional |
| PUT | `/api/course-locations/:id` | admin | see the dates rule below |
| DELETE | `/api/course-locations/:id` | admin | removes the link and its dates |
| POST | `/api/course-locations/:id/dates` | admin | add one date |
| PUT | `/api/course-location-dates/:id` | admin | update one date |
| DELETE | `/api/course-location-dates/:id` | admin | delete one date |

### Rules

- **Seats are reported as availability.** A date carries `availableSeats` = seats left
  (`available_seats − booked_seats`) and `bookedSeats: 0`; the single-date endpoints also return
  `seatsRemaining` and `availabilityStatus` (Available / Selling Fast ≤ 5 / Sold Out).
- **`dates` on PUT is the complete set**: entries with an `_id` are updated, new entries added and
  anything missing deleted. Omit `dates` to leave the schedule alone.
- **One link per course + location** (`uq_course_locations_pair`), and an `Inactive` location cannot
  be linked at all.
- **Timings:** `timingsType: "same"` uses `startTime`/`endTime`; `"flexible"` uses `weeklyTimings`
  (per weekday `isOff`, `startTime`, `endTime`), stored in `course_location_date_timings`.
  Times are `HH:MM` in and out.
- These dates also appear in a course's `sessions` on `GET /api/courses`, where a date whose venue
  has been disabled is left out.
- Postcodes are stored upper-case. Deleting a location or a course removes its links, dates and
  timings (`ON DELETE CASCADE`); `courses.location_id` is `ON DELETE SET NULL`.

## Bookings and payments

### Endpoints

| Method | Path | Access | Notes |
| --- | --- | --- | --- |
| POST | `/api/bookings` | public | checkout: takes a seat, creates the account if the email is new |
| GET | `/api/bookings/reference/:ref` | public | re-checks a pending payment with Stripe before answering |
| GET | `/api/bookings/my-status/:courseId` | user | PAID / PENDING / NONE plus the sessions already held |
| GET | `/api/courses/user/enrolled` | user | the student dashboard, grouped by lifecycle |
| GET | `/api/bookings` | admin | `?status=&paymentStatus=&fromDate=&toDate=&search=` |
| GET/PUT/DELETE | `/api/bookings/:id` | admin | read, set status/paymentStatus, delete |
| PUT | `/api/bookings/:id/lifecycle` | admin | extend, reschedule, postpone, cancel, complete, resume |
| POST | `/api/bookings/:id/refund/request` | user | owner only, PAID and still upcoming; `proof` file optional |
| POST | `/api/bookings/:id/refund/process` | admin, editor | approve (refunds at Stripe) or reject |
| GET | `/api/bookings/users` | admin | customers with `bookingCount` and `totalSpent` |
| GET/PUT/DELETE | `/api/bookings/users/:id` | admin | one customer; deleting removes their bookings |
| POST | `/api/bookings/users/bulk-delete` | admin | `{ ids: [] }` |
| POST | `/api/stripe/create-checkout-session/:bookingId` | public | hosted Stripe page |
| POST | `/api/stripe/create-payment-intent/:bookingId` | public | embedded card form |
| POST | `/api/stripe/webhook` | Stripe | signature-verified; mounted before the JSON parser |

### Rules

- **Seats are taken atomically.** The reservation is `UPDATE … WHERE booked_seats < available_seats`
  (or `seats_available > 0`), so two customers cannot take the same last seat; a full session
  answers `400`. Taking the seat, creating the account and writing the booking happen in one
  transaction, so a failure leaves neither a held seat nor a half-written booking.
- **A session is identified by id *and* source.** `session_schedule_source` says whether the id
  belongs to `course_location_dates` or `course_venue_schedules` — both sequences start at 1.
- **The price comes from the server**: the course-location link price, not the posted `totalAmount`.
- **One active booking per customer and course.** A second attempt returns 400 with the existing
  booking's id and status.
- **Payment window:** a booking holds its seat for `BOOKING_PAYMENT_WINDOW_MINUTES` (60). The
  job in `cronService` then marks it `EXPIRED`, releases the seat and emails the customer.
- **Late payments:** if the money arrives after expiry, the seat is re-taken when one is free;
  when the session has sold out the payment is refunded automatically and the student told.
- **Refunds** move the money at Stripe first, then cancel the booking and put the seat back on
  sale. `refundType: "partial"` refunds the total minus `deductionAmount`.
- **Reschedules** need 48 hours' notice, stay within six months of the original date and are
  capped at two. Without `forceBypass48h` the student pays a £70 fee first and the new dates are
  applied by the webhook.
- Emails (confirmation, receipt, failure, expiry, lifecycle, refunds, reschedule) live in
  `bookingEmailService` and honour the Settings > Email Templates toggles. A delivery failure is
  logged and never fails the request.

## Settings, notifications and the dashboard

### Endpoints

| Method | Path | Access | Notes |
| --- | --- | --- | --- |
| GET | `/api/settings` | admin | the row is created with the defaults on first read |
| PUT | `/api/settings` | admin | replaces only the blocks sent: `general`, `notifications`, `emailTemplates` |
| GET | `/api/notifications` | user | the 20 most recent for the signed-in user, with `unreadCount` |
| PUT | `/api/notifications/:id/read` | user | 401 for someone else's notification |
| PUT | `/api/notifications/readall` | user | marks the whole feed read |
| GET | `/api/dashboard` | admin | `?startDate=&endDate=` filters bookings and revenue only |
| GET | `/api/dashboard/analytics` | admin | six months of customers and revenue, plus the top five courses |

### What the settings control

- `notifications` is a map of alert toggles. `notifyAdmins({ settingKey })` checks it before writing,
  so switching `bookingAlerts` off stops those rows being created for every admin and editor.
- `emailTemplates[].isActive` decides which customer emails go out (booking confirmation, receipt,
  cancellation, course completion, password reset). An unknown key is treated as active, so mail is
  never switched off by a typo.
- Both fail open: with no settings row saved, every alert and email is sent.

### Dashboard notes

- The charts always return **six points**, so an empty month still appears on the axis.
- `lowSeats` covers both places a session can live — the scheduling module and the schedules
  attached to a course — and lists anything with five seats or fewer.
- `topCourses[].rating` is the average review score, `null` until a course has been reviewed.
- The weekly summary runs on Mondays at 08:00 UTC through `weeklyReportService`, and honours the
  `weeklyReport` toggle.

## Licences

A licence is a product in its own right — it has its own venues and dated sessions, so a student
books it through the same endpoint they book a course with.

### Endpoints

| Method | Path | Access | Notes |
| --- | --- | --- | --- |
| GET | `/api/licenses` | public | `?category=&status=&search=&page=&limit=` (10 per page) |
| GET | `/api/licenses/:id` | public | 403 when not published and the caller is not an admin |
| POST | `/api/licenses` | admin | required: `title`, `category`, `shortDescription`, `fullDescription`, `pricing.basePrice` |
| PUT | `/api/licenses/:id` | admin | partial update (see below) |
| DELETE | `/api/licenses/:id` | admin | removes the licence and everything under it |

### Shape and storage

- The listing returns the same array under **both** `data` and `licenses`, with `total`, `page`,
  `limit` and `count`. The single-licence response is under `data` **and** spread at the top level.
- `highlights`, `learningPoints` and `requirements` share `license_list_items` (told apart by
  `type`, ordered by `position`); `applicationSteps`, `pricingBreakdown` and `relatedCourses`
  each have their own table, and `locations[]` are rows in `license_venues` with their
  `schedules[]` in `license_venue_schedules`.
- `pricingBreakdown[].price` is free text ("£220", "Included") so the fee table prints as written.
- **Credentials are issued on create:** `licenseNumber` (`SIA-########`), `holderId` (`LH-###`) and a
  three-year `expiryDate`; `holderName` defaults to the licence title.
- `relatedCourses` holds course ids in a listing and the full course records on a single licence.
  A course that has since been deleted is skipped rather than failing the save.
- **Partial updates:** scalars change only when sent, and each nested block is replaced only when
  the payload contains it.

### Booking a licence

`POST /api/bookings` takes a licence id as `courseId` and one of its schedule ids as
`session.scheduleId`. The booking is stored with `course_type = 'License'` and
`session_schedule_source = 'license_venue_schedule'`, and the seat is taken from
`license_venue_schedules` by the same atomic reservation used for courses.

## Jobs

### Endpoints

| Method | Path | Access | Notes |
| --- | --- | --- | --- |
| GET | `/api/jobs` | public | `?category=&type=&status=&search=`; paused and closed vacancies are included |
| GET | `/api/jobs/:id` | public | returned under `data` and `listing` |
| POST | `/api/jobs` | admin | required: `title`, `company`, `location`, `category`, `salary`, `description` |
| PUT | `/api/jobs/:id` | admin | partial; `requirements` replaced only when sent |
| DELETE | `/api/jobs/:id` | admin | applications are kept (see below) |
| POST | `/api/jobs/apply/:id` | public | one application per candidate per vacancy |
| GET | `/api/jobs/my-applications` | user | the candidate's own applications, with the vacancy attached |
| GET | `/api/jobs/applications` | admin | `?status=&search=` |
| PUT | `/api/jobs/applications/:id/status` | admin | moves the stage and emails the candidate |

### Rules

- **One application per candidate per vacancy.** A signed-in candidate is matched by account, a
  guest by email address; a second attempt answers 400.
- **Applying can create an account.** Send a `password` with the form and a customer account is
  created and linked to the application; signing in first links it to that account instead.
- `requirements` may be sent as an array or as one comma-separated line — both are stored as an
  ordered list.
- **Applications outlive their vacancy.** Each one keeps its own copy of the job title, and
  `job_listing_id` is `ON DELETE SET NULL`, so the review queue still reads correctly after a
  vacancy is withdrawn.
- Each application gets a `REF-XXXXXXX` reference; the candidate is emailed on submission and on
  every stage change (`services/jobEmailService.js`), and the admins get a notification.
- The listing returns the same array under `listings` and `data.listings`; the review queue under
  `applications` and `data.applications`.

## Reviews

| Method | Path | Access | Notes |
| --- | --- | --- | --- |
| POST | `/api/reviews` | user | `{ bookingId, rating, comment }`; 201 for a new review, 200 when it replaced one |
| GET | `/api/reviews/my` | user | the customer's own reviews, newest first |

- A review may only be left for a booking the signed-in customer **has paid for**; anything else
  answers 403.
- **One review per customer per course** (`uq_reviews_user_course`). Submitting again replaces it
  in a single `INSERT … ON DUPLICATE KEY UPDATE`, so two submissions at once cannot both insert.
- `course_id` has no foreign key: a review can be about a course or a licence, named by
  `course_type` — the same pair a booking stores. The originating booking is kept
  (`ON DELETE SET NULL`) so a review can be traced to the purchase that earned it.
- The admins are notified on a **new** review only, gated by the `courseReview` toggle.
- Scores feed `topCourses[].rating` and `reviewCount` on the analytics page.

## Blog

| Method | Path | Access | Notes |
| --- | --- | --- | --- |
| GET | `/api/blogs` | public | published articles, featured first; `category`, `search`, `page`, `limit` |
| GET | `/api/blogs/:id` | public | by numeric id **or** slug; returns the body and counts a read |
| POST | `/api/blogs` | admin | `title` is the only required field |
| PUT | `/api/blogs/:id` | admin | partial; the body is replaced only when `content` is sent |
| DELETE | `/api/blogs/:id` | admin | blocks and list items cascade |
| DELETE | `/api/blogs` | admin | `{ ids: [1, 2] }`, returns `deleted` |

- **The body is blocks, not HTML.** An article is an ordered list of `paragraph`, `heading`,
  `subheading`, `quote`, `list` and `numberedList`. The list types carry `items`; the rest carry
  `text`, and sending the wrong one is a 400 rather than a silent drop. `blog_blocks` holds one
  row per block and `blog_block_items` the entries of a list, both ordered by `position`.
- **A visitor only ever sees published articles.** `status` is honoured for an admin token and
  ignored for everyone else, so `?status=Draft` cannot leak an unfinished article.
- **Slugs are unique and derived.** An empty slug is made from the title; a clash gets a number
  appended. The numeric id keeps working, so the portal's `/blog/:id` links are unaffected.
- A cover posted as a `data:image/...` URI is uploaded to Cloudinary (`courses4me/blogs`) and the
  article stores the URL, so a row never carries a few hundred kilobytes of image.
- `GET /api/blogs` also returns `categories`, the published count per category, which is what the
  filter bar on the blog page counts with.

### Seeding the articles the portal used to carry

The portal used to hold its 12 articles in `course4me/src/data/blogs.js`. They now live here:

```bash
npm run seed:blogs -- --dry-run     # report what it would do
npm run seed:blogs                  # write them, uploading each cover once
```

Keyed on the id each article has in that file, so running it again updates rather than
duplicates. Two of those articles share a slug, which the database will not allow — the second
gets `-2`. A cover that is already hosted is never re-uploaded, so replacing one in the admin
survives a re-run.

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
npm run postman         # every module
npm run postman:auth    # scripts/update_postman_auth.js — folders 0–5
npm run postman:courses # scripts/update_postman_courses.js — folder 6
npm run postman:locations # scripts/update_postman_locations.js — folders 7–8
npm run postman:bookings # scripts/update_postman_bookings.js — folders 9–11
npm run postman:admin   # scripts/update_postman_admin.js — folders 12–14
npm run postman:licenses # scripts/update_postman_licenses.js — folder 15
npm run postman:jobs    # scripts/update_postman_jobs.js — folder 16
npm run postman:reviews # scripts/update_postman_reviews.js — folder 17
npm run postman:blogs   # scripts/update_postman_blogs.js — folder 18
```

Set `baseUrl`, `testEmail`/`testPassword`, `adminEmail`/`adminPassword`. Login requests
store `token`/`adminToken`; *Verify OTP* stores `reset_token`. Test accounts only.

## Operational notes

- Logging: `src/utils/logger.js` (`LOG_LEVEL=debug|info|warn|error`); requests via morgan.
- Cron (`src/services/cronService.js`, UTC): daily purge of password-reset rows older than 24 h,
  every minute the expiry of bookings whose payment window has closed, and the weekly admin summary
  on Mondays at 08:00. `DISABLE_CRON=true` turns scheduling off.
- Transient MySQL socket resets are retried once by `db.query`; idle pool connections are
  recycled every 30 s for remote hosts.
