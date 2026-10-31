# Launchboard Backend Contract

**Status: design only.** No backend directory, server code, SQL migration, dependency, or database change exists yet. This document is the implementation guide for the future Node.js + Express + TypeScript + MySQL/MariaDB backend.

The current application remains localStorage-only. `launchboard.opportunities.v1`, `launchboard.recovery.raw.v1`, `launchboard.views.v1`, the version-1 backup envelope, and all current user-visible behavior are unchanged by this document.

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

### 1.2 Nested records

| Record | Fields | Rules |
|---|---|---|
| Activity | `id`, `type`, `date` (`YYYY-MM-DD`), `note` | Required ID, known type and valid date; malformed entries are dropped. `Status changed` is system-owned. |
| Interview | `id`, `round`, `date`, `time` (`HH:mm` or `''`), `mode`, `status`, `outcome` (`''` or value), `meetingUrl`, `location`, `preparationNotes`, `notes`, `contactId` | `round` and real date required. Unknown mode/status/outcome repair to `Other`/`Scheduled`/`''`. `contactId` must be a contact in the same opportunity, or `''`. Max 25 per opportunity. |
| Contact | `id`, `name`, `role`, `email`, `phone`, `website`, `notes` | `name` required. Invalid optional email/website repair to `''`. Max 25 per opportunity. |
| Material | `id`, `label`, `kind`, `url`, `version`, `status`, `notes` | `label` required. Unknown kind/status repair to `Other`/`Draft`; invalid URL repairs to `''`. Max 25 per opportunity. |

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
- Limits: 25 interviews, 25 contacts, 25 materials, 10 tags, 24 characters per tag.
- Text limits: interview round 80, location 160, notes 2000, URL 2048, contact ID 120; contact name/role 120, email 254, phone 40, website 2048, notes 2000; material label 120, version 80, URL 2048, notes 2000.
- Opportunity `title`, `company`, `compensation`, `description`, `notes`, `url` have **no explicit frontend maximum**. The database design must not silently truncate them.

### 1.4 Current persistence and transaction behavior

- `storage.ts` is authoritative for the localStorage key, normalization, duplicate repair, recovery payload preservation, write blocking and failure reporting.
- `OpportunityRepository` is currently a thin synchronous whole-collection boundary.
- `useOpportunities` loads synchronously and exposes `commitCandidate`: persist first, then update React state. A failed write leaves the collection and Undo unchanged.
- Ordinary and specialized operations build a complete candidate, write once, then update React state. Bulk operations are all-or-nothing.
- Archive/restore changes only `archivedAt`; status changes append one `Status changed` activity using the user's local date.
- Delete removes the opportunity. Undo is in memory for 10 seconds and re-inserts a deep snapshot at its original index.
- Bulk delete Undo restores each snapshot at its original collection index.
- JSON import is versioned (`launchboard-backup`, schema version 1), transactional, and supports merge or replace. Merge skips incoming IDs that already exist; replace uses only valid unique incoming records.
- Local recovery preserves the exact unreadable raw localStorage string. That raw string is **not** necessarily valid backup JSON.

---

## 2. Target architecture

```
React SPA (Vite)
  ├─ useAuth / auth screens
  ├─ useOpportunities
  └─ OpportunityRepository
        ├─ LocalStorageOpportunityRepository (tests / local mode)
        └─ HttpOpportunityRepository (future)
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
- The backend must reuse the same domain rules as the frontend. Those rules now live in the npm workspace package `packages/domain` (`@launchboard/domain`): domain types and controlled values, field/collection limits, strict calendar-date rules, tag normalization, field predicates and the version-1 backup envelope. The frontend consumes it through re-export wrappers; the backend must import the same public entry point. Do not maintain a second copy. Permissive storage normalizers intentionally remain frontend-only; server request validation is separate and strict.
- Saved Views remain browser-local under `launchboard.views.v1`. They are preferences, not opportunity data, and do not justify a server table in the first backend implementation.

---

## 3. Authentication and ownership

### 3.1 Recommended model

Use **server-side sessions stored in MySQL**, delivered in an `HttpOnly` cookie. This is more appropriate than JWT for this project because logout and revocation are immediate, there is no need for third-party API clients, and session state is easy to reason about in a learning project.

| Concern | Decision |
|---|---|
| Registration | Email + password. Open registration, rate-limited. No email verification in v1. |
| Password storage | Argon2id preferred (memory 19 MiB, iterations 2, parallelism 1). If native Argon2 installation is a problem on Windows, bcrypt with cost 12 is an acceptable fallback. Never store or log plaintext. |
| Password rules | Minimum 12 characters, maximum 128. Do not impose composition rules. Reject passwords equal to the email. |
| Login | Generic `INVALID_CREDENTIALS` response; never reveal whether the email exists. |
| Session token | 32 random bytes, base64url. Store only its SHA-256 hash in the database. |
| Cookie | `launchboard_session`, `HttpOnly`, `Secure` in production, `SameSite=Lax`, `Path=/`, 14-day expiry. |
| Logout | Delete the session row and clear the cookie. |
| Session expiry | 14 days absolute. `last_seen_at` is updated at most hourly for audit; it does not extend the session. |
| CSRF | Double-submit token: readable `launchboard_csrf` cookie plus `X-CSRF-Token` header required on every `POST`/`PUT`/`PATCH`/`DELETE`. Also verify `Origin` against the configured app origin. |
| Rate limits | Register 5/hour/IP; login 10/15 min/IP and 5/15 min/email; authenticated mutations 100/min/user; import 5/hour/user. Return `429` with `Retry-After`. |
| Password reset / email verification | Out of scope for v1. Document that a forgotten password requires an administrative reset. |

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
| `email` | `VARCHAR(254)` | NOT NULL, unique, normalized lowercase, `utf8mb4_unicode_ci` |
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
- `CHECK (type IN ('Internship','Full-time','Part-time','Freelance'))`.
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
- The version-1 backup does not contain audit metadata, so no schema-version bump is needed. A future backup v2 could add it, but v1 must remain importable.

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

Interviews, contacts, materials, activities and tags are updated **as part of one opportunity aggregate transaction**. `PUT /api/opportunities/:id` replaces the aggregate's child collections in one transaction after a version check.

Why this choice:

- The current frontend already constructs complete opportunity candidates for every mutation.
- Nested edits are small (max 25 records per collection) and rare.
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

- Single aggregate update: `SELECT … FOR UPDATE` the owned opportunity, verify version, validate the entire aggregate, replace tags/children/activities, update parent, increment `version` and `opportunity_revision`, commit.
- Bulk operations: sort requested public IDs, lock all rows in that deterministic order, verify every row (ownership, version, not deleted, required state), apply all changes, increment every affected version and the collection revision, commit. Any failure rolls back the whole batch.
- Missing, wrong-owner or soft-deleted IDs are treated as `NOT_FOUND`. A batch with any such ID fails entirely.
- Wrong archive mode, wrong status, or stale version fails the entire batch with `409 BULK_CONFLICT` and a per-ID reason.
- Contact deletion inside an aggregate: validate that every remaining interview contact reference exists in the same opportunity. If the client removed a contact without clearing its references, reject `422 CONTACT_REFERENCE_INVALID`; do not silently repair on a normal write.
- Opportunity delete: create an `opportunity_deletions` batch, set `deleted_at` and `deleted_batch_id` on the parent in one transaction. Children remain until purge; all reads hide them with the parent.
- Hard delete (replace-import and 30-day purge): delete children explicitly in dependency order — activities, interviews, materials, contacts, tags — then the opportunity. Do not rely on cascade ordering while the interview→contact `RESTRICT` foreign key exists.
- Undo deletion: lock the batch and its opportunities, verify ownership, `restored_at IS NULL`, and `expires_at > now`, clear the deletion fields, increment versions, commit. Expired or already-restored batches return `410 DELETION_EXPIRED` / `409 ALREADY_RESTORED`.
- Import: validate the backup before the write transaction; then lock the user row, verify `expectedRevision` for replace, insert/skip/replace, increment `opportunity_revision`, commit. Dry-run performs validation and planning only.

### 6.5 Transaction boundary summary

| Operation | One transaction must contain |
|---|---|
| Create opportunity | Parent insert, tags, all nested rows, activities, revision increment |
| Update aggregate | Row lock, version check, child replacement, system-activity append, parent update, version/revision increment |
| Archive / restore | Row lock, version/state check, `archived_at` update, version/revision increment |
| Delete (soft) | Row lock, version check, deletion-batch insert, `deleted_at`/batch update, revision increment |
| Bulk archive/restore | All row locks and checks, all updates, all version increments, revision increment |
| Bulk status | All row locks/checks, all status updates, all appended activities, all version increments, revision increment |
| Bulk delete | All row locks/checks, one deletion batch, all soft deletes, revision increment |
| Undo archive/restore | All row locks, expected archive-state checks, all reversals, version/revision increments |
| Restore deletion | Batch and opportunity locks, expiry/ownership checks, all restores, version/revision increments |
| Import merge/replace | User lock, revision check for replace, all inserts/skips/replacement, revision increment |
| Export | Consistent read snapshot; no writes |

---

## 7. API contract

### 7.1 Conventions

- Base path: `/api`.
- JSON only. `Content-Type: application/json`. The server foundation uses one global `express.json({ limit: 6 * 1024 * 1024 })` transport limit: the 5 MiB version-1 backup limit plus 1 MiB for the import envelope and JSON string escaping. The future import handler must still enforce the 5 MiB backup limit after parsing. A later stage may split the limit by route if normal endpoints need a smaller cap.
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

`archivedAt` is omitted when active; `isDemo` is omitted when false. Empty optional strings remain `''` to match the frontend model. `version` and audit timestamps are outside the `Opportunity` object so the version-1 backup format stays unchanged.

### 7.3 Authentication endpoints

| Method | Path | Auth | Request | Success | Notes |
|---|---|---|---|---|---|
| POST | `/api/auth/register` | no | `{email, password}` | `201 {user, csrfToken}` + session cookie | Rate-limited; duplicate email `409 EMAIL_IN_USE`; validation `422`. |
| POST | `/api/auth/login` | no | `{email, password}` | `200 {user, csrfToken}` + cookie | Generic `401 INVALID_CREDENTIALS`; rate-limited. |
| POST | `/api/auth/logout` | yes | — | `204` | Deletes session, clears cookie; requires CSRF. |
| GET | `/api/auth/me` | yes | — | `200 {user, csrfToken}` | `401 UNAUTHENTICATED` when absent/expired. |
| GET | `/api/health` | no | — | `200 {status:"ok"}` | Liveness only. |
| GET | `/api/ready` | no | - | `200 {status:"ok",db:"ok"}` | Read-only. Returns `503 NOT_READY` when the database is unconfigured, unreachable, or not exactly `launchboard`. Never runs migrations. |

`user` is `{id, email}`. The CSRF token is also set as a readable cookie; the body copy lets the SPA initialize without a second request.

### 7.4 Opportunity endpoints

| Method | Path | Auth/ownership | Request | Success | Transaction / version |
|---|---|---|---|---|---|
| GET | `/api/opportunities` | yes | optional `?archived=active\|archived\|all` (default `all`) | `200 {revision, items:[Resource]}` | Read-only; excludes soft-deleted; ordered by `position, public_id`. |
| GET | `/api/opportunities/:id` | yes; owned | — | `200 Resource` | Read-only; other owner/deleted → `404`. |
| POST | `/api/opportunities` | yes | `{opportunity}` | `201 Resource` | One transaction; new `version=1`; revision increments. |
| PUT | `/api/opportunities/:id` | yes; owned | `If-Match`, `{opportunity, statusActivityDate?}` | `200 Resource` | One aggregate transaction; `version` increments; revision increments. |
| DELETE | `/api/opportunities/:id` | yes; owned | `If-Match` | `200 {deletionBatchId, expiresAt, deleted:[{id,version}]}` | Soft delete + batch; revision increments. |
| POST | `/api/opportunities/:id/archive` | yes; owned | `If-Match` | `200 Resource` | Sets `archivedAt` to server UTC time; version/revision increment. |
| POST | `/api/opportunities/:id/restore` | yes; owned | `If-Match` | `200 Resource` | Clears `archivedAt`; version/revision increment. |

**Write body rules:**

- `opportunity.id` must equal the path ID on `PUT`. On `POST` the client may supply an ID (preserving its current `createId()` behavior); if omitted the server generates a UUID. A supplied ID that already exists for the user is `409 DUPLICATE_ID`.
- `archivedAt` is server-managed. Do not accept it on create/update; archive/restore endpoints own it. Import accepts it.
- `isDemo` is preserved from storage; normal create/update may send false/omit it. Import preserves true.
- `tags`, `interviews`, `contacts`, `materials`, `activities` are replaced wholesale on `PUT`, after validation and system-activity invariants.
- `title`/`company` must be non-empty after trimming. `type`/`status`/`priority` must be exact allowlist values. Non-empty `url` must be HTTP(S). Dates must be real `YYYY-MM-DD` or `''`. Interview time must be `HH:mm` or `''`. Enforce all nested caps and field lengths.
- For normal writes, reject invalid values with `422 VALIDATION_ERROR`; do not silently repair. Import uses the existing repair/skip rules.

### 7.5 Bulk and Undo endpoints

All bulk endpoints are all-or-nothing. `items` is a non-empty array of `{id, expectedVersion}`. Duplicate IDs in a request are `422 DUPLICATE_REQUEST_ID`. A missing/wrong-owner/deleted ID is `404`/`409 BULK_CONFLICT` and the batch changes nothing.

| Method | Path | Request | Success | Rules |
|---|---|---|---|---|
| POST | `/api/opportunities/bulk/archive` | `{items}` | `200 {revision, items:[Resource]}` | Every item must be active; any already-archived item fails the batch with `409 BULK_CONFLICT`. One timestamp for the batch. |
| POST | `/api/opportunities/bulk/restore` | `{items}` | `200 {revision, items:[Resource]}` | Every item must be archived; any active item fails the batch. |
| POST | `/api/opportunities/bulk/status` | `{items, status, statusActivityDate}` | `200 {revision, items:[Resource]}` | Every item must currently differ from `status`; one status activity per changed record. |
| POST | `/api/opportunities/bulk/delete` | `{items, archiveView}` | `200 {deletionBatchId, expiresAt, deleted:[…]}` | Every item must match `archiveView`; one soft-delete batch. |
| POST | `/api/opportunities/bulk/undo-archive` | `{items:[{id, expectedArchivedAt, previousArchivedAt}]}` | `200 {revision, items:[Resource]}` | Reverses only archive metadata if the current `archivedAt` still matches `expectedArchivedAt`; other fields are preserved. |
| POST | `/api/opportunities/deletions/:batchId/restore` | — | `200 {revision, items:[Resource]}` | Restores a soft-delete batch if owned, unexpired and not already restored. |

`expectedArchivedAt`/`previousArchivedAt` are `null` for active and ISO UTC strings for archived. This preserves the current Undo policy: a later edit that did not change archive state does not block Undo, while a changed archive state does.

### 7.6 Import and export

| Method | Path | Request | Success |
|---|---|---|---|
| POST | `/api/opportunities/import` | `{mode:"merge"\|"replace", backup, dryRun?, confirmReplace?, expectedRevision?}` | `200 ImportResult` |
| GET | `/api/opportunities/export` | — | `200` version-1 backup envelope, `Content-Disposition: attachment` |

`backup` must be the existing version-1 envelope:

```json
{
  "format": "launchboard-backup",
  "schemaVersion": 1,
  "exportedAt": "2026-10-27T10:00:00.000Z",
  "opportunities": []
}
```

Rules:

- Maximum 5 MiB and 20,000 records, matching the frontend.
- Validate the envelope before parsing records. Invalid JSON/envelope/schema → `422 INVALID_BACKUP` with a specific `details.reason`.
- Normalize each record with the shared canonical normalizer. Invalid records and duplicate IDs inside the backup are skipped and counted, not fatal.
- `merge`: insert records whose `(user_id, public_id)` does not exist; skip existing IDs.
- `replace`: requires `confirmReplace: true` and `expectedRevision` equal to the current collection revision. It hard-deletes current opportunities (cascading children) and inserts the valid unique incoming records in one transaction. A stale revision returns `409 STALE_REVISION`.
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

- Export includes all non-deleted opportunities in collection order, with no `version`, `createdAt`, `updatedAt`, `deletedAt` or other server metadata. `exportedAt` is server UTC. The envelope and schema version do not change.
- Do not accept the browser recovery raw string as a backup. Only a valid `launchboard-backup` v1 envelope is accepted. A user may manually save a raw payload as a `.json` file and import it only if it is genuinely a valid envelope.

### 7.7 Error codes

| Code | HTTP | Meaning |
|---|---|---|
| `UNAUTHENTICATED` | 401 | Missing/expired session. |
| `INVALID_CREDENTIALS` | 401 | Login failed; no email enumeration. |
| `EMAIL_IN_USE` | 409 | Registration email already exists. |
| `FORBIDDEN` | 403 | CSRF/origin failure or an explicitly forbidden action. Cross-user resource access uses 404. |
| `NOT_FOUND` | 404 | Resource missing, soft-deleted, or not owned. |
| `INVALID_JSON` | 400 | The request body is not valid JSON. |
| `INVALID_REQUEST` | 400–499 | Another malformed transport request, such as an unsupported charset. |
| `PRECONDITION_REQUIRED` | 428 | A mutation arrived without `If-Match` or `expectedVersion`. |
| `VALIDATION_ERROR` | 422 | Invalid field/enum/date/URL/limit; `details.fields`. |
| `SYSTEM_ACTIVITY_IMMUTABLE` | 422 | A `Status changed` activity was added, edited or removed by the client. |
| `CONTACT_REFERENCE_INVALID` | 422 | An interview references a contact that is not in the same opportunity. |
| `STALE_VERSION` | 409 | `If-Match` does not match; `details.currentVersion`. |
| `STALE_REVISION` | 409 | Replace-import revision mismatch. |
| `BULK_CONFLICT` | 409 | At least one batch item is missing/stale/wrong-state; `details.failures`. |
| `DUPLICATE_ID` | 409 | Create/import ID already exists for this user. |
| `DUPLICATE_REQUEST_ID` | 422 | Duplicate IDs inside one request. |
| `INVALID_BACKUP` | 422 | Bad envelope/schema/JSON/record plan. |
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

### 8.1 What a version-1 backup is

The envelope is unchanged: `format: "launchboard-backup"`, `schemaVersion: 1`, `exportedAt`, `opportunities: Opportunity[]`. The server validates it exactly as the frontend does today:

1. Reject input larger than 5 MiB (`413 PAYLOAD_TOO_LARGE`) before parsing.
2. Parse JSON; failure → `422 INVALID_BACKUP` with `details.reason = "invalid-json"`.
3. Require the exact format string, a numeric `schemaVersion`, and an `opportunities` array.
4. Reject `schemaVersion !== 1` as `unsupported-schema`. Unknown newer versions are never guessed at.
5. Reject more than 20,000 records as `too-many-records`.
6. Run each record through the shared canonical normalizer (`normalizeOpportunityRecord` semantics). Count repaired, invalid and duplicate records instead of failing the whole file.
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
| `merge` | Session only | Insert only IDs not already owned by the user. Never modify an existing opportunity. Append after the current maximum `position`, preserving backup order. |
| `replace` | `confirmReplace: true` **and** `expectedRevision` equal to the current `opportunity_revision` | Delete all current non-deleted opportunities and their children (dependency order from §6.4), then insert the valid unique incoming records. One transaction. |

`replace` is destructive. It is rejected with `409 STALE_REVISION` if the collection changed since the client read it, which forces the UI to re-confirm. The current frontend already requires explicit confirmation for replace; the server keeps that requirement and adds revision protection so a stale tab cannot wipe newer data.

Both modes are all-or-nothing. A database failure during `replace` rolls back to the previous collection. A failure during `merge` inserts nothing. Partial imports never leave a half-migrated account.

### 8.4 Client-side migration procedure

The client keeps its local data until the server confirms success:

1. Export or snapshot the local collection in memory.
2. Optionally download a version-1 backup file as a safety copy.
3. `POST /api/opportunities/import` with `dryRun: true` and show the counts (added / skipped / repaired / invalid).
4. On confirmation, call the real import. `merge` is the default for a first migration; `replace` is offered only when the user explicitly chooses it.
5. Persist the returned `revision` and reload the collection from `GET /api/opportunities`.
6. Only after a successful reload, mark local migration complete and stop treating localStorage as the source of truth. Do not delete the local data automatically; keep it until the user clears it.

Retry is safe because `merge` is idempotent with respect to IDs: a retried merge skips records that were already inserted. `replace` is also safe to retry, because the second attempt either sees the same `expectedRevision` (nothing else changed) or fails with `STALE_REVISION` and requires re-confirmation.

### 8.5 Server-side export

`GET /api/opportunities/export` returns the unchanged version-1 envelope for all non-deleted opportunities in collection order. Server metadata (`version`, `createdAt`, `updatedAt`, `deletedAt`, `deletionBatchId`) is excluded, so the file round-trips through the existing frontend importer and through the server importer. `archivedAt` is exported as a UTC ISO string; `isDemo` is included only when true, matching current export behavior.

### 8.6 Browser recovery payloads

`launchboard.recovery.raw.v1` is the exact unreadable localStorage string preserved for manual recovery. It is **not** a backup. The server must never accept arbitrary raw recovery text as a backup, and there is no "restore raw payload" endpoint. A user may only import it if they can produce a genuine valid `launchboard-backup` v1 envelope from it. This is an explicit non-goal.

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

Extracted into `@launchboard/domain` and shared unchanged: domain types and enums, field and collection limits, calendar-date rules, tag normalization, URL/time/email predicates, and the backup envelope. The permissive normalizers in `contacts.ts`, `interviews.ts`, `materials.ts`, `activities.ts`, `archive.ts` and `storage.ts` deliberately stay in the frontend: they repair stored data rather than validate requests. Filtering, calendar, global search, Saved Views and CSV formatting also remain frontend-only.

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
| 1 | Shared domain extraction | Move pure types, enums, limits, date/tag/field rules and the backup envelope into `packages/domain`; keep permissive normalizers frontend-only | Frontend tests still pass unchanged; the package builds; no duplicated rule implementations |
| 2 | Backend foundation | `server/` package: Express app, TypeScript config, error middleware, request IDs, health/ready routes | `npm run build` and `npm run dev` work; `/api/health` returns 200; no database access yet |
| 3 | Config and database connectivity | Env validation, `mysql2` pool, `time_zone='+00:00'`, connection check on `/api/ready` | Missing/invalid env fails fast with a clear message; no secret in source |
| 4 | Schema and migrations | `launchboard` database, migration runner, all tables and constraints | Migrations run forward on a fresh database; no statement references `healthbridge` or `nova_home` |
| 5 | Authentication | Register, login, logout, me; Argon2id/bcrypt hashing; hashed session tokens; CSRF; rate limits | Duplicate email and bad password return safe errors; session survives reload; logout revokes |
| 6 | Opportunity read/create/update/delete | Aggregate serialization, ownership scoping, `version` + `If-Match`, soft delete | Cross-user access returns 404; stale update returns 409 and does not write |
| 7 | Nested workspaces and activities | Interviews, contacts, materials, tags, activities in the aggregate transaction; server-owned status activity | Contact deletion preserves interviews and clears references; status history matches current text |
| 8 | Bulk operations and Undo | Bulk archive/restore/status/delete, deletion batches, batch restore | Any bad item rolls back the whole batch; expired Undo returns 410 |
| 9 | Import/export and migration | Version-1 validation, merge/replace, dry run, export, client migration flow | Backup round-trips byte-compatible; replace is atomic; retry is idempotent |
| 10 | Frontend integration and deployment | `HttpOpportunityRepository`, async `useOpportunities`, `useAuth`, loading/conflict UI | Full manual workflow on the API; local adapter still passes the test suite |

### 10.1 Decisions required before Stage 4 (schema)

These must be settled by a human before tables are created:

1. Final text-length caps for `title`, `company`, `compensation`, `description`, `notes`, `url`. The current frontend has none; the schema uses `TEXT`/`MEDIUMTEXT` to avoid silent truncation, but API limits should be explicit.
2. Soft-delete retention and purge job schedule (proposed: 30 days, daily purge).
3. Session lifetime (proposed: 14 days absolute) and whether "remember me" exists.
4. Argon2id versus bcrypt as the committed hashing choice on Windows.
5. Whether new server accounts receive demo data.
6. Whether `statusActivityDate` is client-supplied (recommended, to preserve local dates) or server-derived from UTC.

Everything else in this document is specific enough to implement without renegotiation.

### 10.2 Database foundation implemented in Stage 10C

Stages 3 and 4 are implemented at the foundation level only:

- `server/src/config/env.ts` parses the optional runtime `DB_*` block separately from the migration-only `DB_MIGRATION_USER` and `DB_MIGRATION_PASSWORD`. It rejects any `DB_NAME` other than `launchboard`; neither credential set falls back to the other.
- `server/src/db/pool.ts` owns one bounded `mysql2/promise` pool, sets `time_zone = '+00:00'` on every acquired connection, and verifies `SELECT DATABASE()` before reporting readiness.
- `GET /api/ready` performs that read-only check; it never migrates or writes. `GET /api/health` remains independent of the database.
- `server/database/create-database.sql` is a deliberate, one-time administrator action. It only creates `launchboard`.
- `npm run db:migrate` runs `server/database/migrations/*.sql` in filename order, records versions and checksums, skips verified migrations, and refuses checksum drift, a missing applied file, or any selected database other than `launchboard`.
- The initial migration creates the tables in §4. No repository, authentication, opportunity endpoint, or frontend API client exists. Presence of these tables does not imply those features are available.

MySQL/MariaDB DDL implicitly commits, so a migration is not transactionally atomic. A failed migration is never recorded; recovery requires inspecting the partial schema and re-running after fixing the cause. The runner never drops or rebuilds tables automatically.

---

## 11. Security and operations checklist

### 11.1 Sessions and credentials

- Session cookie: `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` in production, no `Domain` attribute.
- Only the SHA-256 hash of the session token is stored. A database leak does not yield usable sessions.
- Rotate the session ID on login. Delete the row on logout.
- Generic login errors; constant-time password comparison via the hashing library.
- Rate-limit registration and login per IP and per email, and return `Retry-After` on `429`.

### 11.2 CSRF and CORS

- Require `X-CSRF-Token` matching the readable CSRF cookie on every mutating request.
- Verify `Origin` (and `Referer` as a fallback) against `APP_ORIGIN` for mutating requests.
- CORS: exact allowlist only, `credentials: true`, never `*`. Prefer the Vite proxy so development is same-origin.
- Reject unknown content types; do not accept form-encoded mutations.

### 11.3 Input and output safety

- Validate every field server-side regardless of client validation. Never trust `user_id`, `version` or IDs from the body for authorization.
- Prepared statements only; no string-concatenated SQL.
- Parameterized `LIMIT`/`OFFSET` if pagination is added; never interpolate sort columns.
- Never return SQL errors, stack traces, hashes, tokens or connection strings. Log them server-side with a request ID.
- Set conservative body limits. The server foundation uses a single 6 MiB JSON transport limit (5 MiB backup + 1 MiB envelope/escaping) and caps shared array lengths. A later stage may apply a smaller limit to non-import routes; the import handler must still enforce the 5 MiB backup limit after parsing.
- Escape nothing in JSON responses; the client renders text, and CSV formula neutralization remains a client export concern.

### 11.4 Database and operations

- Dedicated database `launchboard`; two dedicated accounts with privileges on `launchboard.*` only. The runtime account is limited to data access; the migration account owns schema changes and migration tracking. Never root, never `healthbridge`, never `nova_home`.
- `.env` is git-ignored; `.env.example` documents names with placeholder values.
- Backups of the `launchboard` database are the operator's responsibility; the JSON export is a user-facing feature, not a database backup.
- Migrations are forward-only and recorded in `schema_migrations`. No destructive migration runs automatically in production.
- Health endpoints expose no schema or version detail publicly.
- Log authentication failures, rate-limit hits, conflicts and 5xx with request IDs; never log passwords, tokens or full request bodies containing them.

### 11.5 Known limitations to state honestly

- No email verification or password reset in v1.
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
| Session lifetime / sliding expiry | Security versus convenience | 14 days absolute, no sliding |
| Argon2id vs bcrypt | Native build reliability on Windows versus modern default | Argon2id, bcrypt cost 12 fallback |
| Demo data for new accounts | Affects first-run experience and test fixtures | No; demo data stays a frontend-only concept |
| `statusActivityDate` source | Determines whether status history dates match the user's calendar | Client-supplied and validated |
| Pagination for large collections | Current UI assumes a full collection in memory | No pagination in v1; revisit above ~5,000 records |
| Saved Views server sync | Cross-device convenience versus scope | Local only |

Resolved in Stage 10A: the shared-code layout is the npm workspace package `packages/domain` (`@launchboard/domain`), ESM compiled with NodeNext to `dist`, consumed by the frontend through re-export wrappers. See `packages/domain/README.md`. The package contains contracts and pure rules only; it does not implement the backend.

Stage 10B note: the `server/` workspace enforces the resolved limits and rules above but deliberately does **not** enforce the unresolved opportunity text caps (`title`, `company`, `compensation`, `description`, `notes`, opportunity `url`). Those requests remain bounded only by the global JSON transport limit until the decision above is approved. The same stage implements `GET /api/health` as liveness only; `/api/ready` remains deferred until database connectivity exists.

---

## 13. Final recommendation

The design is **ready for backend foundation work** (Stages 1–3) once the seven Stage-4 decisions above are approved. The domain model, schema, ownership rules, concurrency model, transaction boundaries, API contract, and backup migration path are specified concretely enough to implement without redesign.

Recommended order: extract shared domain rules first, then stand up the server and database foundation, then authentication, then the opportunity aggregate with optimistic concurrency. Do not begin frontend integration until the aggregate endpoints and conflict semantics are proven with tests.

No backend code, SQL, dependency, database change, or frontend change has been made. The application remains localStorage-only, and all existing keys, backup formats and behaviors are unchanged.

