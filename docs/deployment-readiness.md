# Launchboard deployment

## Current release and database status — 11 November 2026

- **Deployed application:** v1.3.5 Account & Opportunity Workflow Polish, including the email Spam/Junk guidance patch and responsive account-header refinement, is live on Production. Latest deployment `dpl_FBgtdg1WDWdktTMQ5btcFU6e8TFF`, READY, target Production, URL `https://launchboard-b3xc1cih4-youssef-workplace.vercel.app`; deployment metadata references HEAD `baebd941fe5d9d301aca14614e2a0db3af900ae9` on `feature/quick-capture-v1.3`.
- **Source/package boundary:** the Vercel deployment metadata points to branch `feature/quick-capture-v1.3` and HEAD `baebd941fe5d9d301aca14614e2a0db3af900ae9`. The prebuilt package also included the local `src/styles.css` account-header refinement; no new Git commit or push was made for this deployment. `origin/main` remains unchanged at `4c1b3a035cb6a7c2507b546456d3edd39a0710e3`.
- **Earlier Preview:** `dpl_7ZiFNqXggqnYaLMZgerWpg3JdMuN`, READY, from the earlier email-guidance SHA `49eda0264dcb9765ffd06cadde9490539401daf6`. It passed its own SPA, asset, health/readiness and unauthenticated API checks; it was not the exact prebuilt package later sent to Production.
- **Production aliases:** `launchboard-drab.vercel.app` and `launchboard-youssef-workplace.vercel.app` are attached to latest deployment `dpl_FBgtdg1WDWdktTMQ5btcFU6e8TFF`.
- **Hosted TiDB:** migrations 001–007 are applied to `launchboard`. Migration 006 followed a fresh verified backup and isolated restore; migration 007 followed a fresh successful SQL/GZIP export, 24/24 download and SHA-256/GZIP integrity verification. Live postflight confirms Contract in the opportunity CHECK, CHECK enforcement enabled, and unchanged user/opportunity counts (5/13). The read-only `lb_app` grant audit remains scoped to `launchboard.*`.
- **Production smoke:** canonical homepage, login route, favicon and generated JS/CSS assets returned HTTP 200; `/api/health` and `/api/ready` returned healthy JSON (`db=ok`); the unauthenticated API auth route returned the expected JSON authentication guard. The account header passed 15/15 viewport checks; no browser runtime errors or recent Vercel runtime errors were found. The direct Production deployment completed without a separate Preview deployment for this exact prebuilt package.
- **Outstanding verification limitation:** the rollback-only cascade probe using the actual restricted runtime credential was not run. The live runtime password was not retrieved. Email HTML was not visually verified in Gmail, and the mailbox folder for a fresh real-recipient verification message remains to be checked by the user. No authenticated or destructive account test was run against a real user during this patch deployment.

## Current production deployment

Last checked: **11 November 2026 (v1.3.5 email guidance and responsive account-header prebuilt release)**.

- **Application:** https://launchboard-drab.vercel.app.
- **Hosting:** Vercel Hobby, Node.js 24.x, Frankfurt region (fra1).
- **Database:** TiDB Cloud Serverless v8.5.3, eu-central-1, database launchboard.
- **Latest production deployment:** `dpl_FBgtdg1WDWdktTMQ5btcFU6e8TFF` (READY, Production target; responsive account-header prebuilt package).
- **Immutable deployment URL:** `https://launchboard-b3xc1cih4-youssef-workplace.vercel.app`.
- **Deployment source metadata:** branch `feature/quick-capture-v1.3`, HEAD `baebd941fe5d9d301aca14614e2a0db3af900ae9`. The deployed prebuilt artifacts also contain the local `src/styles.css` account-header refinement; no new commit or push was made for that CSS change.
- **Assigned production aliases:** `launchboard-drab.vercel.app` and `launchboard-youssef-workplace.vercel.app`.
- The v1.3.5 production release includes Account Settings, branded verification/recovery/password-change emails, Contract opportunity type, normalized work details and URLs, stricter Quick Capture fallback, improved opportunity details, calendar title labels, corrected Dashboard seven-day range, and the in-app What's New release history. The 11 November patch adds Spam/Junk guidance after email-triggering auth actions and a reason-for-receipt line in HTML/plain-text account emails; Gmail SMTP and all auth triggers remain unchanged. LinkedIn URLs remain manual; automatic LinkedIn access is disabled.

### Post-deployment read-only smoke

- Canonical Production homepage `/`, `/login`, and `/favicon.svg`: HTTP 200.
- Latest prebuilt package assets `assets/index-DYYvvS-V.css` and `assets/index-gnWS-cI_.js`: HTTP 200 (7/7 release files uploaded with manifest checksums verified).
- /api/health: HTTP 200 (status=ok).
- /api/ready: HTTP 200 (status=ok, db=ok).
- Unauthenticated `/api/auth/me`, `/api/auth/csrf`, `/api/account/profile`, and `/api/opportunities`: expected HTTP 401 authentication guards, not 404 or SPA HTML.
- Both `launchboard-drab.vercel.app` and `launchboard-youssef-workplace.vercel.app` returned HTTP 200 for `/` and `/login`. No real credentials or authenticated session were used.
- Vercel Production deployment `dpl_FBgtdg1WDWdktTMQ5btcFU6e8TFF` is READY. Vercel reported a 4-second build; the seven-file prebuilt upload completed 7/7. The account-header layout passed 15/15 viewport checks, no browser runtime errors were detected, and the recent Vercel runtime-error scan was clean.

No opportunity records, accounts or database schema were changed during post-deployment verification. No migration was re-run. A production authenticated CRUD test was intentionally not performed.

## Mandatory release verification gate

For every Production release, a successful build, READY deployment, homepage 200, or `/api/health` response alone is insufficient. Follow these steps in order:

1. Record the full candidate Git SHA, branch and deployment method. Inspect `git status` and identify every intended release file.
2. Deploy the candidate as a Preview and verify its Vercel source metadata contains that exact SHA. A Preview from an older commit or different branch tip does not validate the candidate. Do not treat a persistent alias's earlier successful deployment as proof for a newer candidate.
3. Inspect the routing config used by the actual deployment path. Source-based deployment uses root `vercel.json`; the separate `deployment/vercel.json` is used by the prebuilt workflow. Keep both configurations behaviorally aligned: nested `/api/:path*` must rewrite to `/api/[...]` **before** the SPA fallback, and root function `api/[...].ts` must match. Test the same deployment workflow/configuration intended for Production.
4. On Preview, verify:
   - SPA routes `GET /` and `GET /login` return HTML (HTTP 200), with referenced JS/CSS assets loading successfully.
   - `GET /api/health` and `GET /api/ready` return the expected API responses and database readiness.
   - Critical nested API routes `GET /api/auth/me`, `GET /api/auth/csrf`, `GET /api/opportunities`, and `POST /api/capture/preview` return expected authentication guards when unauthenticated (such as 401), not 404 or SPA HTML. Add probes for every route changed by the candidate.
   - A route-only `POST /api/auth/login` probe may use a reserved `.invalid` email and dummy password to verify the pre-auth guard (expected 403 without a valid pre-auth session). Never use real user credentials for a smoke test.
5. After explicit release approval, deploy the **same exact SHA**. Confirm Production is READY, its deployed source SHA matches the Preview-accepted SHA, and the canonical/secondary aliases point to it.
6. Repeat SPA, asset, health/readiness and critical nested API probes against the canonical Production domain after deployment. Preview success does not prove Production routing or alias assignment is correct.
7. Report the SHA, Preview and Production deployment identities, every endpoint/method/status tested, and any unverified authenticated or destructive behavior. A 401/403 proves route reachability only; it does not prove that real-user login works.

### 8 November 2026 incident — release check failure and prevention

The first v1.3 Production deployment served the homepage but nested authentication routes returned 404. Source-based Production used root `vercel.json`, which lacked the nested API rewrite; the separate prebuilt config already contained it. The previous QA Preview was built from `db155ff`, while the original Production deployment used `898a743d18af128f6dea1d21013623ba74744201`, so the Preview was not the same candidate. The old smoke set checked the homepage, health/readiness and one unauthenticated API guard, but did not probe nested auth routes.

Root routing and catch-all naming were corrected in commit `4c1b3a035cb6a7c2507b546456d3edd39a0710e3`. A candidate-specific Preview and the final Production deployment used that exact SHA; nested route probes passed on Preview and then on the canonical Production domain. The checklist above is mandatory for future releases.

## Architecture

The frontend is a Vite-built React SPA served from `dist/`. The Express API is exposed through the root Vercel Function adapter at `api/[...].ts`. API and browser requests share the same HTTPS origin, so session cookies and CSRF protections work without cross-origin browser requests.

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

- `api/[...].ts` — Vercel API catch-all entry point (the rewrite destination is `/api/[...]`).
- Root `vercel.json` — source-based deployment routing; nested `/api/:path*` rewrite must precede the SPA fallback.
- `package-lock.json` — reproducible npm workspace dependency graph.

A Git-connected Vercel project should use the repository root as its Root Directory and install dependencies with `npm ci`. Follow the mandatory exact-SHA Preview and nested-route gate above before deploying. Keep the API rewrite behavior in root `vercel.json` aligned with `deployment/vercel.json`; the two files serve different deployment workflows and are not automatically interchangeable.

## Prebuilt deployment helpers

The `deployment/` directory contains the reusable prebuilt release runner and its lower-level build, manifest and smoke helpers. Bundled API code, generated assets, the upload manifest, and staged release files are generated artifacts and are intentionally excluded from Git.

### Reusable one-command release workflow

Run these from the repository root. In Windows PowerShell, use `npm.cmd` so the command bypasses a restricted `npm.ps1` execution-policy shim; other shells can use `npm`.

```powershell
npm.cmd run release:prepare
```

This is the safe default. It builds the frontend with `VITE_DATA_MODE=api`, bundles the Node 24 Vercel API handler, assembles the clean seven-file (current package) release under `deployment/release-stage/`, writes `deployment/upload-manifest.json` with file sizes and SHA-1 hashes, and runs `deployment/verify-upload-manifest.mjs`. It performs **no Vercel network requests**, reads no `.env` files, and does not connect to TiDB, run migrations, send email, or change Git state.

After reviewing the exact changes and receiving explicit Production approval, run:

```powershell
$env:VERCEL_TOKEN = "<your Vercel token in this terminal only>"
npm.cmd run release:production
Remove-Item Env:VERCEL_TOKEN
```

The Production command rebuilds and re-verifies the package, displays the branch/HEAD and dirty working-tree paths, and requires the exact interactive confirmation `DEPLOY LAUNCHBOARD TO PRODUCTION`. It uploads the checksummed files to the existing Launchboard Vercel project (up to four parallel uploads), creates **one** Production deployment, polls it until READY/ERROR, then performs read-only smoke checks on the immutable deployment URL and both Production aliases: homepage, login SPA route, generated JS/CSS assets, favicon, health, TiDB readiness, and unauthenticated JSON auth guards. It does not create a Preview deployment.

The script uses the existing project/team IDs as non-secret defaults; `VERCEL_PROJECT_ID` and `VERCEL_TEAM_ID` can override them. The only credential required is `VERCEL_TOKEN`, supplied through the process environment. The build, bundling, manifest and Git-inspection subprocesses receive a sanitized environment without that token; it is used only by the Vercel API upload, create and poll requests. Never put the token in source files, `.env`, command arguments, screenshots, or Git.

**Release policy:** this command is a direct-to-Production prebuilt path, not a substitute for the mandatory exact-SHA Preview gate above. Use it only for a reviewed candidate when direct Production is explicitly approved. When a release requires Preview acceptance, complete that gate with the exact candidate and the same deployment configuration before Production. The script itself never migrates the database or tests real-user CRUD.

If the script fails after Vercel has created a deployment, inspect that deployment before retrying; it deliberately does not create a second deployment automatically.

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
- **Latest deployment:** `dpl_HTXGyoJghytWohG7dTEXFuY9d2iF` — READY, production target, Node.js 24.x, Frankfurt (`fra1`). Unique URL: `https://launchboard-ddxzys8vy-youssef-workplace.vercel.app`. It supersedes the earlier READY v1.2 deployment `dpl_BoUMH49zoDQc8WtjZbG8FcR6oZKD`.
- **Aliases:** `https://launchboard-drab.vercel.app` and `https://launchboard-youssef-workplace.vercel.app` both resolve to this deployment.
- **Build:** API-mode frontend build passed (Vite 6.4.5, 1,637 modules); Node 24 catch-all API handler rebuilt; local bundle preflight passed.
- **Live smoke:** the latest unique deployment URL and both public aliases returned homepage/assets with HTTP 200; favicon returned HTTP 200 as SVG; Action Center, Overdue, No due date, task Calendar and mobile Select-pill bundle markers were present; `/api/health` returned `status=ok`; `/api/ready` returned `status=ok, db=ok`; unauthenticated `/api/opportunities` returned HTTP 401; pre-auth CSRF bootstrap passed on the canonical production origin with the expected secure cookie.
- **Runtime logs:** no error/fatal runtime log entries were returned for the latest deployment during the 30-minute post-deployment query.
- **Coverage boundary:** no production authenticated CRUD or signup/reset email flow was repeated. Local full suites and the live schema/grant/integrity verifier provide the change-specific coverage.
- **Git:** v1.2.0 source and tests are committed on `feature/action-center-v1.2`; `main` is synchronized and the `ui-v1.2.0` tag is pushed to `origin`.


## 2026-11-07 — Release-readiness audit and API-mode bundle preparation (NOT DEPLOYED)

### Local verification passed
- Full frontend test suite: **668/668 passed across 56 files**.
- Full backend test suite: **612/612 passed across 37 files**.
- Root frontend TypeScript/Vite production build passed (Vite 6.4.5, 1,644 modules); server TypeScript production build passed.
- A separate production-mode frontend build with `VITE_DATA_MODE=api` passed (Vite 6.4.5, 1,644 modules). The Node 24 Vercel catch-all API bundle also built successfully.
- The API-mode output, favicon, Vercel runtime package/config and API function were copied to the ignored `deployment/release-stage/` directory. The upload manifest and base64 API transfer bundle were regenerated. Required staged files were checked to exist.
- The release spotlight was corrected so its automatic onboarding dialog does not stack on top of an existing application dialog. The new regression test and the previously failing API bulk-restore test pass.
- `git diff --check` passed; only normal LF-to-CRLF working-copy warnings were reported.

### Git preparation
- Current branch: `feature/quick-capture-v1.3`; local HEAD remains `db155ff`, equal to `origin/main`. The v1.3 candidate has not been committed or pushed.
- GitHub remote `origin` is configured and read access to `origin/main` succeeded. Local commit author identity is configured. The v1.3 branch does not yet exist on origin; its first push should use `git push -u origin feature/quick-capture-v1.3`.
- The Vercel project was not returned when querying projects by the GitHub repository, and the latest deployment records show source `cli`. Do not assume a GitHub push will trigger a Vercel deployment; the documented prebuilt CLI workflow remains the current release path.
- Added Git ignores for generated `deployment/release-stage/`, `deployment/.local-release-api-smoke.mjs` and one-off `deployment/quick-capture-*.mjs` diagnostics. These local diagnostic files were preserved on disk and should not be part of the product commit. The authoritative favicon remains `public/favicon.svg`.
- No files have been staged. No commit or push has been performed.

### Production deployment blockers / approvals still required
- Vercel's latest READY production deployment is `dpl_C8pZ2i2qrDfXpU3bAtrtQFdZCASy` (CLI source, Frankfurt `fra1`) and its metadata references the baseline SHA `db155ff904b31100aa171a93d879fd6a2a73abaf`. It does not contain the current local v1.3 candidate.
- Production `CAPTURE_PREVIEW_ENABLED=true` still has a Vercel comment identifying it as temporary Quick Capture verification enablement. Production `TRUSTED_ORIGINS` still includes the temporary `launchboard-quick-capture-test.vercel.app` origin. These were inspected without decrypting secrets and left unchanged. Review and approve their final production values before the release.
- Migration 005 is applied to hosted TiDB; the hosted schema/history check passed (14 tables, 46 indexes, 13 foreign keys, migrations 001–005). The 23-assertion hosted API round-trip and live cascade check passed using temporary verification users, which were deleted.
- The full live verifier did **not** report an overall PASS: its runtime-grant phase rejected the temporary built-in `role_readwrite` account because its grants included global/system scopes. The actual deployed `lb_app` runtime account's required directly scoped grants have not yet been verified through an approved secure credential path. Do not weaken the verifier and do not retrieve or expose the Vercel database password.
- The post-migration TiDB export is downloaded, decompressed and checksum/schema checked, but was not separately restore-tested. The pre-migration backup was restore-tested. Keep both local backup folders.
- No API-mode bundle preflight against TiDB, authenticated browser acceptance or production smoke was run for the current local candidate. The local prebuilt files are ready, but those live release checks remain separate.

### Release decision
Local code, CI suites, API-mode frontend build, server build and the prebuilt upload package are prepared. **Do not call the production deployment fully cleared yet**: first verify the real `lb_app` grants and finalize the temporary Vercel environment/origin settings with approval. Then perform the separately approved deployment and production smoke. GitHub push can be done independently after selecting/staging the intended product files; exclude the ignored local diagnostics and generated release artifacts.

No commit, push, deployment, domain change, Vercel environment change, production database change or secret retrieval was performed in this readiness pass.


## 2026-11-07 - Responsive release UI verification and spotlight focus fix

### Responsive browser coverage completed
- The previous implementation notes correctly stated that What's New and Feature Spotlight had not yet received a dedicated responsive browser pass. This gap is now closed.
- Chromium checks passed at **360x800**, **390x844**, **768x1024**, and **1440x900**.
- What's New was checked in browser-only mode at all four viewports and in authenticated API-mode UI at all four viewports. Both v1.3.0 and v1.2.0 release notes remain available, the content scrolls vertically as intended, the dialog remains within the viewport, and there is no horizontal overflow.
- The signed-in Feature Spotlight was checked at all four viewports using a local, stubbed auth/empty-opportunities API. The correct Quick Capture control is highlighted, the callout stays within the viewport, and no browser runtime/console errors were reported.
- Interaction checks covered Try Quick Capture opening the capture flow, Maybe later/dismissal, Escape dismissal, the per-user/version localStorage seen marker, no automatic reappearance after reload, and replay from What's New (phone and tablet).
- New/relevant touch controls now meet a 44x44px minimum on phone/tablet widths: What's New entry, dialog close, release-note replay, spotlight close, and spotlight actions. The spotlight CTA buttons are also 44px high on desktop.
- Screenshots from the four viewports are retained only in the local temporary QA folder C:\Users\Youssef\AppData\Local\Temp\launchboard-release-ui-responsive; the one-off Playwright runner deployment/quick-capture-responsive-qa.mjs is ignored by Git.

### Frontend issue found and fixed
- The browser pass exposed a focus timing issue: the spotlight attempted to focus its primary action before the positioned callout had rendered. On replay this could leave focus outside the spotlight and make Escape dismissal unreliable.
- FeatureSpotlight now waits for the layout render before moving focus to "Try Quick Capture". A regression test asserts focus is moved into the spotlight and Escape dismisses it.

### Verification after the fix
- Targeted Vitest: **55/55 passed across 4 files** (What'sNew, FeatureSpotlight, App, and ApiModeApp tests).
- Frontend TypeScript check passed.
- Vite 6.4.5 production build passed; **1,644 modules transformed**.
- Dedicated Playwright responsive sweep passed all four viewports for both What's New modes and the signed-in spotlight, with zero browser errors.
- git diff --check passed; Git emitted only its existing LF-to-CRLF working-copy warnings.
- The full ~1,280-test suite was not repeated in this pass. The prior release-readiness audit records 668/668 frontend and 612/612 backend tests passing; this pass added targeted coverage for the changed UI and focus behavior.

### Git and deployment boundary
- Branch remains feature/quick-capture-v1.3, HEAD db155ff; origin/main still points at the same baseline. A read-only git ls-remote check found no remote feature/quick-capture-v1.3 branch yet.
- No files are staged. Product changes remain local/uncommitted. The temporary browser runner and screenshot folder are not Git release inputs.
- No commit, push, deployment, Vercel environment change, or database operation was performed.
- The production deployment blockers recorded in the preceding readiness audit remain open: final approval/removal of temporary CAPTURE_PREVIEW_ENABLED and test-origin settings; verification of the real deployed lb_app account's directly scoped grants through an approved secure path; restore-test of the post-migration backup; and candidate-specific API-mode/TiDB preflight, authenticated production acceptance, and production smoke after an explicitly approved deployment.
- Vercel deployment history still showed CLI-origin releases and no confirmed GitHub repository integration. A GitHub push must not be assumed to trigger deployment automatically.

**Current decision:** the local frontend candidate has passed focused integration, responsive, type-check, and production-build gates. It is ready for deliberate Git file selection/review and a later commit/push, but the full production deployment is **not yet cleared** until the open database/runtime and Vercel environment gates above are resolved.


## 2026-11-07 - Prebuilt package refresh and TiDB API preflight

- Rebuilt the API-mode frontend after the responsive/focus changes (Vite 6.4.5, 1,644 modules), rebuilt the Vercel catch-all handler for Node 24, and refreshed deployment/assets, deployment/index.html, deployment/release-stage, deployment/upload-manifest.json and deployment/api-bundle.b64.
- The staged package contains the current hashed JS/CSS assets, index.html, favicon.svg, package.json, vercel.json, and the newly bundled API handler.
- A local verifier checked all **7 upload-manifest entries**: decoded byte count and SHA-1 match the manifest, every staged file matches the same size/hash, and all asset references in index.html are included in the manifest.
- The fresh bundled API preflight passed /api/health, /api/ready against the configured TiDB connection, and /api/auth/pre-session with the expected production CSRF bootstrap/cookie. SMTP was intentionally removed for the check; no email was sent, and no user, account, or opportunity records were created or modified.
- This clears the earlier "API-mode bundle/TiDB preflight not run" item. It does **not** replace authenticated CRUD acceptance, direct verification of the real deployed lb_app account's scoped grants, or production smoke against the new deployment.
- The post-migration backup still needs a separate restore test. Production CAPTURE_PREVIEW_ENABLED and the temporary Quick Capture trusted origin still need an approved final-value decision.
- No credential values were displayed or changed. No Git commit, push, Vercel upload/deployment, domain change, or database mutation was performed.

**Updated release decision:** the local API-mode package and its checksum manifest are current and preflighted. Production deployment is still blocked on the outstanding runtime-grant, backup-restore, and final environment/approval gates listed above.


## 2026-11-08 - Persistent Vercel QA Preview deployed

### Deployment
- **Persistent test URL:** https://launchboard-quick-capture-test.vercel.app
- **Immutable deployment URL:** https://launchboard-232ccd5rx-youssef-workplace.vercel.app
- **Vercel deployment:** dpl_AQyCimADTmQouff6r7eLHqLKNox2 — READY, Preview target (confirmed in the Preview deployment listing), Frankfurt function region (fra1).
- Deployed the current local, uncommitted v1.3 candidate from the regenerated seven-file prebuilt package. Vercel completed the build and marked it READY.
- The existing launchboard-quick-capture-test.vercel.app alias was reassigned from the prior deployment to this Preview deployment. The canonical launchboard-drab.vercel.app domain and the separate production deployment remain assigned as before.
- The test alias is persistent; users can revisit it without creating another deployment. Future code changes still require a new immutable Preview deployment and reassignment of this same alias to the new deployment.

### Preview environment configuration
- Created Preview-only APP_BASE_URL and TRUSTED_ORIGINS values for the test alias, VITE_DATA_MODE=api, NODE_ENV=production, and a dedicated Preview-only CSRF signing secret.
- Added Preview as a target for the existing TiDB connection variables (DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD, DB_SSL) without retrieving or changing their stored values. This intentionally connects the test deployment to the same live launchboard database used by Production, as approved by the user.
- CAPTURE_PREVIEW_ENABLED was already true on Production before this deployment. Its existing value was not changed; Preview was added as an additional target.
- SMTP credentials (SMTP_USER, SMTP_PASS) remain Production-only and were deliberately not added to Preview. The test deployment therefore does not send verification or password-reset emails. Use an existing verified account to sign in; email-based account recovery/verification must be tested on the approved mail-enabled environment.
- The project currently has no Vercel password or SSO protection enabled. The test hostname is reachable publicly, although application records remain behind Launchboard authentication. Do not share the test link publicly.

### Live checks completed
- Test homepage returned HTTP 200 and served the expected v1.3 JS/CSS assets.
- /api/health returned HTTP 200 (status: ok).
- /api/ready returned HTTP 200 (status: ok, db: ok), confirming that the Preview function reached TiDB.
- POST /api/auth/pre-session with the test-origin header returned HTTP 200, a pre-auth context, a CSRF token, and the expected __Host-launchboard_pre_session cookie. Token and cookie contents were not logged.
- Vercel runtime error query for the recent 30-minute window returned no error clusters.
- No login was performed because the user's password was not supplied. No CRUD, signup, user creation, opportunity creation/edit/delete, email sending, or database mutation was performed during deployment verification.

### Important shared-database warning
- This Preview is not data-isolated. When the user signs in, it accesses the same account and opportunity records as the live production app. Any create/edit/archive/delete/import/restore action performed from the test site can affect real Production data for that account. Keep tests non-destructive or use clearly labelled temporary records and clean them up manually only after the user confirms.
- The Preview DB credentials are project-scoped to Vercel's Preview environment. The existing Production values were not changed, but these same DB credentials are now available to Preview deployments in this project. Avoid creating unrelated Preview deployments from unreviewed code.

### Release boundary
- No production deployment was created, promoted, or changed. No production domain was reassigned. No Git commit, push, or database mutation was performed.
- The previous local production-preflight checks still stand; this Preview deployment does not clear the separately documented production runtime-grant, post-migration backup restore-test, or production acceptance gates.
- Keep this stable test alias for future manual acceptance. When a new reviewed test build is needed, regenerate the seven-file prebuilt package, deploy as Preview, verify it, then reassign the stable alias. Do not use production deployment or promote this deployment as part of testing.

**Current decision:** persistent QA Preview is deployed and its homepage, API health, database readiness, and pre-auth bootstrap are verified. It is ready for the user to sign in with an existing verified account and perform controlled manual testing, with the shared-production-data and disabled-email limitations above.


## 2026-11-08 — Standard pre-production QA workflow

- **Default manual QA environment:** https://launchboard-quick-capture-test.vercel.app
- This stable alias is the project's normal user-facing acceptance-test environment. Use it to test every reviewed release candidate before considering a Production deployment.
- For each new candidate: build the reviewed code, deploy it as a Vercel **Preview** deployment (never Production), verify the deployment and its API/database readiness, then reassign the same stable QA alias to that Preview deployment. The alias remains the link the user uses; the underlying immutable deployment changes per candidate.
- The user performs manual acceptance on the stable QA URL. Production deployment is a separate step and must wait for explicit approval after QA. Never promote the QA deployment, point the production domain at it, or make a Production deployment as part of testing.
- **Data-isolation warning:** Preview intentionally shares the live Launchboard TiDB database. It is not a sandbox. Any saved create/edit/archive/delete/import/restore action in Preview can change real account data also visible in Production. Default manual checks should remain non-destructive; only use clearly labelled temporary records after explicit user approval and clean them up only with approval.
- **Email limitation:** SMTP credentials remain Production-only. Use an existing verified account on Preview; password-reset and verification email flows are not testable there.
- **Access limitation:** the stable QA hostname is publicly reachable and has no Vercel password/SSO gate. Application records require Launchboard authentication, but the URL must not be shared publicly.
- Quick Capture is opened from the **Quick Capture** button in the app's top bar (there is no direct dialog URL). Test URL extraction and the review/edit step on Preview; do not select **Save opportunity** unless intentionally creating a real record in the shared live database.
- This workflow is the default until a separately isolated test database/environment is provisioned. Do not silently change Preview to Production or assume a Preview deployment is data-isolated.


### Temporary Production Quick Capture settings — cleanup still open (2026-11-08)

- A read-only Vercel environment metadata check (without decrypting secrets) confirmed that `CAPTURE_PREVIEW_ENABLED=true` currently targets both Preview and Production. Its comment identifies this as temporary enablement for authenticated Quick Capture testing and says to restore it to false after testing.
- Production `TRUSTED_ORIGINS` also still contains the QA Preview hostname; Preview has its own QA-only trusted-origin value.
- These settings were **not changed** during this documentation/QA task. Do not treat this as approval to change Production.
- After the user finishes QA, review and explicitly approve the Production cleanup: set `CAPTURE_PREVIEW_ENABLED=false` for Production and remove the QA hostname from Production `TRUSTED_ORIGINS`, while retaining the required Preview configuration. Verify both target scopes afterward without exposing secrets.


## 2026-11-08 — User Preview QA: Quick Capture provider and provenance review

The user tested Quick Capture on three real public job postings through the persistent Vercel Preview and supplied the review-form source labels. All three runs reached the **ready** state (title + company present).

### User-reported results

- **Ashby — Chatbase:** Title, posted date, locations, department, team, workplace type, employer employment type and description were attributed to the Ashby Public Job Postings API with high confidence. Company/client was attributed to Schema.org JobPosting JSON-LD with high confidence.
- **Workable — EVA Pharma:** Title, company/client, posted date, locations, employer employment type and description were attributed to the Workable public careers feed with medium confidence. Department, team and workplace type had no source attribution in the supplied report.
- **Lever — SOUM:** Title, locations, team and workplace type were attributed to the Lever Public Postings API with high confidence. Company/client, posted date, employer employment type and description were attributed to Schema.org JobPosting JSON-LD with high confidence. Department had no source attribution in the supplied report.

### Assessment

- This is a successful initial multi-provider adapter/provenance pass: three distinct ATS integrations returned enough information to open the review stage.
- Field-level provenance is visible and distinguishes provider API data from Schema.org fallback data. Mixing sources per field is expected and is preferable to pretending one provider supplied every field.
- Workable's medium-confidence labels are conservative; Ashby and Lever report high confidence for the sources shown. Do not inflate confidence without adapter-specific evidence.
- Unattributed/missing fields should remain blank rather than being guessed.
- The Launchboard **Type** selector (Internship / Full-time / Part-time / Freelance) is a user classification; **Employer employment type** is a separate extracted field. Do not automatically conflate them or infer the user's opportunity type without a separately approved mapping.
- The generic ready-state text ("We found a title and hiring organization") is consistent with the ready condition: both required fields were present. It does not imply all optional fields were extracted or independently verified.

### Evidence limitation and remaining QA

- The supplied copy/paste contains source labels but not the actual populated field values. Therefore title/company/date/location/description content accuracy, field cleanliness, and whether values are assigned to the right fields have **not** yet been independently assessed from this report.
- Next acceptance check: visually inspect populated values on each review form, especially date format, location order, employer identity, description text and consistency with the original posting. Check any field attributed to JSON-LD against the same exact posting page.
- Also check that fields with no supplied source remain empty, manual type/status/priority choices behave as intended, and failed/unsupported extraction preserves the original URL for manual review.
- Do not click Save opportunity on Preview unless intentionally creating a real record: Preview shares the live Production TiDB database. No conclusion about persisted-record correctness is made from this provenance-only report.

**Decision:** provider extraction and per-field provenance are **initially accepted for these three examples**. Full content accuracy and save/persistence acceptance remain open.


## 2026-11-08 ? LinkedIn compatibility probe (HISTORICAL; SUPERSEDED)

The original anonymous-page probe showed that three public LinkedIn URLs exposed only partial, low-confidence page metadata (and one request was blocked). A later local title-pattern experiment separated a title and employer for two samples, but that experiment still depended on the server fetching LinkedIn. That implementation was removed before the v1.3.0 production release and must not be restored.

Current behavior is documented in the v1.3.0 release note: LinkedIn hosts are blocked before any server-side network lookup; the UI retains the original URL and directs the user to manual entry. No LinkedIn cookies, credentials, session reuse, undocumented endpoints, scraping libraries, authwall workarounds or bot-control circumvention are used.

## 2026-11-08 — LinkedIn broader-coverage feasibility assessment (RESEARCH ONLY)

### Platform/API findings
- LinkedIn Help explicitly says third-party crawlers, bots, browser extensions and other software must not scrape/copy the Services or automate activity. It warns that using prohibited tools can lead to account restriction or shutdown: https://www.linkedin.com/help/linkedin/answer/a1341387/prohibited-software-and-extensions
- LinkedIn API Terms define Non-Official Content as content obtained through scraping, crawling, spidering or other software/technology accessing LinkedIn outside its APIs, and restrict access, storage and display of that content: https://developer.linkedin.com/legal
- The documented LinkedIn Job Posting API is intended for approved ATS/job-distribution partners to create, update, renew or close job listings; it is not a general job-seeker API for retrieving/searching LinkedIn listings. LinkedIn's current overview says it is not accepting new partnerships for this Job Posting API and directs prospective access requests to Apply Connect. Access is restricted to approved developers under an API agreement: https://learn.microsoft.com/en-us/linkedin/talent/job-postings/api/overview
- **Do not expand automated LinkedIn page fetching, undocumented endpoints, scraping libraries/services, cookies, logged-in sessions, authwall workarounds or browser automation.** No supported general read/search API for job listings was identified in the official documentation reviewed.

### Current implementation status
- The earlier title-pattern fallback was removed before the v1.3.0 deployment because it depended on the generic server-side fetcher reading LinkedIn pages.
- LinkedIn URL detection and the LinkedIn-specific manual-entry path are implemented in v1.3.0. The server rejects LinkedIn hosts before network lookup.
- The remaining future candidates are user-pasted job-details parsing and an optional separately supplied employer/ATS URL. Neither is implemented in v1.3.0.

### Recommended compliant coverage strategy

**Option A — Employer/ATS application URL (best structured coverage)**
- Keep the user's original LinkedIn URL as the saved Opportunity URL.
- Offer a separate optional employer/application-page URL solely as the metadata source. The user opens the LinkedIn Apply destination, copies the external employer/ATS link, and provides that link to Launchboard.
- When that external link belongs to an already supported provider, reuse the existing ATS adapter instead of accessing LinkedIn. Current provider adapters include Greenhouse, Ashby, Workable, Lever, SmartRecruiters, Workday, BambooHR, Breezy, Teamtailor, Personio and Rippling.
- Merge the ATS metadata into the review form but preserve the original LinkedIn URL as the saved opportunity link. Keep provenance tied to the actual ATS provider. If the external URL is unsupported or blocked, continue to Option B/manual entry.
- This is expected to provide the strongest structured field coverage, but only when the employer exposes the listing on a supported, publicly accessible ATS page.

**Option B — User-pasted job details (broadest fallback)**
- Add an optional paste box. The user manually copies the visible job details/description in LinkedIn and pastes them into Launchboard. The text parser processes only the text the user supplied; it makes no request to LinkedIn and does not automate/capture the LinkedIn page.
- Prefer deterministic, labelled-field parsing and conservative section boundaries. Do not use an LLM or external scraping service for this first pass.
- Candidate fields that can be recovered when the copied text explicitly contains them:
  - Title and employer/company.
  - Primary and additional locations.
  - Workplace type (Remote / Hybrid / On-site).
  - Employer employment type (Full-time / Part-time / Internship / Contract, etc.).
  - Posted date, including relative wording only when its reference date is unambiguous.
  - Free-text advertised compensation; structured minimum/maximum/currency/interval only where the numeric range and units are explicit.
  - Job description, extracted between recognised section headings and bounded by length.
  - Department/team only when an explicit label/value is present.
  - External application URL only if the user includes/pastes it as a distinct link.
- Source evidence must say **User-pasted job details** (not LinkedIn API). Use conservative confidence and let the user review everything. Missing or ambiguous values remain blank.
- Keep Launchboard's own Opportunity Type, Status and Priority as user decisions. Do not infer them from the employer's employment-type label. Never infer Deadline or Follow-up date. Tags may remain user-entered in the first pass.

### Suggested scope for the next implementation (not yet approved/implemented)
1. LinkedIn URL detection and a LinkedIn-specific explanation; do not send the LinkedIn URL to the server-side fetch service.
2. Add a paste-text extraction step with a new evidence source such as `user-pasted-text`, explicit confidence labels and deterministic field tests.
3. Add an optional separate employer/ATS URL path which calls only the existing supported ATS adapters. Preserve the LinkedIn URL in the saved Opportunity.
4. Test multiple copy layouts and incomplete/ambiguous examples. Verify all missing values stay blank and source labels never claim API/LinkedIn verification.
5. Deploy the reviewed implementation to the persistent Preview only after tests pass; no Production deploy without approval.

**Feasibility decision:** broad field coverage is achievable through a combination of user-pasted details and an optional supported employer/ATS URL. A compliant full LinkedIn-native automatic reader is not currently available to this project through the official public API documentation reviewed.

**Research boundary:** no code, API, database, Vercel setting, deployment, Git staging, commit or push was changed during this assessment.


## v1.3.0 production release — 8 November 2026

- **Release:** Quick Capture v1.3.0; Git release tag ui-v1.3.0; production application at https://launchboard-drab.vercel.app. The production deployment is READY: dpl_4ePAkd6wgGTDMz1qmCEKKo8TKRiX, built from commit 4c1b3a035cb6a7c2507b546456d3edd39a0710e3; production aliases are listed in the current deployment checkpoint above.
- **Scope:** review-first metadata suggestions from supported public employer/ATS pages, field-level provenance/confidence, editable structured job details, duplicate warnings, manual fallback, and the in-app release spotlight/history.
- **LinkedIn safety:** LinkedIn job/detail/search/regional URLs are rejected before any server network request. The UI preserves the pasted URL and sends the user to manual entry. The former page-title parsing special case was removed. No LinkedIn page content is fetched, scraped or copied by Launchboard.
- **Database:** migration 005_opportunity_job_details.sql was already present in the live migration history; it was not rerun during this deployment. No opportunity data was modified by this release process.
- **Edge protection:** the existing active Vercel WAF rule remains in place for POST /api/capture/preview (five requests per 60 seconds per IP, deny after limit). No WAF change was required for this release.
- **Production environment metadata:** CAPTURE_PREVIEW_ENABLED and TRUSTED_ORIGINS were inspected without decrypting secrets and were not changed during this release. The temporary QA-origin cleanup remains a separate operational item; do not expose or copy secret values.
- **Final post-correction route checks passed:** `/` and `/login` returned HTTP 200; `/api/health` and `/api/ready` returned HTTP 200 (`db=ok`); unauthenticated `/api/auth/me`, `/api/auth/csrf`, `/api/opportunities` and `POST /api/capture/preview` returned expected 401 guards; synthetic `POST /api/auth/login` reached the pre-auth guard and returned 403. No real credentials or authenticated session were used.
- **Vercel build:** the root install command is npm ci --include=dev so workspace TypeScript/Vite build dependencies are present. Vercel built the 1,644-module Vite application and deployed the API catch-all in Frankfurt. The final catch-all ES2020 TypeScript check passed; no Array.at compiler diagnostics remained.
- **Automated verification:** frontend/domain 670/670 tests, server 615/615 tests, frontend TypeScript check, server TypeScript check, Vite production build (1,644 modules), and server production build passed.
- **User-data/auth boundary:** no real account credentials or authenticated session were used; no production CRUD test, account mutation, opportunity save, migration execution or destructive Preview test was performed. The persistent Preview shares the production TiDB database.
- **Remaining limitation:** the three user-tested Preview examples (Ashby/Chatbase, Workable/EVA Pharma, Lever/SOUM) reached the ready review state, but the report contained provenance labels rather than complete field values. Complete content accuracy and a fresh authenticated production browser acceptance are not claimed. The separate post-migration backup restore and live runtime-grant audit remain outstanding checks.

The concise version history is maintained in `docs/v1.2-release-notes.md`, `docs/v1.3-release-notes.md`, and `docs/v1.3.5-release-notes.md`. Detailed v1.2/v1.3 design and staged implementation documents are intentionally retained only in the local working copy.


## 2026-11-10 — Account Settings implementation design snapshot (historical; migration status superseded below)

This section records the original implementation/release-gate snapshot from before the backup and migration work later on 10 November. Its statements that migration 006 was pending are superseded by the later **“Fresh Launchboard backup verified; migration 006 applied”** section.

### Scope implemented locally
- **Profile:** authenticated users can set an optional display name (80 characters maximum). It appears in the signed-in header and mobile account panel. The sign-in email is displayed read-only.
- **Email boundary:** email changes are intentionally not exposed. A future email-change flow must verify ownership of the new address before changing the login identifier and invalidating/replacing sessions.
- **Password:** users must provide their current password and a new password that satisfies the existing 15-character policy. The update uses a conditional write to avoid overwriting a concurrent password change, revokes all other active sessions, preserves the current session, and attempts a password-change notification email without rolling back the committed update if delivery fails.
- **Account deletion:** requires current-password verification and the exact word DELETE as confirmation. In one transaction, the user's interviews are removed first because the schema restricts deletion of contacts still referenced by interviews; then the user row is deleted and existing foreign-key cascades remove sessions, opportunities and remaining opportunity-owned records. The current session cookie and client-side authenticated CSRF state are cleared after success. The UI warns users to export a backup first.
- **Mutation protections:** account mutations require the existing authenticated session, exact trusted Origin, JSON content type and authenticated CSRF token. Profile updates, password changes and account deletions have separate IP rate limits.
- **Database:** new additive migration 006_account_profile.sql adds users.display_name with an empty default for existing users.

### Release gates — status at the original implementation checkpoint (migration status superseded below)
1. Make and verify a current backup of the dedicated Launchboard database before applying migration 006. Do not use the persistent Vercel Preview as a sandbox; it shares Production TiDB.
2. Run the migration verifier and confirm the selected database is exactly launchboard. Apply migration 006 once through the documented migration account/process, then verify the recorded migration and new column. Never print or copy database credentials into logs.
3. Run the full frontend/domain and server suites, strict TypeScript checks, frontend production build, server production build and git diff --check.
4. Deploy a candidate Preview from the exact reviewed source SHA. Confirm Vercel deployment source SHA matches, SPA routes load, and /api/health, /api/ready, /api/auth/me, /api/account/profile, nested auth routes and the opportunity API reach the intended handlers. Expected unauthenticated 401 responses prove route reachability only.
5. After Production deployment, repeat the route checks on the canonical Production domain and perform a non-destructive signed-in profile read/update only with explicit user approval. Do not test account deletion or password changes against a real account as part of routine release smoke.
6. Keep migration and deployment status separate. Until migration 006 is applied and verified, the new server code must not be promoted to a runtime that reads users.display_name.

**Historical status at this point in the log:** source and tests were prepared locally and migration 006 was still pending. The later 10 November backup, restore and migration record below supersedes that database status. The application source remains local and undeployed.


## 2026-11-10 — Settings release candidate prepared locally (NOT COMMITTED / NOT DEPLOYED)

### Account Settings delivered in the local working tree
- Authenticated **Profile** section: optional display name (maximum 80 characters), email address shown read-only, verified status shown, and the display name is reflected in the desktop account header and mobile account menu.
- **Change password:** requires the current password and the existing 15-character new-password policy. The password write is conditional on the previously verified hash, the current session is rechecked in the transaction, all other active sessions are revoked, and a best-effort password-change notice is sent. The current browser session is retained.
- **Delete account:** requires the current password and the exact uppercase word DELETE. The current session is rechecked inside the transaction. Interviews are deleted first because their composite contact reference uses ON DELETE RESTRICT; the user row is then deleted so user/session/opportunity/action-token cascades can complete. The current session cookie and client CSRF state are cleared after success. The UI clearly advises exporting a backup before deletion.
- Account mutations use the authenticated session, exact trusted Origin, JSON content type, authenticated CSRF token, strict input schemas and separate IP rate limits.
- Email changes are intentionally not exposed; changing a login email needs a dedicated verify-new-address flow.

### Database change originally prepared (historical status at this checkpoint)
- New additive migration: `server/database/migrations/006_account_profile.sql`.
- Adds `users.display_name VARCHAR(80) NOT NULL DEFAULT ''`; existing users receive an empty display name without changing login identifiers.
- The live-schema verifier now requires this exact new column and migration 006.
- **At the time this section was first written, migration 006 had not been run.** The later 10 November backup, restore and migration section below records its successful application and verification.

### Full local verification
- Frontend/domain: **681/681 tests passed across 57 files**.
- Backend: **628/628 tests passed across 38 files**.
- Frontend TypeScript/Vite production build: passed (Vite 6.4.5; 1,645 modules).
- Strict server TypeScript check: passed.
- Server production TypeScript build: passed.
- `git diff --check`: passed (Git emitted only the known LF-to-CRLF working-copy notices).
- A first unconstrained frontend run hit one 5-second timeout in the Action Center task-limit test; that file passed in isolation (10/10), then the complete suite passed with two workers. This is recorded to distinguish the resolved test-load timeout from a functional defect.

### Prebuilt package prepared and checked locally
- Rebuilt the frontend explicitly with `VITE_DATA_MODE=api` (Vite 6.4.5; 1,645 modules). The staged JS asset is `assets/index-BmgfBWIf.js`; CSS is `assets/index-BYgL9hDC.css`.
- Corrected `deployment/build-api.mjs` to bundle the actual `api/[...].ts` source entry point; the previous script referenced a non-existent `api/[...path].ts`.
- Rebuilt the Node 24 Vercel handler at `deployment/api/[...].js`.
- Regenerated `deployment/upload-manifest.json` and `deployment/api-bundle.b64`.
- Rebuilt the clean, ignored `deployment/release-stage/` folder from the API-mode frontend output, current favicon, runtime package, Vercel routing config and bundled API handler.
- Added `deployment/verify-upload-manifest.mjs`. It verifies manifest payload sizes/SHA-1 values against the staged files, verifies every staged file has a manifest entry (and no stale extras), checks that HTML asset references are present, confirms the Node 24/Argon2 runtime package, and ensures the nested API rewrite precedes the SPA fallback.
- Local release preflight result: **PASS — 7/7 manifest files and staged checksums verified**. No network calls or database operations were performed by this verifier.

### Release boundary at the original implementation checkpoint (historical; current status below)
- Branch remains `feature/quick-capture-v1.3`. All changes are local and uncommitted; existing pre-existing worktree changes were preserved.
- **No commit, push, Vercel deployment, alias change, environment-variable change or database migration was performed.**
- Do not deploy this candidate until migration 006 has been backed up, applied to the dedicated `launchboard` database using the separate migration account, and verified by the updated live-schema verifier.
- The persistent QA Preview shares Production TiDB and is not an isolated test database. Do not use it for destructive Settings checks. A deployment smoke may verify unauthenticated route reachability, but password changes and account deletion must not be exercised against a real account.
- After explicit release approval, review the intended Git file set, create a reviewed candidate commit, deploy an exact-SHA Preview, and run the documented SPA/API checks. Migration 006 is already applied and must not be run again. Decide separately whether to deploy Production.

**Current decision at this historical checkpoint:** Account Settings implementation, local tests, strict checks, production builds and prebuilt upload package were ready locally. At that time, the candidate was not committed, pushed, migrated or deployed. The later 10 November record below supersedes the migration status: migration 006 is now applied and verified; the application remains uncommitted, unpushed and undeployed.


## 2026-11-10 — Branded account emails added to the local Settings candidate

- Added a shared, responsive, table-based Launchboard email design with a teal action button, clear security copy, a plain-text fallback and a consistent automated-message footer.
- Applied the templates to new-account email verification, resend verification, password-reset requests, and the password-change notices sent after a reset or an Account Settings password change.
- Preserved the existing verification/reset fragment URLs, one-time-token behavior, and expiries (24 hours for verification; one hour for password reset). The plain-text version keeps the raw fallback URL on its own line.
- Extended the email service to send optional HTML alongside the plain-text part through the existing Gmail SMTP transport. No SMTP configuration or secret values were changed.
- Added template and delivery tests, and strengthened registration/recovery route assertions.
- Post-email verification: **632/632 server tests passed across 39 files**; strict server TypeScript check and production server build passed.
- Rebuilt the Vercel API bundle and refreshed deployment/release-stage/api/[...].js, deployment/upload-manifest.json, and deployment/api-bundle.b64. The upload-manifest preflight passed for all seven files.
- The frontend assets were unchanged by this server-only update. No email was sent during verification.
- **Release boundary unchanged:** no commit, push, migration, deployment, Vercel configuration change, or live database access was performed.


## 2026-11-10 — Fresh Launchboard backup verified; migration 006 applied

### Backup and isolated restore
- Created a fresh TiDB Cloud Serverless export for the exact `launchboard.*` table filter on cluster `10974878170979400976` (Launchboard, Frankfurt, TiDB v8.5.3). Export ID: `exp-vdelffobrbacnllfxg4733ygbq`; snapshot timestamp: `2026-11-10T20:46:27.208Z`; format SQL/GZIP; target LOCAL; provider task state SUCCEEDED.
- Downloaded to `C:\\Users\\Youssef\\Documents\\LaunchboardBackups\\Launchboard-pre-migration-006-2026-11-10`. TiDB reported 24 files downloaded successfully, 0 skipped, 0 failed.
- Created `MANIFEST.sha256.txt` with SHA-256 hashes for all compressed files and their decompressed SQL content. Integrity check passed: 24 GZIP streams decompressed, 14 table schemas identified, migration history was 001–005. Total compressed size 21,601 bytes; decompressed SQL size 50,333 bytes.
- Restored the backup into a disposable MariaDB 10.11.16 instance bound only to `127.0.0.1:33118`, with its own temporary data directory. Restore verification passed: 14 tables, migration history exactly 001–005, and no `users.display_name` column before migration. Restored row counts: users 5; sessions 33; auth_pre_sessions 62; auth_action_tokens 8; opportunities 13; opportunity_locations 6; opportunity_tags 17; opportunity_deletions 5; tasks, activities, contacts, interviews and materials 0 each.
- Restore evidence is saved as `RESTORE-VERIFICATION.json` beside the backup manifest. The temporary MariaDB process and data directory were removed; the normal XAMPP MariaDB service was not touched. The provider-side export staging expires 2026-11-12; retain the local downloaded backup folder.

### Migration 006
- Confirmed TiDB cluster identity and state before connecting: cluster `launchboard`, ID `10974878170979400976`, Frankfurt, TiDB v8.5.3, ACTIVE.
- The workstation's existing local `server/.env` database target is `127.0.0.1:3306`; it was not used for this operation. The migration connection was explicitly pinned to the hosted TiDB endpoint, port 4000, TLS enabled, and database exactly `launchboard`. No `.env` values or passwords were printed or changed.
- Preflight confirmed live migration history 001–005 and matching repository checksums, 14 tables, no existing `users.display_name`, and baseline row counts of 5 users and 13 opportunities.
- The repository migration runner applied exactly `006_account_profile` and skipped the already-recorded 001–005 migrations.
- Postflight confirmed history 001–006, 14 tables, and `users.display_name VARCHAR(80) NOT NULL DEFAULT ''`. User and opportunity row counts remained 5 and 13.
- A follow-up live schema audit passed: 14 tables, 46 indexes, 13 foreign keys, zero schema failures; all migration checksums 001–006 match the checked-in SQL files.
- Read-only `SHOW GRANTS` inspection of the existing `lb_app` account passed the runtime privilege policy: `SELECT`, `INSERT`, `UPDATE`, and `DELETE` scoped only to `launchboard.*`, plus ordinary `USAGE`; no extra global privileges or GRANT OPTION. No runtime password was retrieved. Both short-lived TiDB SQL accounts used for migration and schema verification were confirmed removed.

### Remaining boundary
- This completes the backup, isolated restore, migration 006, live schema/history verification, and read-only runtime-grant audit.
- The full runtime-credential `db:verify-live` cascade probe was not run because the workstation `.env` is deliberately local XAMPP configuration and the live `lb_app` password was not retrieved. The schema and grants were verified separately without the runtime secret; the rollback-only cascade probe remains a separate check requiring an approved restricted runtime credential path.
- No application deployment, Vercel environment/alias change, Git staging, commit or push was performed. The application source and refreshed release package remain local. Do not deploy until the exact candidate source is reviewed and separately approved.



## 2026-11-10 — v1.3.5 schema release preparation: migration 007

- **Purpose:** add the `Contract` value to the opportunity tracking-type constraint required by the local v1.3.5 candidate. Existing opportunity rows are not rewritten.
- **Backup:** created TiDB SQL/GZIP export `Launchboard-pre-migration-007-2026-11-10` for exact table filter `launchboard.*` (cluster `10974878170979400976`). Export ID `exp-vxgqmsqjobe3rlfr2cnffvqvgi`; snapshot `2026-11-10T21:24:02.07Z`; provider state SUCCEEDED. Downloaded 24/24 files (0 skipped, 0 failed). Local folder: `%USERPROFILE%\Documents\LaunchboardBackups\Launchboard-pre-migration-007-2026-11-10`. The SHA-256 manifest covers compressed files and their decompressed SQL; all 24 GZIP streams decompressed and 14 table definitions were identified. Pre-migration history was 001–006. This backup was integrity-checked but not separately restored; the earlier pre-006 backup had the isolated MariaDB restore.
- **TiDB DDL compatibility finding:** TiDB v8.5.3 rejects dropping and adding a CHECK constraint in one ALTER TABLE (`Unsupported multi schema change for drop check constraint`). Migration 007 therefore uses two ordered statements: drop the existing named constraint, then add the same constraint with Contract included. A short-lived test table verified this two-statement sequence and was dropped. No opportunity table changes were made by the probe.
- **Application:** the repository migration runner verified `DATABASE() = launchboard` and migration history 001–006 before applying only `007_opportunity_contract_type`. It logged `Applied 007_opportunity_contract_type` and skipped six previously recorded migrations.
- **Postflight:** TLS read-back using mysql2 confirmed hosted TiDB v8.5.3, migration history 001–007, `tidb_enable_check_constraint = 1`, and the actual `SHOW CREATE TABLE opportunities` definition includes Contract in `chk_opportunities_type`. User and opportunity row counts remain 5 and 13.
- **Temporary credentials:** the dedicated short-lived migration SQL user was deleted; the SQL-user listing returned to the pre-existing accounts. No runtime password or `.env` value was retrieved or displayed.
- **No user data CRUD:** no opportunity or user rows were added, edited or deleted. The local XAMPP database was not used or changed.

**Release boundary:** migration 007 is applied and must not be rerun. The application candidate still requires the exact-SHA Preview verification and Production deployment sequence described above.


## 2026-11-10 — v1.3.5 Preview compiler compatibility correction

- Initial exact-SHA Preview: `dpl_4xgtrDa19txGhULPsrrKwbYqUBT1`, URL `https://launchboard-dongmhbmx-youssef-workplace.vercel.app`, source SHA `a8457dd89e5e293465efb8a9a68bffbd9b7045b1`.
- Vercel completed deployment and marked it READY, but its build log emitted a TypeScript `TS2550` diagnostic: `String.replaceAll` in the new email HTML escaper was outside the API catch-all's ES2020 library target. This Preview is not accepted as release evidence despite the READY state; Production was not deployed from it.
- Replaced those five escaping operations with equivalent global regular-expression replacements, which are ES2020-compatible. A repository search confirmed no remaining `replaceAll(` usage in server source.
- Post-correction local checks: backend **633/633** across 39 files; strict server typecheck passed; server production build passed. The next Preview must be built from the corrected follow-up commit and inspected for absence of this compiler diagnostic before any Production deployment.
