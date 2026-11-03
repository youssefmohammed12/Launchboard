# Launchboard API

The `server/` workspace contains the Express 5 API used by Launchboard's authenticated data mode. It owns account/session behavior, user-scoped opportunity aggregates, database transactions, bulk operations, and backup import/export.

## Requirements

- Node.js 20.12 or newer.
- npm (install dependencies from the repository root).
- MySQL or MariaDB for database-backed API use. The database name must be exactly `launchboard`.

## Development

From the repository root:

```bash
npm ci
npm run dev:server
```

The API listens on `http://127.0.0.1:3000` by default. The Vite dev server proxies `/api` requests to this address, so the browser uses a same-origin URL.

Useful root scripts:

```bash
npm run test:server
npm run typecheck:server
npm run build:server
npm run db:migrate
npm run db:verify-live
```

Server tests use mocked database connections and do not require a live database. The live verifier is a separate, explicit operation.

## Environment configuration

Copy `.env.example` to `.env` in this directory. The real `.env` is ignored by Git and must never be committed.

| Setting | Purpose |
| --- | --- |
| `NODE_ENV`, `HOST`, `PORT` | Runtime mode and listener |
| `DB_HOST`, `DB_PORT`, `DB_NAME` | Database connection; `DB_NAME` must be `launchboard` |
| `DB_USER`, `DB_PASSWORD` | Least-privilege runtime account |
| `DB_SSL`, `DB_SSL_CA` | Optional database TLS and custom CA |
| `DB_MIGRATION_USER`, `DB_MIGRATION_PASSWORD` | Separate credentials used only by migrations |
| `CSRF_SECRET` | High-entropy secret used to derive session-bound CSRF tokens |
| `TRUSTED_ORIGINS` | Comma-separated list of exact allowed origins |
| `SMTP_USER`, `SMTP_PASS` | Dedicated Gmail sender and its app password |
| `APP_BASE_URL` | Exact canonical application origin used in account emails |

The database settings are optional for process health checks, but required for authenticated data operations. Email settings must be configured together for registration, verification resend, and password-reset email delivery.

Do not place server secrets in `VITE_*` variables. Vite-prefixed variables are exposed to the browser bundle.

## Database setup and migrations

Provision a database named `launchboard` and use two separate database accounts:

- The **runtime account** receives only `SELECT`, `INSERT`, `UPDATE`, and `DELETE` on `launchboard.*`.
- The **migration account** receives only the schema and migration-history privileges required by the migration runner.

The migration runner reads the migration-only credentials. It never falls back to the runtime user/password, and the application server never uses migration credentials.

Apply migrations intentionally:

```bash
npm run db:migrate
npm run db:verify-live
```

Migrations are versioned and checksum-verified. The application does not create databases or run migrations automatically at startup. The runner refuses a target database other than `launchboard`.

The current schema is defined by the numbered SQL files in `database/migrations/`. Never edit an already-applied migration; add a new migration for schema changes. Back up the database before applying production migrations.

## API and security model

The API uses:

- Argon2id password hashing.
- Database-backed sessions delivered in HttpOnly cookies.
- Pre-authentication and authenticated CSRF tokens, with exact-origin validation.
- Email verification and one-time password-recovery tokens. Raw action tokens are not stored in the database.
- Per-user ownership checks for all opportunity and nested-record operations.
- Optimistic concurrency with version checks for writes.
- Transactional bulk operations, Undo batches, and backup import/replace.
- Generic account-action responses to reduce email/account enumeration.

Email is delivered through Gmail SMTP using Nodemailer. A standard Gmail account is intended only for low-volume use. Rate-limit counters are process-local, so use a shared store before running multiple API instances.

## Health endpoints

- `GET /api/health` reports process liveness and does not require a database connection.
- `GET /api/ready` verifies that the configured `launchboard` database is reachable and returns a safe readiness response.

Neither endpoint runs migrations or writes application data.
