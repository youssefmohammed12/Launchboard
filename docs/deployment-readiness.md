# Launchboard deployment

## Current production deployment

Last checked: **7 November 2026**.

- Application: [https://launchboard-drab.vercel.app](https://launchboard-drab.vercel.app)
- Hosting: Vercel Hobby, Node.js 24.x, Frankfurt region (`fra1`).
- Database: TiDB Cloud Serverless, database `launchboard`.
- Latest production deployment: `dpl_BoUMH49zoDQc8WtjZbG8FcR6oZKD` (READY; Action Center v1.2.0 release, 7 November 2026).
- The current production application includes opportunity-linked tasks, Action Center, Dashboard Today's Focus, Calendar task events, responsive UI, CSV import and authenticated API integration.

The 4 November favicon release used the existing prebuilt deployment workflow and reused the API function bundle unchanged. The frontend production build passed with 1,633 modules. Live smoke verified the canonical homepage, `/favicon.svg` (HTTP 200, `image/svg+xml`, SHA-256 matching the local SVG), generated JS/CSS assets, redesign markers, `/api/health`, and `/api/ready`; readiness returned `db=ok`. No database migrations, environment-variable changes, opportunity-record changes, authentication tests, or CRUD tests were performed.

## Architecture

The frontend is a Vite-built React SPA served from `dist/`. The Express API is exposed through the root Vercel Function adapter at `api/[...path].ts`. API and browser requests share the same HTTPS origin, so session cookies and CSRF protections work without cross-origin browser requests.

The root `vercel.json` is intended for a source-based Vercel deployment. It keeps the SPA fallback away from `/api/`; Vercel discovers the API function from the root `api/` directory. The separate `deployment/vercel.json` is the configuration template for the historical prebuilt-upload workflow, where the function bundle is assembled under `deployment/api/`.

## Required production settings

Configure values in Vercel's environment-variable settings. Never store production values in the repository or in frontend `VITE_*` variables.

**Database/runtime**
- `DB_HOST`, `DB_PORT`, `DB_NAME=launchboard`
- `DB_USER`, `DB_PASSWORD`
- `DB_SSL=true` for TiDB TLS
- `CSRF_SECRET`
- `TRUSTED_ORIGINS=https://launchboard-drab.vercel.app`

**Email**
- `SMTP_USER`
- `SMTP_PASS` (sensitive secret)
- `APP_BASE_URL=https://launchboard-drab.vercel.app`

Migration credentials are not part of the running application environment. Use the separate migration account only for an explicitly approved schema migration.

## Database release procedure

1. Back up the database and review the pending SQL migration.
2. Confirm that the configured target is the dedicated `launchboard` database.
3. Apply the migration with the dedicated migration account from a trusted environment.
4. Run `npm run db:verify-live` and verify checksums, required tables/indexes/foreign keys, runtime grants, and rollback-only cascade behavior.
5. Deploy the application and check `/api/health` and `/api/ready`.
6. Run only the live smoke tests relevant to the change. Avoid destructive tests against real user data.

The application never creates a database or runs migrations automatically at startup. Never run Launchboard migration scripts against other project databases.

## Git-based deployment

The source checkout includes:

- `api/[...path].ts` — Vercel API entry point.
- `vercel.json` — frontend build output and SPA fallback configuration.
- `package-lock.json` — reproducible npm workspace dependency graph.

A Git-connected Vercel project should use the repository root as its Root Directory and install dependencies with `npm ci`. Verify the Vercel function route and the API/SPA routing on a preview deployment before changing the production project's Git source.

## Prebuilt deployment helpers

The `deployment/` directory retains the scripts used for manual prebuilt releases and smoke tests. Bundled API code, generated assets, the upload manifest, and base64 transfer files are generated artifacts and are intentionally excluded from Git. Rebuild them from source when the prebuilt workflow is needed.

## Security and operational notes

- Do not inspect, commit, or share `.env` files, SMTP app passwords, database credentials, or CSRF secrets.
- Use separate runtime and migration database users with least privilege.
- Registration and account-action email delivery depend on Gmail SMTP configuration. Gmail is a low-volume sender.
- Rate limiting currently uses an in-memory store. A shared store is required before running multiple API instances.
- Treat the deployment as a personal portfolio/demo application until operational monitoring, abuse controls, and independent security review meet the needs of its intended audience.


## Responsive UI production release — 7 November 2026

- **Deployment:** `dpl_BR1qNU1KCzYXmVyUayhv9c3DZ6qC` — `READY`, production target, Node.js 24.x, Frankfurt (`fra1`).
- **Deployment URL:** `https://launchboard-6fe5ifp3d-youssef-workplace.vercel.app`.
- **Assigned production aliases:** `https://launchboard-drab.vercel.app` and `https://launchboard-youssef-workplace.vercel.app`.
- **Build:** local Vite production build with `VITE_DATA_MODE=api`; TypeScript clean and Vite 6.4.5 transformed 1,634 modules. Rebuilt the catch-all API handler for the Node 24 runtime and uploaded the prebuilt package without creating a Git commit.
- **Static artifact verification:** canonical production `index.html`, `favicon.svg`, JavaScript and CSS returned HTTP 200; exact sizes and SHA-1 hashes matched the local uploaded release manifest. The secondary production alias homepage also returned HTTP 200.
- **Live application checks:** `deployment/release-ui-smoke.mjs` passed. `/api/health` returned HTTP 200 (`status=ok`); `/api/ready` returned HTTP 200 (`status=ok`, `db=ok`).
- **Observability:** no Vercel runtime errors were found in the post-deployment 15-minute scan, and no error/fatal log entries were returned for that interval. A previous `DEP0169` Node.js `url.parse()` deprecation warning was observed before this release; it was not an application exception.
- No database migration, environment-variable update, project-setting change, authentication test, production CRUD test, commit or push was performed. Previously user-tested auth and CRUD flows were intentionally not repeated for this presentation-only release.

## Action Center v1.2.0 production release — 7 November 2026

- **Migration:** production TiDB database `launchboard` is at migration 004. The migration was applied with the separate migration account after a verified pre-migration backup and checksum/state guards.
- **Backup:** local Git-ignored logical backup at `artifacts/db-backups/launchboard-pre-v1.2.sql` (12 tables, 82 rows; SHA-256 `c688fc1b6f41ce0ef67452ab3469a40e2837d40d4ac7313fa4ad5e27e1e639c1`).
- **Live schema verification:** all 13 tables, required columns, indexes and foreign keys passed; migration history 001–004 matches repository checksums; runtime grants passed; rollback-only integrity probe completed and existing user data remained present.
- **Deployment:** `dpl_BoUMH49zoDQc8WtjZbG8FcR6oZKD` — READY, production target, Node.js 24.x, Frankfurt (`fra1`). Unique URL: `https://launchboard-hcj1oa7ki-youssef-workplace.vercel.app`.
- **Aliases:** `https://launchboard-drab.vercel.app` and `https://launchboard-youssef-workplace.vercel.app` both resolve to this deployment.
- **Build:** API-mode frontend build passed (Vite 6.4.5, 1,637 modules); Node 24 catch-all API handler rebuilt; local bundle preflight passed.
- **Live smoke:** both public aliases returned homepage/assets with HTTP 200; Action Center/Overdue/Due today/Completed bundle markers were present; `/api/health` returned `status=ok`; `/api/ready` returned `status=ok, db=ok`; unauthenticated `/api/opportunities` returned HTTP 401 as expected.
- **Coverage boundary:** no production authenticated CRUD or signup/reset email flow was repeated. Local full suites and the live schema/grant/integrity verifier provide the change-specific coverage.
- **Git:** v1.2.0 source and tests are committed on `feature/action-center-v1.2`; `main` is synchronized and the `ui-v1.2.0` tag is pushed to `origin`.
