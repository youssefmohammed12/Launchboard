# Launchboard Backend Contract

**Status: implemented contract, including the local v1.3.5 Account Settings candidate.** The React/Vite frontend supports a default localStorage workspace and an opt-in authenticated API workspace. The Express/TypeScript API, shared domain package, user-scoped opportunity aggregate, nested workspace, bulk actions/Undo, email verification, password recovery and account self-service routes are implemented. Additive migrations 001–007 are present in the repository; the hosted Production TiDB database records migrations 001–007. Migration 007 adds Contract to the opportunity type constraint; the new definition is verified in the live opportunities table. Migration 006 adds the optional profile display name. The workstation's local XAMPP database is separate and was not changed by the hosted migration. Account Settings and branded email changes remain uncommitted and undeployed; see `docs/v1.3.5-release-notes.md` and `docs/deployment-readiness.md`.

The browser app supports localStorage and opt-in API modes. `launchboard.opportunities.v1`, `launchboard.recovery.raw.v1` and `launchboard.views.v1` remain browser-local keys; API mode does not replace or delete them. Saved Views remain local preferences.

---

## 1. Current domain and persistence facts

### 1.1 Opportunity fields

The authoritative frontend type is `src/types/opportunity.ts`.

| Field | Current type / shape | Current semantics |
|---|---|---|
| `id` | non-empty string | Client-generated UUID, or a legacy `op-…` fallback. Unique in one local collection. |
| `title` | string | Required after trimming; stored as entered. No explicit maximum in the frontend. |
| `company` | string | Required after trimming; stored as entered. No explicit maximum in the frontend. |
| `type` | `Internship \| Full-time \| Part-time \| Freelance` | Required exact value. |
| `status` | `Saved \| Applied \| Interview \| Offer \| Rejected` | Required exact value. |
| `priority` | `Low \| Medium \| High` | Unknown stored values repair to `Medium`. |
| `tags` | `string[]` | Trimmed, empty removed, case-insensitive dedupe keeping first spelling, max 10, max 24 characters each. |
| `url` | string | Optional HTTP(S) application link. The form validates it; stored/imported values are not repaired by the storage normalizer. |
| `deadline` | `YYYY-MM-DD` or `''` | Local calendar date, never a timestamp. Invalid stored values repair to `''`. |
| `followUpDate` | `YYYY-MM-DD` or `''` | Local calendar date. Invalid stored values repair to `''`. |
| `compensation` | string | Free text, stored as entered. |
| `description` | string | Free text, stored as entered. |
| `notes` | string | Free text, stored as entered. |
| `archivedAt` | ISO 8601 timestamp, or absent | Missing means active. Archive state is independent of `status`. Malformed values repair to active. |
| `isDemo` | `true`, or absent | Demo-data marker. Missing/false is normal. |
| `activities` | `ActivityEntry[]` | Insertion order is authoritative; display sorts newest first. |
| `interviews` | `InterviewEntry[]` | Insertion order is authoritative; display sorts chronologically. |
| `contacts` | `ContactEntry[]` | Insertion order is authoritative. |
| `materials` | `MaterialEntry[]` | Insertion order is authoritative. |
| `tasks` | `TaskEntry[]` | Required normalized collection; older local records and v1 backups normalize to `[]`. Task IDs are unique within the parent opportunity; insertion order is authoritative. |

### 1.2 Nested records

| Record | Fields | Rules |
|---|---|---|
| Activity | `id`, `type`, `date` (`YYYY-MM-DD`), `note` | Required ID, known type and valid date; malformed entries are dropped. `Status changed` is system-owned. |
| Interview | `id`, `round`, `date`, `time` (`HH:mm` or `''`), `mode`, `status`, `outcome` (`''` or value), `meetingUrl`, `location`, `preparationNotes`, `notes`, `contactId` | `round` and real date required. Unknown mode/status/outcome repair to `Other`/`Scheduled`/`''`. `contactId` must be a contact in the same opportunity, or `''`. Max 25 per opportunity. |
| Contact | `id`, `name`, `role`, `email`, `phone`, `website`, `notes` | `name` required. Invalid optional email/website repair to `''`. Max 25 per opportunity. |
| Material | `id`, `label`, `kind`, `url`, `version`, `status`, `notes` | `label` required. Unknown kind/status repair to `Other`/`Draft`; invalid URL repairs to `''`. Max 25 per opportunity. |
| Task | `id`, `title`, `notes`, `priority`, `dueDate`, `completed`, `completedOn` | Opportunity-owned child. Required nonblank title; optional notes/date; priority Low/Medium/High. Max 100; ID 128, title 160 and notes 1,000 characters. Completion requires a valid local date; open tasks must have an empty completion date. |

### 1.3 Controlled values and limits

- Opportunity types: `Internship`, `Full-time`, `Part-time`, `Freelance`.
- Opportunity statuses: `Saved`, `Applied`, `Interview`, `Offer`, `Rejected`.
- Priorities: `Low`, `Medium`, `High`.
- Interview modes: `Phone`, `Video`, `In person`, `Assessment`, `Other`.
- Interview statuses: `Scheduled`, `Completed`, `Cancelled`.
- Interview outcomes: `Positive`, `Negative`, `No decision`, or empty.
- Material kinds: `Resume`, `Cover Letter`, `Portfolio`, `Assessment`, `Other`.
- Material statuses: `Draft`, `Ready`, `Submitted`, `Superseded`.
- Activity types: `Application submitted`, `Recruiter contacted`, `Interview scheduled`, `Interview completed`, `Follow-up sent`, `Other`, plus system `Status changed`.
- Limits: 25 interviews, 25 contacts, 25 materials, 100 tasks, 10 tags, 24 characters per tag.
- Text limits: interview round 80, location 160, notes 2000, URL 2048, contact ID 120; contact name/role 120, email 254, phone 40, website 2048, notes 2000; material label 120, version 80, URL 2048, notes 2000; task ID 128, title 160, notes 1,000.
- Opportunity `title`, `company`, `compensation`, `description`, `notes`, `url` have **no explicit frontend maximum**. The database design must not silently truncate them.

### 1.4 Current persistence and transaction behavior

- `storage.ts` is authoritative for the localStorage key, normalization, duplicate repair, recovery payload preservation, write blocking and failure reporting.
- `OpportunityRepository` is currently a thin synchronous whole-collection boundary.
- `useOpportunities` loads synchronously and exposes `commitCandidate`: persist first, then update React state. A failed write leaves the collection and Undo unchanged.
- Ordinary and specialized operations build a complete candidate, write once, then update React state. Bulk operations are all-or-nothing.
- Archive/restore changes only `archivedAt`; status changes append one `Status changed` activity using the user's local date.
- Delete removes the opportunity. Undo is in memory for 10 seconds and re-inserts a deep snapshot at its original index.
- Bulk delete Undo restores each snapshot at its original collection index.
- JSON export uses `launchboard-backup` schema v2 and includes the complete task collection. Browser and API import accept v1 and v2; v1 records normalize to `tasks: []`. Import remains transactional and supports merge or replace.
- Local recovery preserves the exact unreadable raw localStorage string. That raw string is **not** necessarily valid backup JSON.

---

## 2. Implemented architecture

```
React SPA (Vite)
  ├─ useAuth / auth screens
  ├─ useOpportunities
  └─ OpportunityRepository
        ├─ LocalStorageOpportunityRepository (tests / local mode)
        └─ HttpOpportunityRepository (implemented; opt-in API mode)
                    │ HTTPS + session cookie
                    ▼
Express + TypeScript API
  ├─ auth / session / CSRF / rate limiting
  ├─ ownership-scoped repositories
  └─ transactional services
                    │ mysql2 prepared statements
                    ▼
MySQL / MariaDB database `launchboard`
```

- The SPA and API are separate deployable pieces, but production should serve both from one origin (reverse proxy or Express static hosting) to simplify cookies and CSRF.
- The backend reuses the same domain rules as the frontend. Those rules live in `packages/domain` (`@launchboard/domain`): domain types and controlled values, field/collection limits, strict calendar-date rules, tag and task normalization/validation, field predicates, the v2 backup envelope (v1/v2 import support) and shared versioned backup-record normalizer. Browser localStorage recovery remains frontend-only; ordinary server request validation remains strict.
- Saved Views remain browser-local under `launchboard.views.v1`. They are preferences, not opportunity data, and do not justify a server table in the first backend implementation.

---

## 3. Authentication and ownership

### 3.1 Implemented session model

Use **server-side sessions stored in MySQL**, delivered in an `HttpOnly` cookie. This is more appropriate than JWT for this project because logout and revocation are immediate, there is no need for third-party API clients, and session state is easy to reason about in a learning project.

| Concern | Decision |
|---|---|
| Registration | Email + password. Rate-limited; new accounts must verify email before they can authenticate. |
| Password storage | Argon2id (memory 19 MiB, iterations 2, parallelism 1, output length 32 bytes). No automatic bcrypt fallback. Never store or log plaintext. |
| Password rules | Minimum 15 characters, maximum 128 Unicode code points (UTF-8 byte cap 1,024). Do not impose composition rules, trim, or silently truncate. |
| Login | Generic `INVALID_CREDENTIALS` response; never reveal whether the email exists. |
| Session token | 32 random bytes, base64url. Store only its SHA-256 hash in the database. |
| Cookie | `launchboard_session` in local development and `__Host-launchboard_session` in production; `HttpOnly`, `Secure` in production, `SameSite=Lax`, `Path=/`, 7-day absolute expiry. |
| Logout | Revoke only the current session row and clear the cookie. |
| Session expiry | 30-minute idle timeout and 7-day absolute lifetime. Successful non-safe authenticated requests update `last_seen_at`; GET/HEAD/OPTIONS remain read-only. The absolute expiry never moves. |
| CSRF | Deterministic HMAC-derived synchronizer token bound to the pre-auth/authenticated session context; no CSRF token hash is stored. Return the raw token to the SPA and require `X-CSRF-Token` on state-changing requests. Also verify `Origin` against the configured exact-origin allowlist. No double-submit cookie. |
| Rate limits | Approved in Stage 5: pre-session 10/15 min/IP; register 3/hour/IP; login 5/15 min/IP and 10/15 min/normalized email. Counters use a process-local MemoryStore. Additional authenticated-mutation/import quotas are not part of the approved authentication policy and remain deferred. |
| Password reset / email verification | Implemented with purpose-bound, one-time hashed tokens and server-side Gmail SMTP delivery. |

#### Authentication endpoint behavior

- `POST /api/auth/logout`: require exact trusted Origin, JSON content type, an empty JSON object, a valid active authenticated-session cookie and authenticated-context `X-CSRF-Token`. Revoke only that session, clear its cookie and return `204` with `Cache-Control: no-store`. Do not clear the pre-auth cookie or revoke other sessions for the user. Invalid/missing/expired/idle/revoked sessions return 401; Origin/CSRF failures must not revoke anything.
- `GET /api/auth/me`: read-only lookup of the active session; return `200 { user, csrfToken }` with the authenticated-context deterministic HMAC token, or 401 when unauthenticated. Never touch `last_seen_at`, set cookies, or expose raw session tokens/hashes. Use `Cache-Control: no-store`.
- Safe methods GET/HEAD/OPTIONS must not mutate auth/session/CSRF state. `createRequireAuth` skips its idle-timeout touch for these methods; non-safe authenticated requests retain the activity touch behavior.

### 3.2 Ownership enforcement

Every private query is scoped by the authenticated user ID taken from the session, never from the request body or path.

- All opportunity reads: `WHERE user_id = ? AND deleted_at IS NULL`.
- All opportunity writes: lock the row with `WHERE public_id = ? AND user_id = ? AND deleted_at IS NULL FOR UPDATE`.
- Nested records are only reachable through an owned opportunity. Their queries join or filter on the parent's `user_id`.
- A record owned by another user returns **404**, not 403, so the API does not confirm that the ID exists.
- Bulk operations select all requested IDs with `user_id = ?`; if the number of locked rows differs from the request, the whole batch is rejected.
- Import/export are scoped to the authenticated user. A backup cannot contain another user's records because IDs are resolved per user.
- An unguessable UUID is **not** authorization. Ownership is always checked in SQL.

### 3.3 Development CORS and production configuration

Preferred development setup: configure Vite to proxy `/api` to `http://127.0.0.1:3000`. The browser then sees one origin, cookies and CSRF work normally, and CORS is unnecessary.

If the frontend calls the API directly on another localhost port, configure Express CORS with an exact allowlist:

```text
http://localhost:5173
http://127.0.0.1:5173
```

Use `credentials: true`, allow `Content-Type`, `X-CSRF-Token`, `If-Match` and `Idempotency-Key`, and never use `*` with credentials. Production should be same-origin; if not, set `APP_ORIGIN` to the exact frontend origin and keep `credentials: true`.

Environment variables (values live only in an ignored `.env`):

```text
NODE_ENV=development
PORT=3000
APP_ORIGIN=http://localhost:5173
DB_HOST=127.0.0.1
DB_PORT=3306
DB_NAME=launchboard
DB_USER=launchboard_app
DB_PASSWORD=...
DB_MIGRATION_USER=launchboard_migrator
DB_MIGRATION_PASSWORD=...
SESSION_COOKIE_NAME=launchboard_session
SESSION_TTL_DAYS=14
COOKIE_SECURE=false
```

Never commit `.env`. Use **two** dedicated accounts with privileges only on
`launchboard.*`; never the MySQL root account. The runtime account has only
`SELECT`, `INSERT`, `UPDATE` and `DELETE`. The migration account has `CREATE`,
`ALTER`, `INDEX`, `REFERENCES`, `SELECT` and `INSERT` for schema changes and
migration history. Neither account receives global privileges or access to
another database. Do not touch `healthbridge` or `nova_home`.

---

## 4. Relational schema

### 4.1 Conventions

- Database: `launchboard` only. InnoDB, `utf8mb4`, `utf8mb4_unicode_ci` for general text.
- Runtime and migration use separate accounts. The runtime account has `SELECT`, `INSERT`, `UPDATE` and `DELETE` on `launchboard.*`; the migration account has `CREATE`, `ALTER`, `INDEX`, `REFERENCES`, `SELECT` and `INSERT`. Neither account has global privileges or access to another database.
- IDs and enum values use binary/ASCII collations so casing is enforced.
- All application timestamps are `DATETIME(3)` stored in UTC. Connections set `time_zone = '+00:00'`; the API returns ISO 8601 with `Z`.
- Calendar dates use `DATE`; interview times use `TIME`; neither is converted to a timestamp.
- Use `BIGINT UNSIGNED` surrogate keys internally and keep the client's stable ID as `public_id`. Never expose internal numeric keys.
- Use `mysql2` prepared statements (`execute`) with placeholders. Never interpolate values into SQL.
- Use `READ COMMITTED` for API transactions and explicit `SELECT … FOR UPDATE` for version checks. Retry deadlocks (MySQL 1213) once with a short backoff.
- Every table is created by a versioned migration; `schema_migrations` records applied versions. No migration may target another database.
- Controlled values (status, priority, type, interview mode/status/outcome, material kind/status, activity type) are validated by **application allowlists derived from the shared domain constants**, and mirrored by `CHECK` constraints as defense in depth. The application is authoritative because it produces the user-facing error; the constraint protects against bugs and manual SQL. Adding a value requires updating the shared constant and writing a migration, which is intentional.
- MariaDB (XAMPP) enforces `CHECK` from 10.2 and MySQL from 8.0.16. Do not rely on `CHECK` for behavior that must work on an older server; the API validation is the real guarantee.

### 4.2 `users`

| Column | Type | Constraints |
|---|---|---|
| `id` | `CHAR(36)` | PK, UUID |
| `email` | `VARCHAR(254)` | NOT NULL, unique, normalized lowercase, `utf8mb4_unicode_ci`; sign-in identifier is read-only in Account Settings |
| `display_name` | `VARCHAR(80)` | NOT NULL DEFAULT `''`; user-editable optional profile name, added by migration 006 |
| `password_hash` | `VARCHAR(255)` | NOT NULL |
| `opportunity_revision` | `BIGINT UNSIGNED` | NOT NULL DEFAULT 0; increments on any opportunity change |
| `created_at` | `DATETIME(3)` | NOT NULL, UTC |
| `updated_at` | `DATETIME(3)` | NOT NULL, UTC |

Indexes: `UNIQUE (email)`. Delete behavior: deleting a user cascades to all owned data.

### 4.3 `sessions`

| Column | Type | Constraints |
|---|---|---|
| `id` | `CHAR(36)` | PK |
| `user_id` | `CHAR(36)` | NOT NULL, FK `users(id)` ON DELETE CASCADE |
| `token_hash` | `CHAR(64)` | NOT NULL, unique; hex SHA-256 of the cookie token |
| `created_at` | `DATETIME(3)` | NOT NULL, UTC |
| `last_seen_at` | `DATETIME(3)` | NOT NULL, UTC |
| `expires_at` | `DATETIME(3)` | NOT NULL, UTC |
| `revoked_at` | `DATETIME(3)` | NULL |

Indexes: `UNIQUE (token_hash)`, `(user_id)`, `(expires_at)`. Cleanup deletes expired/revoked sessions periodically.

### 4.4 `opportunities`

| Column | Type | Constraints |
|---|---|---|
| `id` | `BIGINT UNSIGNED` | PK, AUTO_INCREMENT |
| `user_id` | `CHAR(36)` | NOT NULL, FK `users(id)` ON DELETE CASCADE |
| `public_id` | `VARCHAR(128)` | NOT NULL, `utf8mb4_bin`; client/stable ID |
| `position` | `INT UNSIGNED` | NOT NULL; per-user collection order |
| `title` | `TEXT` | NOT NULL |
| `company` | `TEXT` | NOT NULL |
| `type` | `VARCHAR(16)` | NOT NULL, ASCII binary |
| `status` | `VARCHAR(16)` | NOT NULL, ASCII binary |
| `priority` | `VARCHAR(8)` | NOT NULL DEFAULT `'Medium'`, ASCII binary |
| `url` | `TEXT` | NOT NULL DEFAULT `''` |
| `deadline` | `DATE` | NULL |
| `follow_up_date` | `DATE` | NULL |
| `compensation` | `TEXT` | NOT NULL DEFAULT `''` |
| `description` | `MEDIUMTEXT` | NOT NULL |
| `notes` | `MEDIUMTEXT` | NOT NULL |
| `archived_at` | `DATETIME(3)` | NULL; UTC |
| `is_demo` | `TINYINT(1)` | NOT NULL DEFAULT 0 |
| `version` | `INT UNSIGNED` | NOT NULL DEFAULT 1 |
| `created_at` | `DATETIME(3)` | NOT NULL, UTC |
| `updated_at` | `DATETIME(3)` | NOT NULL, UTC |
| `deleted_at` | `DATETIME(3)` | NULL; soft delete |
| `deleted_batch_id` | `CHAR(36)` | NULL, FK `opportunity_deletions(id)` ON DELETE SET NULL |

Constraints and indexes:

- `UNIQUE (user_id, public_id)`.
- `INDEX (user_id, deleted_at, position, public_id)` for ordered collection reads.
- `INDEX (user_id, deleted_at, archived_at)` for active/archived views.
- `CHECK (type IN ('Internship','Full-time','Part-time','Freelance','Contract'))`.
- `CHECK (status IN ('Saved','Applied','Interview','Offer','Rejected'))`.
- `CHECK (priority IN ('Low','Medium','High'))`.
- `CHECK (version >= 1)`.
- `position` is not unique; ordering is `position, public_id` as a deterministic tie-breaker. New records append at `MAX(position)+1`; soft-deleted records keep their position so Undo restores the original order.

### 4.5 `opportunity_tags`

| Column | Type | Constraints |
|---|---|---|
| `opportunity_id` | `BIGINT UNSIGNED` | NOT NULL, FK `opportunities(id)` ON DELETE CASCADE |
| `tag` | `VARCHAR(24)` | NOT NULL; display capitalization |
| `tag_key` | `VARCHAR(24)` | NOT NULL, `utf8mb4_bin`; `tag.toLowerCase()` computed by the server |
| `position` | `TINYINT UNSIGNED` | NOT NULL, 0–9 |

Primary key `(opportunity_id, tag_key)`. `UNIQUE (opportunity_id, position)`. This preserves case-insensitive deduplication while keeping the first spelling. The app enforces max 10; the `position` check is defense in depth.

### 4.6 `contacts`

| Column | Type | Constraints |
|---|---|---|
| `id` | `BIGINT UNSIGNED` | PK, AUTO_INCREMENT |
| `opportunity_id` | `BIGINT UNSIGNED` | NOT NULL, FK `opportunities(id)` ON DELETE CASCADE |
| `public_id` | `VARCHAR(128)` | NOT NULL, `utf8mb4_bin` |
| `position` | `TINYINT UNSIGNED` | NOT NULL, 0–24 |
| `name` | `VARCHAR(120)` | NOT NULL |
| `role` | `VARCHAR(120)` | NOT NULL DEFAULT `''` |
| `email` | `VARCHAR(254)` | NOT NULL DEFAULT `''` |
| `phone` | `VARCHAR(40)` | NOT NULL DEFAULT `''` |
| `website` | `VARCHAR(2048)` | NOT NULL DEFAULT `''` |
| `notes` | `TEXT` | NOT NULL DEFAULT `''` |

`UNIQUE (opportunity_id, public_id)`, `UNIQUE (opportunity_id, position)`, `INDEX (opportunity_id)`.

### 4.7 `interviews`

| Column | Type | Constraints |
|---|---|---|
| `id` | `BIGINT UNSIGNED` | PK, AUTO_INCREMENT |
| `opportunity_id` | `BIGINT UNSIGNED` | NOT NULL, FK `opportunities(id)` ON DELETE CASCADE |
| `public_id` | `VARCHAR(128)` | NOT NULL, `utf8mb4_bin` |
| `position` | `TINYINT UNSIGNED` | NOT NULL, 0–24 |
| `round` | `VARCHAR(80)` | NOT NULL |
| `date` | `DATE` | NOT NULL |
| `time` | `TIME` | NULL; `''` maps to NULL |
| `mode` | `VARCHAR(16)` | NOT NULL, ASCII binary |
| `status` | `VARCHAR(16)` | NOT NULL, ASCII binary |
| `outcome` | `VARCHAR(16)` | NULL; `''` maps to NULL |
| `meeting_url` | `VARCHAR(2048)` | NOT NULL DEFAULT `''` |
| `location` | `VARCHAR(160)` | NOT NULL DEFAULT `''` |
| `preparation_notes` | `TEXT` | NOT NULL DEFAULT `''` |
| `notes` | `TEXT` | NOT NULL DEFAULT `''` |
| `contact_public_id` | `VARCHAR(128)` | NULL; `''` maps to NULL |

Constraints:

- `UNIQUE (opportunity_id, public_id)`, `UNIQUE (opportunity_id, position)`.
- `FOREIGN KEY (opportunity_id, contact_public_id) REFERENCES contacts (opportunity_id, public_id) ON DELETE RESTRICT`.
- `CHECK (mode IN ('Phone','Video','In person','Assessment','Other'))`.
- `CHECK (status IN ('Scheduled','Completed','Cancelled'))`.
- `CHECK (outcome IS NULL OR outcome IN ('Positive','Negative','No decision'))`.

The composite foreign key enforces that a contact belongs to the same opportunity. Because `ON DELETE SET NULL` on a composite key would also null `opportunity_id`, contact deletion is a deliberate two-step transaction: clear matching interview references, then delete the contact. If a caller forgets, the FK blocks the delete.

### 4.8 `materials`

| Column | Type | Constraints |
|---|---|---|
| `id` | `BIGINT UNSIGNED` | PK, AUTO_INCREMENT |
| `opportunity_id` | `BIGINT UNSIGNED` | NOT NULL, FK `opportunities(id)` ON DELETE CASCADE |
| `public_id` | `VARCHAR(128)` | NOT NULL, `utf8mb4_bin` |
| `position` | `TINYINT UNSIGNED` | NOT NULL, 0–24 |
| `label` | `VARCHAR(120)` | NOT NULL |
| `kind` | `VARCHAR(16)` | NOT NULL, ASCII binary |
| `url` | `VARCHAR(2048)` | NOT NULL DEFAULT `''` |
| `version` | `VARCHAR(80)` | NOT NULL DEFAULT `''` |
| `status` | `VARCHAR(16)` | NOT NULL, ASCII binary |
| `notes` | `TEXT` | NOT NULL DEFAULT `''` |

`UNIQUE (opportunity_id, public_id)`, `UNIQUE (opportunity_id, position)`, checks for kind/status.

### 4.9 `activities`

| Column | Type | Constraints |
|---|---|---|
| `id` | `BIGINT UNSIGNED` | PK, AUTO_INCREMENT |
| `opportunity_id` | `BIGINT UNSIGNED` | NOT NULL, FK `opportunities(id)` ON DELETE CASCADE |
| `public_id` | `VARCHAR(128)` | NOT NULL, `utf8mb4_bin` |
| `position` | `INT UNSIGNED` | NOT NULL; insertion order |
| `type` | `VARCHAR(32)` | NOT NULL, ASCII binary |
| `date` | `DATE` | NOT NULL |
| `note` | `TEXT` | NOT NULL DEFAULT `''` |

`UNIQUE (opportunity_id, public_id)`, `UNIQUE (opportunity_id, position)`, `INDEX (opportunity_id, date, position)`, check for the seven allowed activity types.

### 4.9.1 `tasks` (added by migration 004)

| Column | Type | Constraints |
|---|---|---|
| `id` | `BIGINT UNSIGNED` | PK, AUTO_INCREMENT |
| `opportunity_id` | `BIGINT UNSIGNED` | NOT NULL, FK `opportunities(id)` ON DELETE CASCADE |
| `public_id` | `VARCHAR(128)` | NOT NULL, `utf8mb4_bin`; unique within its opportunity |
| `position` | `TINYINT UNSIGNED` | NOT NULL; CHECK 0–99 |
| `title` | `VARCHAR(160)` | NOT NULL |
| `notes` | `TEXT` | NOT NULL; application supplies empty string when absent |
| `priority` | `VARCHAR(8)` | NOT NULL DEFAULT `'Medium'`, ASCII binary |
| `due_date` | `DATE` | NULL; local date-only value |
| `completed` | `TINYINT(1)` | NOT NULL DEFAULT 0 |
| `completed_on` | `DATE` | NULL; local date-only value |

Constraints: `UNIQUE (opportunity_id, public_id)`, `UNIQUE (opportunity_id, position)`, `INDEX (opportunity_id, completed, due_date, position)`, bounded position 0–99, priority enum and completion/date consistency CHECK. Tasks have no independent owner/revision; parent ownership and optimistic concurrency are inherited through the opportunity aggregate.

Migration 004 is additive, authored and structurally tested on the v1.2 feature branch. It is **not applied** to the local or production database; those schemas remain at migrations 001–003 until a separately approved migration step.

### 4.10 `opportunity_deletions` (Undo batches)

| Column | Type | Constraints |
|---|---|---|
| `id` | `CHAR(36)` | PK; undo batch token |
| `user_id` | `CHAR(36)` | NOT NULL, FK `users(id)` ON DELETE CASCADE |
| `created_at` | `DATETIME(3)` | NOT NULL, UTC |
| `expires_at` | `DATETIME(3)` | NOT NULL, UTC; 10 seconds after creation |
| `restored_at` | `DATETIME(3)` | NULL |

Indexes: `(user_id, expires_at)`. Opportunities reference the batch through `deleted_batch_id`.

Migration order: create `opportunity_deletions` before `opportunities` (or add the `deleted_batch_id` foreign key after both exist). This avoids a circular dependency at creation time.

Soft-deleted opportunities remain queryable only by restore/purge operations. A scheduled purge hard-deletes soft-deleted opportunities after 30 days, then deletes their empty batch rows. The 10-second `expires_at` controls Undo eligibility; the 30-day retention protects against accidental loss. Lists, exports, search and all normal reads filter `deleted_at IS NULL`.

### 4.11 `schema_migrations`

| Column | Type | Constraints |
|---|---|---|
| `version` | `VARCHAR(50)` | PK |
| `checksum` | `CHAR(64)` | NOT NULL, SHA-256 of the normalized migration file |
| `applied_at` | `DATETIME(3)` | NOT NULL, UTC |

The migration runner owns this table and creates it when absent. `checksum` is an implementation addition: it detects an edited migration file that was already applied. The runner refuses to continue when a recorded checksum no longer matches the file, and it refuses when an applied version has no matching file. Normalize CRLF to LF before hashing so a Windows and a Linux checkout agree.

### 4.12 Saved Views

No server table in v1. `launchboard.views.v1` remains local. A future cross-device preferences feature can add a `user_preferences` or `saved_views` table, but it is not required to move opportunity data.

---

## 5. IDs, dates, and audit metadata

### 5.1 IDs

- Keep the existing client ID as `public_id`. Do not replace it with a sequential database ID.
- Accept the current UUID format and legacy `op-…` fallback. Validate as a non-empty string of at most 128 characters; do not require UUID syntax, because existing backups may contain other stable IDs.
- Use `utf8mb4_bin` so IDs are case-sensitive and not normalized unexpectedly.
- New records created by the server use `crypto.randomUUID()`.
- Child IDs are unique within their opportunity, not globally. Database uniqueness is `(opportunity_id, public_id)`.
- Top-level IDs are unique per user, not globally. This lets two users import the same backup without collision.
- On a duplicate `(user_id, public_id)` create, return `409 DUPLICATE_ID`. Import merge skips existing IDs; import replace removes current records first, so its own IDs cannot collide.
- Do not expose internal `BIGINT` keys in API responses.

### 5.2 Dates, times, and timestamps

| Value | Storage | API | Rule |
|---|---|---|---|
| `deadline`, `followUpDate` | `DATE` NULL | `YYYY-MM-DD` or `''` | Local calendar dates. Never convert to a timestamp. |
| Activity `date` | `DATE` | `YYYY-MM-DD` | Local calendar date. |
| Interview `date` | `DATE` | `YYYY-MM-DD` | Local calendar date. |
| Interview `time` | `TIME` NULL | `HH:mm` or `''` | Local wall-clock time, no timezone. |
| `archivedAt` | `DATETIME(3)` NULL | ISO 8601 UTC with `Z` | Store the instant in UTC; return a canonical UTC string. |
| `createdAt`, `updatedAt` | `DATETIME(3)` | ISO 8601 UTC with `Z` | Server audit timestamps. |
| `expiresAt` (deletion batch) | `DATETIME(3)` | ISO 8601 UTC with `Z` | Server-managed. |

Use `mysql2` with `dateStrings: true` (and explicit TIME formatting) so the driver never turns a `DATE` into a JavaScript `Date` in the server's timezone. Calendar behavior therefore remains exactly date-only: a deadline is the same date in every timezone until the client formats it locally.

`archivedAt` from a version-1 backup may contain a non-UTC offset. Parse it as an instant, store UTC, and export `toISOString()` form. The instant is preserved; the textual offset may be canonicalized. If exact textual round-trip is ever required, that is a backup-format change, not a schema change.

### 5.3 Audit metadata and imported records

- `created_at` and `updated_at` are server-managed. `updated_at` changes on every successful aggregate mutation.
- `version` starts at 1 and increments on every successful mutation, including nested changes, archive/restore and soft delete.
- Do not fabricate historical `created_at`/`updated_at` for imported local records. Set both to the import time and `version = 1`.
- Preserve valid `archivedAt`, `isDemo` and all nested IDs from a version-1 backup.
- Preserve collection order by assigning `position` from the backup array order. Merge appends after the current maximum.
- Schema v1 does not contain server audit metadata. Schema v2 was introduced for the task collection, not to expose server audit fields; v1 remains importable.

---

## 6. Concurrency and transaction semantics

### 6.1 Per-opportunity optimistic concurrency

The HTTP repository must **not** expose a whole-collection replacement endpoint. Each opportunity is an aggregate with its own `version`.

- Reads return `version`.
- Updates require the client's expected version, sent as `If-Match: "<version>"` for single-record mutations or `expectedVersion` per item for bulk mutations.
- The server locks the row, compares versions, applies the change, and increments `version`.
- A stale version returns `409 STALE_VERSION` with the current version and, where safe, the current aggregate. The client must reload or explicitly retry; it must not silently overwrite.
- A missing `If-Match` on a mutation returns `428 PRECONDITION_REQUIRED`.
- No-op archive/restore calls do not increment `version`.

A per-user `opportunity_revision` increments on every opportunity mutation. It is returned by collection reads and is required for destructive replace-imports. It is not a substitute for per-record versions.

### 6.2 Aggregate updates

Interviews, contacts, materials, activities, tasks and tags are updated **as part of one opportunity aggregate transaction**. `PUT /api/opportunities/:id` replaces the aggregate's child collections in one transaction after a version check. Task IDs are unique within the parent; API ownership is resolved through the parent rather than a client-supplied owner ID.

Why this choice:

- The current frontend already constructs complete opportunity candidates for every mutation.
- Nested edits are small (max 25 records per legacy child collection and max 100 tasks) and rare.
- One aggregate transaction avoids partial nested writes and keeps contact/interview references consistent.
- Concurrent edits to the same opportunity produce a clear version conflict rather than silently merging or losing one side.

The cost is that two users (or tabs) editing different nested records of the same opportunity conflict. That is acceptable and safer than silent loss. A future stage could add child-level endpoints or field-level patches if the product needs them, but that is not justified now.

### 6.3 Status-history invariants

The server owns the automatic `Status changed` activity.

- On aggregate update, if `status` differs from the stored status, the server appends exactly one system activity:
  - type `Status changed`
  - date from the request's `statusActivityDate` (validated `YYYY-MM-DD`)
  - note `Status changed from <old> to <new>.`
  - server-generated public ID
- `statusActivityDate` is required when the status changes. It preserves the user's local calendar date; it is not an audit timestamp.
- The client must not send a new `Status changed` activity. Existing system activities in the aggregate must remain present and unchanged; removing or editing one is `422 SYSTEM_ACTIVITY_IMMUTABLE`.
- User activities may be added or removed through the aggregate, subject to the allowed types and valid dates.
- Bulk status changes append one activity per record that actually changes, using one shared `statusActivityDate`.

### 6.4 Locking and transaction rules

- Single aggregate update: `SELECT … FOR UPDATE` the owned opportunity, verify version, validate the entire aggregate, replace tags/children/tasks/activities, update parent, increment `version` and `opportunity_revision`, commit.
- Bulk operations: sort requested public IDs, lock all rows in that deterministic order, verify every row (ownership, version, not deleted, required state), apply all changes, increment every affected version and the collection revision, commit. Any failure rolls back the whole batch.
- Missing, wrong-owner or soft-deleted IDs are treated as `NOT_FOUND`. A batch with any such ID fails entirely.
- Wrong archive mode, wrong status, or stale version fails the entire batch with `409 BULK_CONFLICT` and a per-ID reason.
- Contact deletion inside an aggregate: validate that every remaining interview contact reference exists in the same opportunity. If the client removed a contact without clearing its references, reject `422 CONTACT_REFERENCE_INVALID`; do not silently repair on a normal write.
- Opportunity delete: create an `opportunity_deletions` batch, set `deleted_at` and `deleted_batch_id` on the parent in one transaction. Children remain until purge; all reads hide them with the parent.
- Hard delete (replace-import and 30-day purge): delete interviews first to satisfy the interview→contact `RESTRICT` foreign key, then tasks and remaining children, then the opportunity. The task table also has an `ON DELETE CASCADE` parent FK as a final integrity safeguard.
- Undo deletion: lock the batch and its opportunities, verify ownership, `restored_at IS NULL`, and `expires_at > now`, clear the deletion fields, increment versions, commit. Expired or already-restored batches return `410 DELETION_EXPIRED` / `409 ALREADY_RESTORED`.
- Import: validate the backup before the write transaction; then lock the user row, verify `expectedRevision` for replace, insert/skip/replace, increment `opportunity_revision`, commit. Dry-run performs validation and planning only.

### 6.5 Transaction boundary summary

| Operation | One transaction must contain |
|---|---|
| Create opportunity | Parent insert, tags, all nested rows including tasks, activities, revision increment |
| Update aggregate | Row lock, version check, child/task replacement, system-activity append, parent update, version/revision increment |
| Archive / restore | Row lock, version/state check, `archived_at` update, version/revision increment |
| Delete (soft) | Row lock, version check, deletion-batch insert, `deleted_at`/batch update, revision increment |
| Bulk archive/restore | All row locks and checks, all updates, all version increments, revision increment |
| Bulk status | All row locks/checks, all status updates, all appended activities, all version increments, revision increment |
| Bulk delete | All row locks/checks, one deletion batch, all soft deletes, revision increment |
| Undo archive/restore | All row locks, expected archive-state checks, all reversals, version/revision increments |
| Restore deletion | Batch and opportunity locks, expiry/ownership checks, all restores, version/revision increments |
| Import merge/replace | User lock, revision check for replace, all inserts/skips/replacement including task children, revision increment |
| Export | Consistent read snapshot; no writes |

---

## 7. API contract

### 7.1 Conventions

- Base path: `/api`.
- JSON only. `Content-Type: application/json`. The server uses one global `express.json({ limit: 6 * 1024 * 1024 })` transport limit: the 5 MiB backup limit plus 1 MiB for the import envelope and JSON string escaping. The import handler enforces the 5 MiB backup limit after parsing. A later stage may split the limit by route if normal endpoints need a smaller cap.
- Auth: session cookie on every private endpoint. Mutations also require `X-CSRF-Token`.
- Ownership: every private query scoped to the session user.
- Versioning: `If-Match: "<version>"` for single-record mutations; `expectedVersion` per item for bulk.
- Error shape:

```json
{
  "error": {
    "code": "STALE_VERSION",
    "message": "This opportunity changed since you loaded it.",
    "details": { "id": "…", "expectedVersion": 3, "currentVersion": 5 },
    "requestId": "…"
  }
}
```

- Every failure uses this envelope. `requestId` is assigned server-side; a client-supplied `X-Request-Id` is accepted only when it matches `/^[A-Za-z0-9._-]{1,64}$/`, and the value is echoed in the response header. `details` is optional.
- Never return SQL text, stack traces, credentials, connection details or another user's data.
- Success responses never include internal numeric keys.

### 7.2 Resource shape

```json
{
  "opportunity": {
    "id": "…",
    "title": "…",
    "company": "…",
    "type": "Internship",
    "status": "Applied",
    "priority": "Medium",
    "tags": ["Remote"],
    "url": "",
    "deadline": "2026-11-01",
    "followUpDate": "",
    "activities": [],
    "interviews": [],
    "contacts": [],
    "materials": [],
    "tasks": [],
    "compensation": "",
    "description": "",
    "notes": "",
    "archivedAt": "2026-10-27T10:00:00.000Z",
    "isDemo": true
  },
  "version": 3,
  "createdAt": "2026-10-27T10:00:00.000Z",
  "updatedAt": "2026-10-27T10:00:00.000Z"
}
```

`archivedAt` is omitted when active; `isDemo` is omitted when false. Empty optional strings remain `''` to match the frontend model. Normalized API Opportunity resources always include `tasks` (empty when none exist); server versions and audit timestamps are outside the object and JSON backup.

### 7.3 Authentication endpoints

| Method | Path | Auth | Request | Success | Notes |
|---|---|---|---|---|---|
| POST | /api/auth/register | pre-auth cookie + CSRF | {email, password} | 202 generic response; no session cookie | Creates an unverified account and sends a verification link. Existing/duplicate addresses receive the same response. |
| POST | /api/auth/verify-email | pre-auth cookie + CSRF | verification token | 200 | Consumes a one-time token; marks the email verified; does not sign in. |
| POST | /api/auth/resend-verification | pre-auth cookie + CSRF | email address | 202 generic response | Sends only to eligible unverified accounts; avoids account enumeration. |
| POST | /api/auth/password-reset/request | pre-auth cookie + CSRF | email address | 202 generic response | Sends only to eligible verified accounts; avoids account enumeration. |
| POST | /api/auth/password-reset/confirm | pre-auth cookie + CSRF | reset token and new password | 200 | Consumes the token, changes the password, and revokes all sessions; does not sign in. |
| POST | `/api/auth/login` | pre-auth cookie + CSRF | `{email, password}` | `200 {user, csrfToken}` + cookie | Implemented. Consumes pre-auth session only on success; generic `401 INVALID_CREDENTIALS` for missing account/wrong password; approved Argon2id hashes only; rate-limited; no-store. |
| POST | `/api/auth/logout` | yes | `{}` | `204` | Implemented. Revokes only the current session, clears its cookie; requires exact Origin and authenticated CSRF. |
| GET | `/api/auth/me` | authenticated session | — | `200 {user, csrfToken}` | Implemented; read-only active-session lookup, no-store, `401 UNAUTHORIZED` when absent/expired/idle/revoked. |
| GET | `/api/health` | no | — | `200 {status:"ok"}` | Liveness only. |
| GET | `/api/ready` | no | - | `200 {status:"ok",db:"ok"}` | Read-only. Returns `503 NOT_READY` when the database is unconfigured, unreachable, or not exactly `launchboard`. Never runs migrations. |

`user` is `{id, email}`. The CSRF token is returned in the response body; it is deterministically re-derived from the active session by `GET /api/auth/csrf` after a refresh. No CSRF cookie or database token-hash column is used.

### 7.4 Opportunity endpoints

| Method | Path | Auth/ownership | Request | Success | Transaction / version |
|---|---|---|---|---|---|
| GET | `/api/opportunities` | yes | optional `?archived=active\|archived\|all` (default `all`) | `200 {revision, items:[Resource]}` | Implemented in Stage 6. Read-only; excludes soft-deleted; ordered by `position, public_id`. |
| GET | `/api/opportunities/:id` | yes; owned | — | `200 Resource` | Implemented in Stage 6; read-only; other owner/deleted → `404`. |
| POST | `/api/opportunities` | yes | `{opportunity}` | `201 Resource` | Implemented in Stages 6–7. One transaction; server assigns append position and `version=1`; parent and nested collections persist atomically; revision increments. |
| PUT | `/api/opportunities/:id` | yes; owned | `If-Match`, `{opportunity, statusActivityDate?}` | `200 Resource` | Implemented in Stages 6–7. Row lock/version check, full nested aggregate replacement, server-owned system activity invariants, one transaction, version/revision increments. |
| DELETE | `/api/opportunities/:id` | yes; owned | `If-Match` (JSON content type; no body required) | `200 {deletionBatchId, expiresAt, deleted:[{id,version}]}` | Implemented in Stage 6. Soft delete + ten-second Undo batch; version/revision increment; children remain attached until later Undo/purge stages. |
| POST | `/api/opportunities/:id/archive` | yes; owned | `If-Match` (JSON content type; no body required) | `200 Resource` | Implemented in Stage 6. Sets `archivedAt` to server UTC time; version/revision increment only when state changes. |
| POST | `/api/opportunities/:id/restore` | yes; owned | `If-Match` (JSON content type; no body required) | `200 Resource` | Implemented in Stage 6. Clears `archivedAt`; version/revision increment only when state changes. |

**Write body rules:**

- `opportunity.id` must equal the path ID on `PUT`. On `POST` the client may supply an ID (preserving its current `createId()` behavior); if omitted the server generates a UUID. A supplied ID that already exists for the user is `409 DUPLICATE_ID`.
- `archivedAt` is server-managed. Do not accept it on create/update; archive/restore endpoints own it. Import accepts it.
- `isDemo` is preserved from storage; normal create/update may send false/omit it. Import preserves true.
- Stages 6–7 implement full nested aggregate create/read/update. Tags, contacts, interviews, materials and user activities are persisted and returned in stored order. Create/update replace child collections within the parent transaction. Interview contact references must resolve within the same opportunity; clients must clear/remove references when deleting a contact. System-owned `Status changed` activities must be echoed unchanged and in order; only the server creates them.
- `title`/`company` must be non-empty after trimming. `type`/`status`/`priority` must be exact allowlist values. Non-empty `url` must be HTTP(S). Dates must be real `YYYY-MM-DD` or `''`. Interview time must be `HH:mm` or `''`. Enforce all nested caps and field lengths.
- For normal writes, reject invalid values with `422 VALIDATION_ERROR`; do not silently repair. Import uses the existing repair/skip rules.

### 7.5 Bulk and Undo endpoints

All bulk endpoints are all-or-nothing and require the authenticated session, exact trusted Origin, JSON content type and authenticated-context CSRF. `items` is a non-empty array of `{id, expectedVersion}`. Duplicate IDs in a request return `422 DUPLICATE_REQUEST_ID`. Missing, wrong-owner, deleted, stale-version or wrong-state items return `409 BULK_CONFLICT` with per-item failure reasons; the batch changes nothing. Opportunity rows are locked sequentially in deterministic public-ID order. Each successful bulk mutation increments the per-user collection revision once and increments each changed opportunity's version once.

| Method | Path | Request | Success | Rules |
|---|---|---|---|---|
| POST | `/api/opportunities/bulk/archive` | `{items}` | `200 {revision, items:[Resource]}` | Implemented. All records must be active; one DB UTC timestamp; deterministic row-lock order; all-or-nothing transaction. |
| POST | `/api/opportunities/bulk/restore` | `{items}` | `200 {revision, items:[Resource]}` | Implemented. All records must be archived; deterministic locks; all-or-nothing transaction. |
| POST | `/api/opportunities/bulk/status` | `{items, status, statusActivityDate}` | `200 {revision, items:[Resource]}` | Implemented. Every item must differ from the target status; appends one server activity per item. |
| POST | `/api/opportunities/bulk/delete` | `{items, archiveView}` | `200 {deletionBatchId, expiresAt, deleted:[…]}` | Implemented. Every item must match `archiveView`; one ten-second deletion batch and one DB UTC deletion timestamp. |
| POST | `/api/opportunities/bulk/undo-archive` | `{items:[{id, expectedArchivedAt, previousArchivedAt}]}` | `200 {revision, items:[Resource]}` | Implemented. Changes only archive metadata if the current `archivedAt` still matches `expectedArchivedAt`; other fields are preserved. |
| POST | `/api/opportunities/deletions/:batchId/restore` | empty JSON object | `200 {revision, items:[Resource]}` | Implemented. Locks owned batch, rejects expired/already-restored batches, and restores all batch records atomically. |

`expectedArchivedAt`/`previousArchivedAt` are `null` for active and ISO UTC strings for archived. This preserves the current Undo policy: a later edit that did not change archive state does not block Undo, while a changed archive state does.

### 7.6 Import and export

| Method | Path | Request | Success |
|---|---|---|---|
| POST | `/api/opportunities/import` | `{mode:"merge"\|"replace", backup, dryRun?, confirmReplace?, expectedRevision?}` | `200 ImportResult` |
| GET | `/api/opportunities/export` | — | `200` schema-v2 backup envelope, `Content-Disposition: attachment` |

`backup` accepts schema v1 for existing files and schema v2 for task-aware files. New exports use schema v2:

```json
{
  "format": "launchboard-backup",
  "schemaVersion": 2,
  "exportedAt": "2026-10-27T10:00:00.000Z",
  "opportunities": []
}
```

Rules:

- Maximum 5 MiB and 20,000 records, matching the frontend.
- Validate the envelope before parsing records. Invalid JSON/envelope/schema → `422 INVALID_BACKUP` with a specific `details.reason`.
- Normalize each record with the shared `normalizeBackupOpportunityRecord` domain helper, passing the envelope version. V1 records normalize tasks to `[]`; v2 task children are repaired by shared task rules. Invalid records and duplicate IDs inside the backup are skipped and counted, not fatal. The browser v1/v2 file-import parser uses the same helper; browser localStorage recovery remains separate.
- `merge`: insert records whose `(user_id, public_id)` does not exist, including soft-deleted tombstones in the existence check; skip every existing ID so the unique key cannot be hit and a retry never overwrites data.
- `replace`: requires `confirmReplace: true` and `expectedRevision` equal to the current collection revision. It hard-deletes every opportunity row owned by the user, including soft-deleted tombstones, in one transaction. Dependent rows are deleted in FK-safe order (interviews before contacts; task rows with the other children), then old deletion-batch records are cleared and valid unique incoming records, including task children, are inserted. This also invalidates any pending deletion Undo batches. A stale revision returns `409 STALE_REVISION`.
- `dryRun: true` returns the same counts without writing and without changing `revision`.
- `ImportResult`:

```json
{
  "mode": "merge",
  "dryRun": false,
  "revision": 44,
  "totalRecords": 10,
  "validRecords": 9,
  "repairedRecords": 1,
  "invalidRecords": 1,
  "duplicateRecords": 0,
  "added": 5,
  "skippedExisting": 4,
  "replaced": 0,
  "finalCount": 15,
  "skipped": [{ "index": 3, "id": "…", "reason": "…" }]
}
```

- Export includes all non-deleted opportunities in collection order, including open, completed and unscheduled tasks. It excludes `version`, `createdAt`, `updatedAt`, `deletedAt` and other server metadata. `exportedAt` is server UTC. New exports use schema v2.
- Do not accept the browser recovery raw string as a backup. Only a valid `launchboard-backup` schema v1 or v2 envelope is accepted. A user may manually save a raw payload as a `.json` file and import it only if it is genuinely a valid envelope.

### 7.7 Error codes

| Code | HTTP | Meaning |
|---|---|---|
| `UNAUTHORIZED` | 401 | Missing/expired session. |
| `INVALID_CREDENTIALS` | 401 | Login failed; no email enumeration. |
| `FORBIDDEN` | 403 | CSRF/origin failure or an explicitly forbidden action. Cross-user resource access uses 404. |
| `NOT_FOUND` | 404 | Resource missing, soft-deleted, or not owned. |
| `INVALID_JSON` | 400 | The request body is not valid JSON. |
| `INVALID_REQUEST` | 400–499 | Another malformed transport request, such as an unsupported charset or unexpected mutation body. |
| `BAD_REQUEST` | 400 | Malformed query parameter or invalid `If-Match` value. |
| `PRECONDITION_REQUIRED` | 428 | A mutation arrived without `If-Match` or `expectedVersion`. |
| `VALIDATION_ERROR` | 422 | Invalid field/enum/date/URL/limit; `details.fields`. |
| `SYSTEM_ACTIVITY_IMMUTABLE` | 422 | A `Status changed` activity was added, edited or removed by the client. |
| `CONTACT_REFERENCE_INVALID` | 422 | An interview references a contact that is not in the same opportunity. |
| `STALE_VERSION` | 409 | `If-Match` does not match; `details.currentVersion`. |
| `STALE_REVISION` | 409 | Replace-import revision mismatch. |
| `BULK_CONFLICT` | 409 | At least one batch item is missing/stale/wrong-state; `details.failures`. |
| `DUPLICATE_ID` | 409 | Create/import ID already exists for this user. |
| `DUPLICATE_REQUEST_ID` | 422 | Duplicate IDs inside one request. |
| `INVALID_BACKUP` | 422 | Bad envelope/schema/JSON or unsupported backup; `details.reason` identifies `invalid-json`, `invalid-envelope`, `unsupported-schema` or `too-many-records`. Invalid individual records are skipped and counted in a valid import plan. |
| `PAYLOAD_TOO_LARGE` | 413 | Body or backup exceeds the limit. |
| `NOT_READY` | 503 | Database configuration is absent or the readiness check failed. No connection details are returned. |
| `RATE_LIMITED` | 429 | Rate limit exceeded; includes `Retry-After`. |
| `DELETION_EXPIRED` | 410 | Undo batch is past its 10-second eligibility. |
| `ALREADY_RESTORED` | 409 | Undo batch was already restored. |
| `INTERNAL_ERROR` | 500 | Unexpected server/database failure; request ID only. |

Frontend handling:

- No HTTP response / network failure: show a retryable network message; do not change local state.
- `401`: clear session state and show login.
- `409 STALE_VERSION` / `STALE_REVISION` / `BULK_CONFLICT`: explain that data changed elsewhere; offer reload or explicit retry. Never auto-merge.
- `422`: show field errors or the specific validation message.
- `404`: treat as removed/changed; refresh.
- `429`: show wait/retry guidance.
- `5xx`: generic retry message; never display internal details.

---

## 8. Backup migration and recovery

### 8.1 Versioned backups (v2 export; v1/v2 import)

New backups use `format: "launchboard-backup"`, `schemaVersion: 2`, `exportedAt` and `opportunities: Opportunity[]`. The importer remains backward-compatible with schema v1 and validates version-specific task behavior consistently with the frontend:

1. Reject input larger than 5 MiB (`413 PAYLOAD_TOO_LARGE`) before parsing.
2. Parse JSON; failure → `422 INVALID_BACKUP` with `details.reason = "invalid-json"`.
3. Require the exact format string, a numeric `schemaVersion`, and an `opportunities` array.
4. Accept only supported schema versions 1 and 2; any other version is `unsupported-schema`. Unknown versions are never guessed at.
5. Reject more than 20,000 records as `too-many-records`.
6. Run each record through the shared domain helper `normalizeBackupOpportunityRecord`, passing the envelope version. V1 records normalize tasks to `[]`; v2 task children use shared normalization and repair. Count repaired, invalid and duplicate records instead of failing the whole file. The browser file-import parser uses this helper; browser localStorage recovery remains separate.
7. Validate nested references after normalization: interview `contactId` must be `''` or an ID present in the same record's contacts. A dangling reference is repaired to `''` and counted as repaired, matching the current `repairInterviewContactReferences` behavior.

`exportedAt` is advisory. It is never trusted as an audit timestamp and is never used to set `created_at`.

### 8.2 Stable IDs and duplicates

- Incoming `id` values become `public_id` unchanged. Import never rewrites IDs.
- Top-level duplicates **inside the backup**: keep the first occurrence, skip later ones, count them as `duplicateRecords`, and report each skip with its zero-based array index.
- Top-level duplicates **against existing data** in `merge` mode: skip, count as `skippedExisting`, never overwrite.
- Child IDs are scoped to their opportunity. A child ID repeated within one opportunity is repaired by keeping the first and dropping later entries (counted as repaired). The same child ID in two different opportunities is valid.
- A record that normalizes to an empty `title` or `company`, or has an invalid `type`/`status`, is invalid and skipped, not silently invented.

### 8.3 Merge versus replace

| Mode | Authorization | Behavior |
|---|---|---|
| `merge` | Session only | Insert only IDs not already owned by the user, including IDs still reserved by soft-deleted tombstones. Never modify an existing opportunity. Append after the current maximum active `position`, preserving backup order. |
| `replace` | `confirmReplace: true` **and** `expectedRevision` equal to the current `opportunity_revision` | Delete every opportunity row owned by the user, including active, archived and soft-deleted rows, in FK-safe order. Clear old deletion-batch records and insert valid unique incoming records in the same transaction. |

`replace` is destructive. It is rejected with `409 STALE_REVISION` if the collection changed since the client read it, which forces the UI to re-confirm. It permanently purges soft-deleted tombstones and any pending deletion Undo batches as well as visible records. The `replaced` count reports visible (non-deleted) opportunities removed; hidden tombstones are also purged. The current frontend already requires explicit confirmation for replace; the server keeps that requirement and adds revision protection so a stale tab cannot wipe newer data.

Both modes are all-or-nothing. A database failure during `replace` rolls back to the previous collection. A failure during `merge` inserts nothing. Partial imports never leave a half-migrated account.

### 8.4 Client-side migration procedure

The client keeps its local data until the server confirms success:

1. Export or snapshot the local collection in memory.
2. Optionally download a schema-v2 backup file as a safety copy.
3. `POST /api/opportunities/import` with `dryRun: true` and show the counts (added / skipped / repaired / invalid).
4. On confirmation, call the real import. `merge` is the default for a first migration; `replace` is offered only when the user explicitly chooses it.
5. Persist the returned `revision` and reload the collection from `GET /api/opportunities`.
6. Only after a successful reload, mark local migration complete and stop treating localStorage as the source of truth. Do not delete the local data automatically; keep it until the user clears it.

Retry is safe because `merge` is idempotent with respect to IDs: a retried merge skips records that were already inserted. `replace` is also safe to retry, because the second attempt either sees the same `expectedRevision` (nothing else changed) or fails with `STALE_REVISION` and requires re-confirmation.

### 8.5 Server-side export

`GET /api/opportunities/export` returns schema v2 for all non-deleted opportunities in collection order. It includes every task state (open, completed and unscheduled) and excludes server metadata (`version`, `createdAt`, `updatedAt`, `deletedAt`, `deletionBatchId`). V1 imports remain supported. `archivedAt` is exported as a UTC ISO string; `isDemo` is included only when true.

### 8.6 Browser recovery payloads

`launchboard.recovery.raw.v1` is the exact unreadable localStorage string preserved for manual recovery. It is **not** a backup. The server must never accept arbitrary raw recovery text as a backup, and there is no "restore raw payload" endpoint. A user may only import it if they can produce a genuine valid `launchboard-backup` v1 or v2 envelope from it. This is an explicit non-goal.

`RecoveryViewState` and `repairedSaved` are browser-local presentation state. They have no server equivalent, are not exported, and are not part of the API contract. In server mode, a failed load is a normal request error, not a localStorage recovery scenario.

---

## 9. Repository evolution

### 9.1 Why the current contract cannot be copied

`OpportunityRepository` is synchronous and exposes `load()` plus `save(items)`, where `save` writes the complete collection. Copying that to HTTP would create a whole-collection replacement endpoint, which cannot express ownership-scoped concurrency and would let a stale tab overwrite newer server data.

### 9.2 Minimum async contract

```ts
interface OpportunityRepository {
  load(): Promise<OpportunityLoadResult>;
  create(input: OpportunityCreate): Promise<MutationResult<OpportunityResource>>;
  update(id: string, expectedVersion: number, input: OpportunityUpdate): Promise<MutationResult<OpportunityResource>>;
  archive(id: string, expectedVersion: number): Promise<MutationResult<OpportunityResource>>;
  restore(id: string, expectedVersion: number): Promise<MutationResult<OpportunityResource>>;
  remove(id: string, expectedVersion: number): Promise<MutationResult<DeletionBatch>>;
  bulkArchive(items: VersionedRef[]): Promise<MutationResult<OpportunityResource[]>>;
  bulkRestore(items: VersionedRef[]): Promise<MutationResult<OpportunityResource[]>>;
  bulkStatus(items: VersionedRef[], status: OpportunityStatus, date: string): Promise<MutationResult<OpportunityResource[]>>;
  bulkDelete(items: VersionedRef[], archiveView: 'active' | 'archived'): Promise<MutationResult<DeletionBatch>>;
  undoArchive(items: ArchiveUndoRef[]): Promise<MutationResult<OpportunityResource[]>>;
  restoreDeletion(batchId: string): Promise<MutationResult<OpportunityResource[]>>;
  importBackup(input: ImportRequest): Promise<MutationResult<ImportResult>>;
  exportBackup(): Promise<Blob>;
}
```

`MutationResult<T>` is a discriminated union: `{ ok: true; data: T; revision: number }` or `{ ok: false; error: RepositoryError }`, where `RepositoryError` carries `code`, `message`, `fields?`, `currentVersion?` and `retryable`. This maps cleanly onto the existing `MutationOutcome`-style success/failure handling instead of throwing for expected conflicts.

### 9.3 What changes in the frontend

- `useOpportunities` becomes async: it needs `loading`, `error`, `revision` and an authenticated session state, plus an explicit `reload()`.
- `commitCandidate(candidate)` cannot survive as the universal write path. Each user action must call the specific repository method and then apply the returned resource to state. The candidate-collection pattern stays only inside the local adapter.
- Version tracking moves into the client: each loaded resource carries `version`, and mutations send it back. A `STALE_VERSION` result must surface a reload/retry prompt rather than silently overwriting.
- Undo becomes server-backed for deletions (`deletionBatchId` + 10-second window). Archive/restore Undo remains a client-side intent expressed through `undoArchive`, because it only needs the previous/expected `archivedAt` pair.
- Authentication state is new: a `useAuth` hook plus login/register screens. Private routes render only when `/api/auth/me` succeeds.
- The localStorage recovery UI is retained only in local mode; it is not part of the server flow.

### 9.4 What stays reusable

Extracted into `@launchboard/domain` and shared unchanged: domain types and enums, field/collection limits, calendar-date and tag rules, task normalization/validation/classification, URL/time/email predicates, the v2 backup envelope with v1/v2 import support, and the version-aware backup-record normalizer. Browser localStorage recovery normalizers in `contacts.ts`, `interviews.ts`, `materials.ts`, `activities.ts`, `archive.ts` and `storage.ts` remain frontend-only. Filtering, calendar, global search, Saved Views and CSV formatting also remain frontend-only.

The local adapter remains useful: it keeps unit and component tests fast, supports an offline/local mode, and acts as a reference implementation for the async contract. It implements the same async interface and returns synthetic versions.

### 9.5 What must be removed

- The assumption that a write is synchronous and cannot fail for concurrency reasons.
- The assumption that the whole collection is one atomic unit. Only per-opportunity aggregates and explicit bulk endpoints are atomic now.
- Direct `localStorage` reads in components. Only the adapter may touch persistence.
- `createId()` for records the server will own (system activities); server-generated IDs must be accepted by the client.

---

## 10. Implementation stages

Each stage must leave the existing frontend fully working. No stage may point the production app at a half-built API.

| # | Stage | Deliverable | Acceptance criteria |
|---|---|---|---|
| 1 | Shared domain extraction | Move pure types, enums, limits, date/tag/field/task rules, v2 backup envelope and version-aware v1/v2 backup normalizer into `packages/domain`; keep browser localStorage recovery normalizers frontend-only | Frontend tests pass; package builds; no duplicated rule implementations |
| 2 | Backend foundation | `server/` package: Express app, TypeScript config, error middleware, request IDs, health/ready routes | `npm run build` and `npm run dev` work; `/api/health` returns 200; no database access yet |
| 3 | Config and database connectivity | Env validation, `mysql2` pool, `time_zone='+00:00'`, connection check on `/api/ready` | Missing/invalid env fails fast with a clear message; no secret in source |
| 4 | Schema and migrations | `launchboard` database, migration runner, all tables and constraints | Migrations run forward on a fresh database; no statement references `healthbridge` or `nova_home` |
| 5 | Authentication | Register, login, logout, me; Argon2id; hashed session tokens; HMAC-derived CSRF; rate limits | Complete: all four handlers implemented, focused mocked-repository tests pass, safe methods are read-only, and Stage 11I review is complete. Duplicate email and bad credentials return safe errors; logout revokes only the current session; `/me` is read-only |
| 6 | Opportunity core API | User-scoped collection/single reads, create/update, soft delete, archive/restore, server versions and `If-Match` | Complete: focused mocked-database tests pass; cross-user access returns 404; stale writes return 409 without modifying records |
| 7 | Nested workspaces and activities | Full interviews, contacts, materials, tags and user activities in the aggregate transaction; expand server-owned status history | Complete: focused mocked-database tests pass; child collections persist and load in order; contact references and immutable system activities are enforced; nested failures roll back the aggregate |
| 8 | Bulk operations and Undo | Bulk archive/restore/status/delete, deletion batches, batch restore | Any bad item rolls back the whole batch; expired Undo returns 410 |
| 9 | Import/export API | Versioned server validation (v1/v2 import; v2 export), merge, dry-run, revision-guarded atomic replace and documented local migration procedure | Focused mocked tests cover task round-trip, v1 compatibility, repair/skip counts, idempotent merge, destructive replace guards and rollback; no local data is changed |
| 10 | Frontend integration and deployment | HttpOpportunityRepository, authenticated API-mode shell, session UI, explicit browser migration and backup adapters | Implemented and deployed. The local adapter remains the default; release verification is recorded in docs/deployment-readiness.md. |

### 10.1 Remaining API and data-policy decisions

These are the remaining product/data-policy decisions; do not reopen authentication choices already approved and implemented:

1. Final API text-length caps for `title`, `company`, `compensation`, `description`, `notes`, and opportunity `url`. The current frontend has no explicit caps; the schema uses `TEXT`/`MEDIUMTEXT` to avoid silent truncation.
2. Soft-delete retention and purge job schedule (proposed: 30 days, daily purge).

Resolved authentication/product choices:
- Session lifetime: 30-minute idle timeout and 7-day absolute expiry; no remember-me option.
- Password hashing: Argon2id only with the parameters in §3.1; no bcrypt fallback.
- New accounts receive no demo records.
- `statusActivityDate` is client-supplied and validated to preserve the user's local calendar date.

Do not ask to re-confirm the resolved choices unless verified implementation evidence demonstrates a conflict.

### 10.2 Database foundation implemented in Stage 10C

Stages 3 and 4 are implemented at the foundation level only:

- `server/src/config/env.ts` parses the optional runtime `DB_*` block separately from the migration-only `DB_MIGRATION_USER` and `DB_MIGRATION_PASSWORD`. It rejects any `DB_NAME` other than `launchboard`; neither credential set falls back to the other.
- `server/src/db/pool.ts` owns one bounded `mysql2/promise` pool, sets `time_zone = '+00:00'` on every acquired connection, and verifies `SELECT DATABASE()` before reporting readiness.
- `GET /api/ready` performs that read-only check; it never migrates or writes. `GET /api/health` remains independent of the database.
- `server/database/create-database.sql` is a deliberate, one-time administrator action. It only creates `launchboard`.
- `npm run db:migrate` runs `server/database/migrations/*.sql` in filename order, records versions and checksums, skips verified migrations, and refuses checksum drift, a missing applied file, or any selected database other than `launchboard`.
- At the Stage 10C foundation checkpoint, the initial migration created the tables in §4; repository and authentication handler work followed in later stages. The current implementation status is tracked in `docs/implementation-roadmap.md`. Presence of these tables does not imply that all opportunity features or frontend API integration are available.

MySQL/MariaDB DDL implicitly commits, so a migration is not transactionally atomic. A failed migration is never recorded; recovery requires inspecting the partial schema and re-running after fixing the cause. The runner never drops or rebuilds tables automatically.

---

## 11. Security and operations checklist

### 11.1 Sessions and credentials

- Session cookie: `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` in production, no `Domain` attribute.
- Only the SHA-256 hash of the session token is stored. A database leak does not yield usable sessions.
- Rotate the session ID on login. Revoke the current session row on logout.
- Generic login errors; constant-time password comparison via the hashing library.
- Rate-limit registration per IP and login per IP plus normalized email account identifier; return the safe `RATE_LIMITED` envelope and `Retry-After` on `429`.

### 11.2 CSRF and CORS

- Require `X-CSRF-Token` matching the deterministic HMAC-derived token for the active pre-auth/authenticated session on every mutating request; compare in constant time. No readable CSRF cookie or server-stored CSRF hash.
- Verify `Origin` against the configured exact-origin allowlist for mutating requests. Reject missing/null Origin; do not infer the trusted origin from Host headers.
- CORS: exact allowlist only, `credentials: true`, never `*`. Prefer the Vite proxy so development is same-origin.
- Reject unknown content types; do not accept form-encoded mutations.

### 11.3 Input and output safety

- Validate every field server-side regardless of client validation. Never trust `user_id`, `version` or IDs from the body for authorization.
- Prepared statements only; no string-concatenated SQL.
- Parameterized `LIMIT`/`OFFSET` if pagination is added; never interpolate sort columns.
- Never return SQL errors, stack traces, hashes, tokens or connection strings. Log unexpected server failures in sanitized form with a request ID; do not serialize raw driver errors, SQL parameters, request bodies, cookies, tokens, password values or hashes.
- Set conservative body limits. The server foundation uses a single 6 MiB JSON transport limit (5 MiB backup + 1 MiB envelope/escaping) and caps shared array lengths. A later stage may apply a smaller limit to non-import routes; the import handler must still enforce the 5 MiB backup limit after parsing.
- Escape nothing in JSON responses; the client renders text, and CSV formula neutralization remains a client export concern.

### 11.4 Database and operations

- Dedicated database `launchboard`; two dedicated accounts with privileges on `launchboard.*` only. The runtime account is limited to data access; the migration account owns schema changes and migration tracking. Never root, never `healthbridge`, never `nova_home`.
- Deleting an opportunity must delete its interviews first, then the opportunity, because `interviews → contacts` is `ON DELETE RESTRICT` while both cascade from the opportunity. A single opportunity delete fails when an interview references a contact (verified live on MariaDB 10.4.32).
- `.env` is git-ignored; `.env.example` documents names with placeholder values.
- Backups of the `launchboard` database are the operator's responsibility; the JSON export is a user-facing feature, not a database backup.
- Migrations are forward-only and recorded in `schema_migrations`. No destructive migration runs automatically in production.
- Health endpoints expose no schema or version detail publicly.
- Log authentication failures (401/403), rate-limit hits (429), conflicts (409/412/428) and 5xx failures with request IDs. Log only safe error codes and request IDs; never log passwords, tokens, cookies, raw SQL parameters, request bodies or raw driver-error objects.

### 11.5 Known limitations to state honestly

- Email verification and password recovery are implemented. Delivery requires the server-only SMTP settings documented in docs/auth-design.md.
- No multi-device conflict merging; conflicts require reload.
- No server-side Saved Views.
- No audit log beyond per-opportunity activities and timestamps.
- Security review and penetration testing have **not** been performed; this document is a design, not a certification.

---

## 12. Unresolved decisions

| Decision | Why it matters | Proposed default |
|---|---|---|
| Opportunity text caps | Prevents unbounded rows and UI breakage; affects validation parity | 200 for title/company, 200 for compensation, 20,000 for description/notes, 2,048 for URL |
| Purge retention | Balances accidental-loss recovery against storage growth | 30 days, daily job |
| Pagination for large collections | Current UI assumes a full collection in memory | No pagination in v1; revisit above ~5,000 records |
| Saved Views server sync | Cross-device convenience versus scope | Local only |

Resolved in Stage 10A: the shared-code layout is the npm workspace package `packages/domain` (`@launchboard/domain`), ESM compiled with NodeNext to `dist`, consumed by the frontend through re-export wrappers. See `packages/domain/README.md`. The package contains contracts and pure rules only; it does not implement persistence or backend services.

Current status: opportunity text caps listed above remain a product-policy decision; the JSON request-size limit is the transport guard. Both /api/health (liveness) and /api/ready (read-only database readiness) are implemented. Readiness never runs migrations.

---

## 13. Final recommendation

The backend foundation, authentication handlers and Stage 6–9 opportunity APIs are implemented. Stage 10 frontend/API integration and the explicit browser migration flow are also implemented and have passed their recorded automated release checks. The localStorage mode remains the default; `VITE_DATA_MODE=api` opts into the authenticated server workspace. Do not restart completed implementation stages unless a reproducible defect requires it.

The application is deployed on Vercel with TiDB Cloud Serverless. Use docs/deployment-readiness.md for the current source-based deployment configuration and release checks. Do not follow historical Aiven setup notes from earlier project iterations.

Keep the localStorage mode and recovery data intact. Preserve backup compatibility, transaction boundaries, ownership scoping, optimistic concurrency, and least-privilege database access. A mocked-database test does not prove that a cloud database is ready; follow the explicit live-verification procedure before changing production schema.




---

## 14. Email verification and password recovery

This section records the current implemented account-action behavior and supersedes the earlier Stage 11 policy that deferred verification and recovery.

### Account-action token storage

Migration `003_email_verification_password_reset.sql` adds:
- `users.email_verified_at DATETIME(3) NULL`.
- `auth_action_tokens`: UUID id, user FK with cascade, purpose (`verify_email` or `reset_password`), unique SHA-256 token hash, creation/expiry timestamps and nullable consumed/revoked timestamps. Indexes support user+purpose and expiry lookups.

Raw action tokens are 32 random bytes encoded as base64url. They are returned only to the mail adapter/caller and never stored. Verification links expire in 24 hours; password-reset links expire in one hour. Token lookups lock rows inside the consuming transaction, and conditional updates prevent concurrent double-use.

### Environment and email delivery

The server accepts an all-or-none optional configuration block:
- `SMTP_USER`: dedicated Gmail/Google Mail address used for sending.
- `SMTP_PASS`: 16-character Google app password (server-side secret only; spaces in Google's grouped display are normalized).
- `APP_BASE_URL`: exact canonical app origin; HTTPS in production (development may use canonical HTTP localhost).

Nodemailer delivers through `smtp.gmail.com` on port `465` with implicit TLS. The send operation is awaited before returning the API response; SMTP credentials and provider errors are never logged or returned. No mail credential may be placed in any `VITE_*` variable. Standard Gmail sending limits make this a low-volume starting point rather than a high-volume production mail service. Links are built from `APP_BASE_URL`, never from a request Host or forwarded-host header. One-time tokens are put in URL fragments so they are not sent in the initial HTTP request; the UI immediately strips them from browser history after capturing them.

### API contract

All account-action POST routes are `Cache-Control: no-store` and require the established exact-Origin, JSON, pre-authentication cookie and `X-CSRF-Token` protections.

| Method and path | Behavior |
|---|---|
| `POST /api/auth/register` | Create an unverified account and 24-hour verification token transactionally. Return generic 202; no authenticated session is issued. |
| `POST /api/auth/verify-email` | Consume a valid one-time verification token and mark the account verified. Return 200; no automatic login. |
| `POST /api/auth/resend-verification` | Send a new link only to an unverified account. Return the same generic 202 for all account states. |
| `POST /api/auth/password-reset/request` | Send a one-hour reset link only to a verified account. Return the same generic 202 for known and unknown addresses. |
| `POST /api/auth/password-reset/confirm` | Consume a valid reset token, update the Argon2id password, revoke all sessions and invalidate other reset tokens in one transaction. Return 200; no automatic login. |

Unknown and known email addresses do not produce different resend/reset-request response bodies. Mail delivery failure is reduced to a safe generic outcome; the user can retry a verification email. Login rejects unverified accounts with the same `401 INVALID_CREDENTIALS` response as wrong credentials. Session lookup also filters out unverified users, invalidating pre-migration sessions for those accounts.

### Rate limits

Verification resend has 3 requests per 15 minutes per IP plus a 6-per-hour HMAC-email quota. Password-reset requests have 5 per 15 minutes per IP plus the same HMAC-email quota. Reset confirmation has 5 per 15 minutes per IP. Verification consumption also has the resend IP throttle. Counters use the existing process-local limiter store and are not shared across instances.

### Rollout implications and status

The migration is additive but existing users are unverified by default. After a production migration, existing users must request a verification link before sign-in; their pre-existing sessions will no longer authorize requests. Communicate this before rollout.

As of 2026-11-04, the active Vercel production deployment is `dpl_Fed9L1WuwYxQ1asTkCC5DFNLiN3K` (READY), and the production application uses TiDB Cloud Serverless. The production schema and migrations, including migration 003, are recorded as applied and verified; the owner has also reported manually testing the authentication flows. These operational checks do not independently prove successful outbound Gmail SMTP delivery. Record a real verification-email and password-reset-email round trip in the deployment log if that has not already been confirmed. Do not rerun migration 003 or change production database settings as part of routine work.
