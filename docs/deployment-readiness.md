# Launchboard deployment

## Current production deployment

Last checked: **8 November 2026**.

- **Application:** https://launchboard-drab.vercel.app.
- **Hosting:** Vercel Hobby, Node.js 24.x, Frankfurt region (fra1).
- **Database:** TiDB Cloud Serverless, database launchboard.
- **Latest production deployment:** dpl_2AS7rWRJZVU4YAr8nNyR3bHuWY2D (READY, production target).
- **Deployed Git commit:** 898a743d18af128f6dea1d21013623ba74744201 (fix: align capture types with Vercel API target).
- **Immutable deployment URL:** https://launchboard-kdc1pt0iy-youssef-workplace.vercel.app.
- The v1.3.0 production release includes Quick Capture, supported employer/ATS public page suggestions, field-level provenance, structured job details, duplicate warnings, manual fallback and the in-app What's New experience. LinkedIn URLs are retained for manual entry; automatic LinkedIn access is disabled.

### Post-deployment read-only smoke

- Canonical homepage: HTTP 200.
- Referenced JavaScript and CSS assets: HTTP 200.
- /api/health: HTTP 200 (status=ok).
- /api/ready: HTTP 200 (status=ok, db=ok).
- Unauthenticated /api/opportunities: HTTP 401, as expected.
- Vercel deployment build completed and state is READY. The final API catch-all source was also checked with the repository's ES2020 compiler settings after replacing five unsupported Array.at() usages with equivalent index access.

No opportunity records, accounts or database schema were changed during post-deployment verification. No migration was re-run. A production authenticated CRUD test was intentionally not performed.

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

## 2026-11-08 ? LinkedIn compatibility probe (HISTORICAL; SUPERSEDED)

The original anonymous-page probe showed that three public LinkedIn URLs exposed only partial, low-confidence page metadata (and one request was blocked). A later local title-pattern experiment separated a title and employer for two samples, but that experiment still depended on the server fetching LinkedIn. That implementation was removed before the v1.3.0 production release and must not be restored.

Current behavior is documented in the v1.3.0 release note: LinkedIn hosts are blocked before any server-side network lookup; the UI retains the original URL and directs the user to manual entry. No LinkedIn cookies, credentials, session reuse, undocumented endpoints, scraping libraries, authwall workarounds or bot-control circumvention are used.

## 2026-11-08 — LinkedIn broader-coverage feasibility assessment (RESEARCH ONLY)

### Platform/API findings
- LinkedIn Help explicitly says third-party crawlers, bots, browser extensions and other software must not scrape/copy the Services or automate activity. It warns that using prohibited tools can lead to account restriction or shutdown: https://www.linkedin.com/help/linkedin/answer/a1341387/prohibited-software-and-extensions
- LinkedIn API Terms define Non-Official Content as content obtained through scraping, crawling, spidering or other software/technology accessing LinkedIn outside its APIs, and restrict access, storage and display of that content: https://developer.linkedin.com/legal
- The documented LinkedIn Job Posting API is intended for approved ATS/job-distribution partners to create, update, renew or close job listings; it is not a general job-seeker API for retrieving/searching LinkedIn listings. LinkedIn's current overview says it is not accepting new partnerships for this Job Posting API and directs prospective access requests to Apply Connect. Access is restricted to approved developers under an API agreement: https://learn.microsoft.com/en-us/linkedin/talent/job-postings/api/overview
- **Do not expand automated LinkedIn page fetching, undocumented endpoints, scraping libraries/services, cookies, logged-in sessions, authwall workarounds or browser automation.** No supported general read/search API for job listings was identified in the official documentation reviewed.

### Important review of the existing small LinkedIn title fallback
- The local LinkedIn title cleanup introduced in the preceding step still depends on the generic server-side Quick Capture flow fetching a LinkedIn URL. It uses no LinkedIn cookies or login, but it remains automated software access to LinkedIn content.
- Do not broaden or deploy that fetch-based LinkedIn behavior. Before the next Preview release, remove/disable the LinkedIn automatic-fetch exception and show a LinkedIn-specific manual-import path instead. This research pass made no source-code or deployment changes.

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

- **Release:** Quick Capture v1.3.0; Git release tag ui-v1.3.0; production application at https://launchboard-drab.vercel.app. The production deployment is READY: dpl_2AS7rWRJZVU4YAr8nNyR3bHuWY2D, built from commit 898a743d18af128f6dea1d21013623ba74744201; immutable URL https://launchboard-kdc1pt0iy-youssef-workplace.vercel.app.
- **Scope:** review-first metadata suggestions from supported public employer/ATS pages, field-level provenance/confidence, editable structured job details, duplicate warnings, manual fallback, and the in-app release spotlight/history.
- **LinkedIn safety:** LinkedIn job/detail/search/regional URLs are rejected before any server network request. The UI preserves the pasted URL and sends the user to manual entry. The former page-title parsing special case was removed. No LinkedIn page content is fetched, scraped or copied by Launchboard.
- **Database:** migration 005_opportunity_job_details.sql was already present in the live migration history; it was not rerun during this deployment. No opportunity data was modified by this release process.
- **Edge protection:** the existing active Vercel WAF rule remains in place for POST /api/capture/preview (five requests per 60 seconds per IP, deny after limit). No WAF change was required for this release.
- **Production environment metadata:** CAPTURE_PREVIEW_ENABLED and TRUSTED_ORIGINS were inspected without decrypting secrets and were not changed during this release. The temporary QA-origin cleanup remains a separate operational item; do not expose or copy secret values.
- **Post-deploy read-only checks passed:** canonical homepage and generated JS/CSS assets returned HTTP 200; /api/health returned HTTP 200 (status=ok); /api/ready returned HTTP 200 (status=ok, db=ok); unauthenticated /api/opportunities returned HTTP 401 as expected.
- **Vercel build:** the root install command is npm ci --include=dev so workspace TypeScript/Vite build dependencies are present. Vercel built the 1,644-module Vite application and deployed the API catch-all in Frankfurt. The final catch-all ES2020 TypeScript check passed; no Array.at compiler diagnostics remained.
- **Automated verification:** frontend/domain 670/670 tests, server 615/615 tests, frontend TypeScript check, server TypeScript check, Vite production build (1,644 modules), and server production build passed.
- **User-data boundary:** no production CRUD test, account mutation, opportunity save, migration execution or destructive Preview test was performed. The persistent Preview shares the production TiDB database.
- **Remaining limitation:** the three user-tested Preview examples (Ashby/Chatbase, Workable/EVA Pharma, Lever/SOUM) reached the ready review state, but the report contained provenance labels rather than complete field values. Complete content accuracy and a fresh authenticated production browser acceptance are not claimed. The separate post-migration backup restore and live runtime-grant audit remain outstanding checks.

The concise, published version history is maintained in docs/v1.2-release-notes.md and docs/v1.3-release-notes.md. Detailed v1.2/v1.3 design and staged implementation documents are intentionally retained only in the local working copy.
