# `@launchboard/server`

The Launchboard HTTP and database foundation. It provides environment
validation, process liveness, database readiness, a MySQL/MariaDB connection
pool, an explicit migration runner, the initial relational schema, the shared
JSON error envelope, and strict runtime schemas for future request bodies.

This workspace is **not** a working product backend yet. It has no
authentication, sessions, CSRF, opportunity CRUD, bulk, import/export endpoint,
CORS configuration, or frontend HTTP integration.

## Requirements

- Node.js 20.12 or newer. Verified with Node 26.8.2.
- npm. Verified with npm 11.19.1.
- MySQL 8.0.16+ or MariaDB 10.2+. The local XAMPP environment used for schema
  inspection is **MariaDB 10.4.32**. Live migration execution was not performed
  because no `launchboard` database or credentials were configured.
- The shared domain package must be built before the server runs. All root
  scripts below build it automatically.

## Package structure

```text
server/
  src/
    app.ts                     # builds the Express app; never listens
    server.ts                  # loads config, creates the pool, owns app.listen
    config/env.ts              # process and optional database environment parsing
    db/
      readiness.ts             # readiness types shared with the app
      pool.ts                  # mysql2 pool, UTC acquisition, readiness check
      migrate.ts               # deterministic migration runner
      migrate-cli.ts           # npm run db:migrate entry point
    errors.ts                  # ApiError and stable error codes
    http/errorEnvelope.ts      # the single JSON error envelope
    middleware/
      requestId.ts
      notFound.ts
      errorHandler.ts
      validateBody.ts
    routes/
      health.ts
      readiness.ts
    validation/
      common.ts
      opportunitySchemas.ts
      bulkSchemas.ts
      backupSchemas.ts
    types/express.d.ts
    test/                      # Node-environment Vitest tests and fixtures
  database/
    create-database.sql        # explicit, one-time database bootstrap
    provision-accounts.sql     # editable two-account grant template
    migrations/
      001_initial_schema.sql
  .env.example
  .gitignore
  package.json
  tsconfig.json                # typecheck, includes tests
  tsconfig.build.json          # production build, excludes tests
  vitest.config.ts
```

## Install, develop and build

From the repository root:

```bash
npm install
npm run build:domain      # compile @launchboard/domain
npm run dev:server        # tsx watch src/server.ts
```

The development server defaults to `http://127.0.0.1:3000`.

```bash
npm run build:server      # emits server/dist
npm run start:server      # node dist/server.js
npm run typecheck:server
npm run test:server
npm test                  # frontend/domain suite, then server suite
```

## Database provisioning

Database provisioning is a **separate, explicit administrator action**. The
server never creates, drops or recreates a database on startup. The migration
runner only connects to an existing database and refuses to proceed unless the
server reports exactly `launchboard` as the selected database.

The bootstrap file creates only the dedicated database:

```bash
# Run once as an administrator. Do not use the application credentials.
mysql -u <admin-user> -p < server/database/create-database.sql
```

It executes:

```sql
CREATE DATABASE IF NOT EXISTS launchboard
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;
```

It contains no `DROP`, no `USE`, and no reference to `healthbridge` or
`nova_home`.

Create **two** dedicated accounts restricted to `launchboard.*`. Replace the
placeholders with your own values; do not use the MySQL `root` account and do
not reuse another project's credentials. Use the host that matches `DB_HOST`
(`127.0.0.1` below); an account created only for `'localhost'` may not match a
TCP connection to `127.0.0.1`.

The runtime account serves the application and readiness checks. It needs data
access only:

```sql
CREATE USER 'launchboard_app'@'127.0.0.1'
  IDENTIFIED BY '<runtime-password>';
GRANT SELECT, INSERT, UPDATE, DELETE
  ON launchboard.* TO 'launchboard_app'@'127.0.0.1';
```

The migration account is used only by `npm run db:migrate`. It needs the DDL
privileges required by the current migration and future additive migrations,
plus the data access needed to read and record migration history:

```sql
CREATE USER 'launchboard_migrator'@'127.0.0.1'
  IDENTIFIED BY '<migration-password>';
GRANT CREATE, ALTER, INDEX, REFERENCES, SELECT, INSERT
  ON launchboard.* TO 'launchboard_migrator'@'127.0.0.1';
```

`server/database/provision-accounts.sql` is an editable template containing the
same statements with unmistakable password placeholders. It is intended to be
run once by an administrator after editing the passwords. Never execute it
unchanged, never commit real credentials, and do not grant global privileges.

`CREATE` is needed to create tables, including `schema_migrations`. `ALTER`,
`INDEX` and `REFERENCES` are needed for additive schema changes and foreign
keys. `SELECT` and `INSERT` are the only data privileges the current runner
uses on `schema_migrations`; it does not use `UPDATE` or `DELETE`. The runner
does not drop tables, so `DROP` is intentionally not granted. Grant additional
DML temporarily only for a specific future data migration.

Neither account needs global privileges or access to another database. The
runtime account must not receive schema-modification privileges merely because
migrations exist.

Copy `server/.env.example` to `server/.env` manually and set the values. Never
commit `.env`; `server/.gitignore` excludes it. Do not create a real `.env` as
part of a code change.

### Controlled live-integration checklist

Do not run these steps until you intend to provision the database. Preparing the
repository does not connect to MariaDB or execute SQL.

1. Start MySQL/MariaDB from the XAMPP Control Panel and confirm the service is
   running.
2. Run the database bootstrap as an administrator. This creates only
   `launchboard`:

   ```bash
   mysql -u <admin-user> -p -h 127.0.0.1 < server/database/create-database.sql
   ```

3. Edit `server/database/provision-accounts.sql`, replace both password
   placeholders, then run it once as an administrator:

   ```bash
   mysql -u <admin-user> -p -h 127.0.0.1 < server/database/provision-accounts.sql
   ```

4. Verify the grants with `SHOW GRANTS` for both accounts. The runtime account
   must have no DDL privileges, and neither account may have global privileges.
5. Copy `server/.env.example` to `server/.env` and set `DB_PASSWORD` and
   `DB_MIGRATION_PASSWORD` to the generated values. Keep `DB_HOST=127.0.0.1`,
   `DB_PORT=3306`, `DB_NAME=launchboard`, `DB_USER=launchboard_app` and
   `DB_MIGRATION_USER=launchboard_migrator`.
6. Confirm the environment file is ignored: `git check-ignore -v server/.env`
   must report the ignore rule. Never commit `.env`.
7. Run `npm run db:migrate`. It must print the verified `launchboard` target and
   use only the migration account. It must never fall back to the runtime
   account.
8. Start the backend with `npm run dev:server` or `npm run start:server`. The
   process uses only the runtime account.
9. Request `GET /api/ready` and expect `200 {"status":"ok","db":"ok"}`. Request
   `GET /api/health` and expect `200 {"status":"ok"}` independently of database
   state.
10. If a migration fails partway, stop and inspect the partial schema. Do not
    drop tables automatically; see the recovery limitations below.

## Environment configuration

`src/config/env.ts` loads `server/.env` through Node's built-in
`process.loadEnvFile`. Existing process variables take precedence over file
values. A missing `.env` is not an error.

| Variable | Required | Default | Accepted values |
|---|---|---|---|
| `NODE_ENV` | no | `development` | `development`, `test`, `production` |
| `HOST` | no | `127.0.0.1` | A host name without whitespace, up to 255 characters |
| `PORT` | no | `3000` | Integer from 1 to 65535 |
| `DB_HOST` | when DB configured | `127.0.0.1` | Host name without whitespace, up to 255 characters |
| `DB_PORT` | when DB configured | `3306` | Integer from 1 to 65535 |
| `DB_NAME` | when DB configured | none | Must be exactly `launchboard` |
| `DB_USER` | when runtime DB configured | none | Runtime user name without whitespace, up to 128 characters |
| `DB_PASSWORD` | when runtime DB configured | none | Runtime password; may be empty only if that user intentionally has no password |
| `DB_MIGRATION_USER` | when migrating | none | Migration user name without whitespace, up to 128 characters |
| `DB_MIGRATION_PASSWORD` | when migrating | none | Migration password; may be empty only if that user intentionally has no password |

The **runtime** block is optional. If none of the five `DB_*` runtime variables is
present, the process starts without a database: `/api/health` works and
`/api/ready` returns 503. Once any runtime database setting is present, the
runtime block must be complete. Migration-only settings do not enable a runtime
connection.

The **migration** credentials are separate. `DB_MIGRATION_USER` and
`DB_MIGRATION_PASSWORD` must both be provided explicitly for `npm run
db:migrate`; they never fall back to `DB_USER` or `DB_PASSWORD`. The migration
command does not require the runtime credentials. The shared `DB_HOST`,
`DB_PORT` and `DB_NAME` settings are reused, with the same exact-`launchboard`
guard.

Invalid settings stop startup or migration before a connection is attempted,
exit with code 1, and print a message that names the setting and the rule. It
never prints the setting value, because the passwords are secrets. `DB_NAME` is
never defaulted: a configured value other than `launchboard` is rejected. The
pool and migration runner repeat the guard and also verify `SELECT DATABASE()`
at runtime.

## Health and readiness

`GET /api/health` is process liveness only:

```json
{ "status": "ok" }
```

It does not touch the database and remains usable when the database is absent,
unreachable or misconfigured.

`GET /api/ready` checks the configured pool:

1. Acquire a connection.
2. Set the session time zone to `+00:00`.
3. Verify `SELECT DATABASE()` is exactly `launchboard`.
4. Run `SELECT 1`.

Success returns:

```json
{ "status": "ok", "db": "ok" }
```

If configuration is absent, the pool cannot connect, the selected database is
unexpected, or the check fails, the endpoint returns `503` with the shared error
envelope:

```json
{
  "error": {
    "code": "NOT_READY",
    "message": "The database is not ready.",
    "requestId": "…"
  }
}
```

The readiness route never runs migrations or changes data. It never returns the
host, user, password, connection string, SQL text or driver error.

## Schema and migrations

Run migrations deliberately from the repository root:

```bash
npm run db:migrate             # tsx src/db/migrate-cli.ts
```

For a compiled deployment:

```bash
npm run build:server
npm run db:migrate:compiled    # node dist/db/migrate-cli.js
```

The runner:

- connects with `DB_MIGRATION_USER` and `DB_MIGRATION_PASSWORD`, never with the
  runtime `DB_USER` or `DB_PASSWORD`;
- fails before connecting when migration credentials or `DB_NAME` are missing or
  invalid;
- verifies connectivity and the selected database before any DDL;
- creates `schema_migrations` if it does not exist;
- reads `server/database/migrations/*.sql` in filename order;
- records `version`, SHA-256 `checksum` and `applied_at` (UTC) for each success;
  checksums normalize CRLF and standalone CR to LF before hashing, so Windows and
  Linux checkouts agree, and `.gitattributes` pins SQL files to LF;
- skips already applied migrations only when the recorded checksum matches;
- refuses to run when an applied checksum has drifted or an applied migration
  file is missing;
- executes one statement at a time with `multipleStatements: false`;
- closes the pool and exits with a non-zero code on failure.

`TEXT` and `MEDIUMTEXT` columns intentionally have no SQL defaults; the future
repository supplies the canonical empty string. `DATE` stores calendar dates,
`TIME` stores wall-clock interview times, and `DATETIME(3)` stores UTC audit and
archive instants.

### Migration recovery limitations

MySQL/MariaDB DDL implicitly commits. The initial schema is therefore **not**
transactionally atomic. If a migration fails partway through, completed tables
may remain, but the migration is not recorded. The error message says so and
asks you to review the database state and re-run after fixing the cause.

The runner does not automatically drop or rebuild tables. Do not drop objects
unless you have confirmed the partial state and have a backup. Re-running the
initial migration is safe for objects that were completed, because its table
creation statements are `IF NOT EXISTS`; a partially created object still needs
manual review.

### Initial schema

The initial migration creates:

- `users`, `sessions`
- `opportunity_deletions` (Undo batches)
- `opportunities`
- `opportunity_tags`
- `contacts`, `interviews`, `materials`, `activities`

The migration runner owns `schema_migrations`. Opportunities use an internal
`BIGINT UNSIGNED` key and a client-facing `public_id`; public IDs are unique per
user. Child IDs are unique per opportunity. Interviews use a composite foreign
key to contacts so an interview cannot reference a contact from another
opportunity. Deleting an opportunity cascades to its children; deleting a
contact is blocked while interviews still reference it, so a future contact
endpoint must clear those references first.

The schema uses InnoDB, `utf8mb4_unicode_ci` for general text, binary/ASCII
collations for IDs and controlled values, `CHECK` constraints for controlled
values and child positions, and indexes matching the documented read patterns.
`CHECK` constraints are defense in depth; server-side validation remains
authoritative.

The contract leaves opportunity `title`, `company`, `compensation`,
`description`, `notes` and `url` caps unresolved. The schema therefore uses
`TEXT`/`MEDIUMTEXT` and does not invent permanent limits. Practical storage
limits are about 64 KiB for `TEXT` and 16 MiB for `MEDIUMTEXT`; these are not
product rules. Finalize the caps before enabling public mutation endpoints.

### MariaDB compatibility notes (static audit)

The target environment is MariaDB 10.4.32. Static inspection indicates that the
schema uses supported features: `CHECK` constraints (enforced from MariaDB
10.2), `DATETIME(3)`, `DATE`, `TIME`, `utf8mb4_unicode_ci`, composite foreign
keys, `BIGINT UNSIGNED AUTO_INCREMENT`, and the statement forms used by the
migration runner. No live compatibility test has been performed.

Two environment assumptions should be confirmed during the controlled live
integration:

- The local `my.ini` uses
  `sql_mode=NO_ZERO_IN_DATE,NO_ZERO_DATE,NO_ENGINE_SUBSTITUTION`, which is not
  strict mode. Application validation remains authoritative, but consider
  enabling `STRICT_TRANS_TABLES` for the server or session so missing or
  overlong values fail instead of being coerced.
- The schema relies on InnoDB's default `DYNAMIC` row format for the
  `VARCHAR(254)` utf8mb4 email unique index. MariaDB 10.4 defaults to
  `DYNAMIC`; confirm the server setting if it has been customized.

The composite interview-to-contact foreign key uses `ON DELETE RESTRICT`.
Deleting an opportunity cascades to both interviews and contacts, so the future
opportunity delete path should delete interviews before contacts, or live
integration must confirm that InnoDB processes the cascades in a safe order.

## Validation policy

Server validation is strict and authoritative for future HTTP mutations:

- Object structure and required fields are validated.
- Types, controlled values, dates, times, URLs and emails are validated.
- Unknown properties are rejected in request DTOs (`strictObject`).
- Server-managed fields (`archivedAt`, `version`, audit timestamps, internal IDs)
  are absent from writable shapes and therefore rejected.
- Child collection caps and established field lengths come from
  `@launchboard/domain`.
- Child IDs must be unique within one opportunity for normal writes.
- An interview `contactId` must be `''` or a contact in the same aggregate.
- Missing or invalid values are rejected; they are not silently repaired.
- Tags are the one deliberate canonicalization: after count/length checks, the
  shared `normalizeTagList` rule trims, drops empty entries and deduplicates
  case-insensitively.

This is intentionally different from browser storage recovery. `src/utils/storage.ts`
repairs malformed stored records to preserve recoverable data. The server rejects
invalid requests with `422`. Only types, limits and rules with identical intended
semantics are shared through `@launchboard/domain`.

## Testing

```bash
npm run test:server
```

The suite uses Vitest in the Node environment (`server/vitest.config.ts`) and
test-only Express routes. Database tests use fake pools and connections; the
main suite does **not** require a running MySQL/MariaDB server. It covers:

- environment defaults, valid values, invalid ports/modes, safe diagnostics and
  `.env` loading precedence;
- database configuration: absent block, complete block, defaults, invalid port,
  missing settings, wrong `DB_NAME`, and password redaction;
- separate runtime and migration credentials: no fallback from
  `DB_MIGRATION_USER`/`DB_MIGRATION_PASSWORD` to `DB_USER`/`DB_PASSWORD`, and the
  runtime parser ignoring migration-only settings;
- the strict `launchboard` target guard in pool construction, readiness and the
  migration runner;
- readiness success, unconfigured, unreachable, target-mismatch and thrown-error
  behavior, including safe 503 envelopes;
- `/api/health` remaining available when the database is absent or not ready;
- migration ordering, checksum recording, skip behavior, checksum drift,
  missing applied files, partial failure, connection failure and schema-table
  failure;
- static schema/bootstrap invariants: required tables, keys, composite contact
  reference, date/time storage, no destructive commands and no `healthbridge` or
  `nova_home` references;
- no migration execution during application startup, and separate runtime and
  migration code paths for credential parsing.

Server tests are not included in the root jsdom configuration, so `npm test`
does not execute them twice.

## Live integration status

No real `launchboard` database or database credentials were configured in this
environment. The XAMPP MariaDB 10.4.32 server was identified, but no connection
or migration was attempted. The schema and migration runner are therefore
verified by mocked tests and static inspection only; a real MySQL/MariaDB
integration smoke test remains **unverified**.

To perform one deliberately, provision the database and user, set the five
`DB_*` values in `server/.env`, run `npm run db:migrate`, start the server, and
check `/api/ready`. Confirm the migration runner prints the verified target
before applying anything.

## Out of scope in this stage

- Authentication, registration/login/logout, sessions or CSRF.
- Opportunity CRUD, nested workspace, bulk, import or export endpoints.
- Frontend HTTP integration, authenticated CORS or deployment.
- Changes to localStorage, recovery behavior, backup formats or CSV export.
- Automatic database creation, automatic migration or destructive recovery.

The migration runner only targets the dedicated `launchboard` database. Never
run it against `healthbridge`, `nova_home` or any other database.
