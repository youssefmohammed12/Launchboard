# Launchboard deployment

## Current production deployment

Last checked: **4 November 2026**.

- Application: [https://launchboard-drab.vercel.app](https://launchboard-drab.vercel.app)
- Hosting: Vercel Hobby, Node.js 24.x, Frankfurt region (`fra1`).
- Database: TiDB Cloud Serverless, database `launchboard`.
- Latest production deployment: `dpl_Fed9L1WuwYxQ1asTkCC5DFNLiN3K` (READY; includes the new SVG favicon).
- The UI redesign, CSV import, API-mode integration, and current authentication presentation are included in the deployed application.

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
