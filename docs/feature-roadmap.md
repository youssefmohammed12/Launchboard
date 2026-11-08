# Launchboard — Feature Roadmap

**Updated:** 2026-11-08
**Purpose:** A simple view of the planned product updates. Versions are sequence targets, not date commitments.

Launchboard remains a personal opportunity-management and career-tracking workspace. Users find opportunities elsewhere; Launchboard helps them organize applications, manage next actions and learn from their progress.

| Version | Theme | Planned features | Status |
|---|---|---|---|
| **v1.1.0** | Responsive workspace | Responsive phone/tablet/desktop UI, navigation and layout refinements | Released |
| **v1.2.0** | **Action Center** | Tasks per opportunity, priorities, due dates, completion, overdue/Today/Upcoming/Unscheduled views, Dashboard Today section and Calendar task events | Released — production deployment and `ui-v1.2.0` Git release |
| **v1.3.0** | Quick Capture | Review-first URL capture, structured job details, field provenance, duplicate warnings and manual fallback | Released to production and tagged ui-v1.3.0 (2026-11-08); LinkedIn automatic lookup disabled, broader paste/ATS workflow deferred |
| **v1.4.0** | Better Insights | Response, interview and offer conversion; response time; best-performing source; time in stage; honest filters and sample sizes | Planned |
| **v1.5.0** | Career Resources | Reusable CV versions, cover-letter templates, certificates, portfolio links, descriptions and version references linked to each opportunity | Planned |
| **v1.6.0** | Weekly Goals & Review | Weekly application/follow-up targets, completed-task progress, stale-opportunity review and week-over-week activity | Planned |
| **v2.0.0** | Intelligent Workspace | Optional AI opportunity analysis, skill-gap suggestions and interview preparation; optional integrations introduced carefully | Future |

## Later candidates

These ideas are intentionally not committed to a release yet:

- **Company and recruiter CRM:** reusable company/contact profiles and interaction history across opportunities.
- **Email integration:** optional detection of confirmations, interviews and rejections, with user approval before changing records.
- **Chrome extension:** one-click capture from external opportunity sites, prioritizing manual confirmation and resilient capture over fragile scraping.

## Product guardrails

- No built-in job marketplace, automatic applications or social network.
- No mandatory email connection, paid API or paid storage service.
- AI and external integrations remain optional.
- Keep CSV as a spreadsheet summary and JSON as the full-fidelity backup.
- Prefer a few complete, reliable workflows over excessive charts or a large chatbot.
- Every release follows the project's staged design, implementation, focused testing, full regression, documentation and explicit deployment approval workflow.

## Current release status

v1.3.0 Quick Capture is released to production on main. The release includes the review-first URL capture UI, the supported public employer/ATS adapters, structured opportunity details, field-level source/confidence labels, duplicate warnings and manual fallback. The full v1.3.0 release scope and acceptance boundaries are in docs/v1.3-release-notes.md. LinkedIn automatic fetching is disabled; the user-pasted-details and separate ATS-URL work remains deferred. Detailed implementation plans are retained in the local working copy.

## Stage 2 Vercel WAF publication — 2026-11-07

The user approved publishing the staged WAF rule. The CLI publish completed successfully. Post-publish expanded CLI read-back confirms the Quick Capture rule is **live**, valid and has no validation errors:
- Exact AND conditions: `method=POST` and `path=/api/capture/preview`
- Fixed window: 60 seconds; limit 5; key IP; exceeded action deny.
- Rule ID: `rule_launchboard_quick_capture_preview_rate_limit_b7wus2`.
- No remaining draft or pending changes.

A read-only environment listing confirms `CAPTURE_PREVIEW_ENABLED` remains absent (13 entries; values were not read). Managed bot settings were not changed.

**Remaining gate:** v1.3 Stage 2 route code is still local/uncommitted and has not been deployed, so no production endpoint/runtime/SSRF test has been performed. Deployment requires separate approval; keep the kill switch off until production verification. Setting `CAPTURE_PREVIEW_ENABLED=true` requires a further separate approval.


## v1.3.0 Quick Capture — Stage 3/4 completed; test deployment verified (2026-11-07)

Stage 3 review-first Quick Capture UI and Stage 4 duplicate/mode integration are implemented and regression-tested. Full suite: **639 frontend/domain + 522 server tests passed**. TypeScript checks, domain/server builds, Vite production build (1,639 modules), Vercel API bundle build and responsive smoke at 8 widths all passed.

Current isolated Vercel test deployment: https://launchboard-2irceivgv-youssef-workplace.vercel.app (`dpl_FctBXxoSUTyBdWzgzzvo9vGz1nrL`), READY in `fra1`, Node 24.x, no aliases. Static assets and favicon match source; health/readiness 200 (`db=ok`); browser sign-in/registration smoke clean; preview route returned five `503 NOT_READY` responses with no-store and the sixth was blocked by WAF (403). The only runtime errors logged were the five expected NOT_READY guards.

Stage 5 remains gated: actual metadata fetch/SSRF behavior is not run through Vercel while `CAPTURE_PREVIEW_ENABLED` is absent. The environment inventory was checked without retrieving values. Separate approval is required to enable it for an isolated authenticated production-path test. Public aliases, databases, migrations, commits and pushes remain unchanged.


## 2026-11-07 Quick Capture Stage 5 note

The actual compiled capture service was exercised over the public network on Node 24.22.2: Stripe job `Abuse Investigator` parsed as `ready` with employer `Stripe`; example.com returned safe `partial`; loopback and localhost were `blocked`.

Vercel runtime exercise remains gated. A temporary enabled deployment was unable to pass exact-origin validation because its randomly assigned hostname differed from the one in the deployed `TRUSTED_ORIGINS` snapshot. The request was rejected with 403 before authentication/fetch; no bypass was used. Temporary deployment deleted. Production `CAPTURE_PREVIEW_ENABLED=false`; `TRUSTED_ORIGINS` restored to the public origin only. WAF remains enabled and unchanged. Need user approval for a separate stable test-only Vercel alias to carry out an authenticated Vercel fetch test; public aliases remain untouched.

## 2026-11-07 — Quick Capture detection improvement and updated isolated test deployment

The user's five sample links exposed two genuine detection defects and one UI state defect. All five now return a populated preview through the actual compiled, SSRF-safe fetcher on Node 24.22.2.

### Root causes and fixes

- **Lever / SOUM and Incorta:** both pages returned HTTP 200 with valid JobPosting JSON-LD (about 6.6 KiB and 7.6 KiB), but their complete HTML documents were 724,981 and 725,166 bytes. The previous 512 KiB limit rejected them before parsing. Increased the streamed body cap to **1 MiB**, retaining pinned-DNS, timeout, redirect, content-type and size enforcement.
- **Greenhouse / SpaceX and Canonical:** these pages did not ship JobPosting JSON-LD in their server-rendered HTML. Their real description was present in the bounded .job__description section, while og:description contained only the location. The parser now extracts that semantic section and reads the employer only from Greenhouse's exact document-title convention "Job Application for <role> at <employer>". It does not infer employers from og:site_name or the job-board brand.
- **Empty/failure UI:** transport outcomes blocked, timeout, too-large and unavailable were missing from the frontend response union. A successful HTTP preview response carrying one of those outcomes could therefore render an empty status. Added typed outcome coverage, clear explanations, preserved-URL manual continuation and the correct Continue manually CTA when no fields were found. unsupported now explicitly says no opportunity information was found.

### Reproduction after fixes

| Sample | Outcome | Source | Extracted values |
|---|---|---|---|
| Stripe | ready | job-posting | Abuse Investigator / Stripe / 4,567 description chars |
| SOUM (Lever) | ready | job-posting | Backend Software Engineer / SOUM / 3,052 chars |
| Incorta (Lever) | ready | job-posting | Principle Software Engineer / Incorta / 3,785 chars |
| SpaceX (Greenhouse) | ready | page-metadata | New Graduate Engineer, Software - '26/'27 (Starlink) / SpaceX / 5,000 chars (field cap) |
| Canonical (Greenhouse) | ready | page-metadata | Graduate Software Engineer, Open Source and Linux, Canonical Ubuntu / Canonical / 5,000 chars (field cap) |

### Verification and test deployment

- Full frontend/domain suite: **644/644 tests across 52 files**.
- Full server suite: **525/525 tests across 35 files**.
- Frontend and server TypeScript checks passed; server TypeScript build passed.
- Vite production build passed (1,639 modules); API handler rebundled for Node 24.x.
- Updated isolated Vercel deployment: dpl_FwVkDxYLmc4fEUiPMbMRhDs11Nwp, READY, Frankfurt fra1; dedicated alias launchboard-quick-capture-test.vercel.app reassigned to this build only.
- Homepage and both hashed assets returned 200 and matched local SHA-256 hashes. API health and readiness returned 200 (db=ok). Preview with no session returned 401 Authentication required from the exact test origin, with Cache-Control: no-store.
- Public production alias launchboard-drab.vercel.app was not reassigned. No commit or push.

### Temporary test configuration / remaining user validation

Production env is temporarily enabled so the user can test authenticated preview on the dedicated test alias:
- CAPTURE_PREVIEW_ENABLED=true
- TRUSTED_ORIGINS contains the existing public origin plus the exact test alias.
- WAF remains enabled with the existing exact POST /api/capture/preview limit of 5 requests/IP/60 seconds.

Ask the user to hard-refresh the test alias, retry the same five postings, and confirm the UI now shows populated review suggestions. Once the user confirms, restore CAPTURE_PREVIEW_ENABLED=false, restore the public-only exact origin, remove the temporary alias and its test deployment, and verify the WAF and canonical public alias remain unchanged. No user password or session data is requested or inspected.

## 2026-11-07 — Test-host sign-in issue diagnosed and corrected

User reported that the isolated test URL was not connected to their online account and would not allow sign-in. Investigation found that the temporary frontend build had been compiled with Vite's default LocalStorage mode. API health/readiness checks had passed, but these only proved that the backend function and database were reachable; they did not prove the frontend was using API mode. This was a release verification gap.

Correction:
- Rebuilt with the explicit build-process variable `VITE_DATA_MODE=api` for this deployment only. No .env file was opened or changed.
- Rebundled the Node 24 Vercel API handler and deployed the new seven-file runtime package.
- New deployment: `dpl_8ni2SXZ4Xv8LdCikyBrXGWivEDHo`, READY, Frankfurt `fra1`.
- Reassigned only `launchboard-quick-capture-test.vercel.app` to this deployment. Public `launchboard-drab.vercel.app` remains untouched.

Fresh headless browser verification on the test alias:
- Homepage HTTP 200.
- Actual AuthScreen rendered: email input, password input, Sign in button, Welcome back heading.
- No browser-only/LocalStorage-mode screen.
- Initial `GET /api/auth/me` returned expected 401 because the test browser had no existing session.
- Pre-auth bootstrap `POST /api/auth/pre-session` returned 200 with a pre-auth CSRF token.
- The browser received the expected `__Host-launchboard_pre_session` cookie with Secure, HttpOnly, SameSite=Lax and Path=/ attributes. Cookie value was not read or logged.
- This confirms the test origin can begin the normal sign-in flow against the project's production API environment. User still needs to sign in manually with their own account; credentials/session values must not be shared.

Temporary settings remain active solely for user verification: `CAPTURE_PREVIEW_ENABLED=true` and exact `TRUSTED_ORIGINS` entries for the canonical public origin plus the test alias. WAF remains active and unchanged. After the user confirms sign-in and capture tests, restore the kill switch false, public-only trusted origin, and remove the test alias/deployment. No opportunity records, account data, database rows, public aliases, commits or pushes were changed by this correction.


## 2026-11-07 — Quick Capture ATS compatibility expansion

Implemented and verified additional vendor-native adapters in server/src/services/opportunityCaptureService.ts:
- **Greenhouse:** official public Job Board API; exact numeric posting-ID matching; returns employer and full description.
- **Ashby:** public job-board API; exact canonical job URL matching and listed-posting check. The employer is deliberately left blank where the public response does not provide a trustworthy organization field.
- **Workable:** public careers-widget endpoint; exact shortcode matching. Generic account labels such as "Company" are not presented as employer names.
- **SmartRecruiters:** public Posting API; exact company identifier and posting ID.
- **Workday:** public CXS jobs search plus exact posting detail path; no result is accepted unless its externalPath matches the submitted posting.
- Existing generic structured-data parsing continues to cover live examples from Lever, Jobvite and Personio.

The JSON transport uses the existing SSRF-safe request pipeline: validated public DNS, pinned destination IP, bounded time/body, identity encoding, no cookies or authorization, and exact/fixed ATS API origins. No browser automation, CAPTCHA bypass or anonymous proxy was added.

Data-quality improvements:
- HTTP 404 and explicit Greenhouse expired-job redirects report **Not found**.
- HTTP 410 reports **Unavailable**, because iCIMS demonstrated that 410 can accompany a portal restriction/human-verification response and is not enough evidence that the individual job was deleted.
- HTML embedded in metadata and double-escaped ATS descriptions are sanitized before being passed into the editable form.
- Generic employer labels are discarded rather than guessed.

Live benchmark: 22 public posting URLs across 11 ATS/job-board families. Final classification after the 410 correction: 12 Ready, 2 Partial, 3 Not found, 3 Blocked, 1 Unavailable and 1 Unsupported. Ready means the page supplied the required title/employer fields; Partial results intentionally leave missing fields for user review. This is a point-in-time sample, not a guarantee for every tenant or posting.

Regression/build verification:
- Full frontend/domain: 645/645 tests across 52 files.
- Full server: 541/541 tests across 36 files.
- Final focused capture/parser/transport suite: 52/52 tests.
- Frontend/server typechecks and builds passed; API handler bundled for Node 24.
- API-mode production Vite build: 1,639 modules; JS 429.01 kB, CSS 65.94 kB.

Current isolated Vercel test deployment:
- Deployment: dpl_C8pZ2i2qrDfXpU3bAtrtQFdZCASy, READY, Frankfurt fra1.
- Stable test alias: https://launchboard-quick-capture-test.vercel.app.
- The alias currently points to the deployment above. Public https://launchboard-drab.vercel.app was not moved.
- Final smoke: homepage 200; API sign-in screen shown (not LocalStorage mode); JS/CSS hashes match the built files; /api/health and /api/ready return 200 with DB ready; pre-auth bootstrap returns a CSRF token and the expected Secure/HttpOnly/SameSite=Lax cookie; unauthenticated capture returns 401 with Cache-Control: no-store.
- Production-target Vercel settings are temporarily enabled for this isolated test: CAPTURE_PREVIEW_ENABLED=true; TRUSTED_ORIGINS contains exactly the public origin and the test alias. WAF/rate-limit rule remains enabled and unchanged.
- **Still required:** user signs in manually on the test alias, then performs authenticated Quick Capture tests using representative links. Do not send credentials or session values. After verification, turn the kill switch off, remove the test origin, and remove the temporary alias/deployment as agreed.

Repository state:
- Branch remains feature/quick-capture-v1.3, HEAD remains db155ff904b31100aa171a93d879fd6a2a73abaf.
- All v1.3 work remains uncommitted; no commit or push was made.
- No opportunity/account rows or database migrations were changed by this compatibility work.

## Quick Capture pre-release polish backlog — 2026-11-07

Quick Capture needs another quality pass before release. Current compatibility testing (22 URLs / 11 families) is a baseline, not a completeness claim.

- [x] Research reusable APIs/libraries for arbitrary job URL extraction.
- [x] Confirm vendor-native API-first strategy; retain the safe HTML/JSON-LD fallback.
- [x] P0 first slice: Lever exact-posting API + merge of partial provider data with the same page's JobPosting metadata (verified locally).
- [x] P0/P1 provider integrations: Lever, Teamtailor, Breezy HR (best-effort), BambooHR (observed public routes), Personio (employer-enabled XML feed) and Rippling (observed public detail endpoint) implemented and locally verified.
- [ ] P1: reassess Recruitee only after verifying its current authentication transition and whether anonymous exact-posting lookup remains available; do not assume a universal public API.
- [ ] P1: strengthen generic JobPosting, microdata and bounded semantic fallback.
- [ ] P1: capture location, department, workplace mode, employment type, compensation and posted date; first design backwards-compatible Opportunity/API/database mapping.
- [ ] P2: field provenance/confidence and stronger review-state messaging.
- [ ] P2: broaden provider fixtures and live compatibility matrix beyond 22 sample URLs.
- [ ] P3: user-initiated browser helper for browser-visible/server-blocked pages, without bypassing CAPTCHA or access controls.

Keep parse5 (already installed) unless measured tests show it cannot meet requirements; Cheerio does not render JavaScript and mainly adds selectors. Do not add an article-focused scraper library as a substitute for ATS adapters. No paid service, commit, push or production alias change is authorized by this backlog.

## 2026-11-07 — P0 provider-first improvement: Lever adapter COMPLETE

Implemented in server/src/services/opportunityCaptureService.ts:
- Added Lever global and EU public-host detection.
- Calls Lever's documented exact single-posting endpoint, rather than scanning a board.
- Accepts a result only when both the returned posting ID and hostedUrl match the submitted job URL.
- Does not infer employer identity from the Lever site/slug.
- If the exact API response is partial, the service now also parses the submitted page and fills missing data from its same-page JobPosting metadata. The API title is retained; a longer full description can replace a shorter API summary; ambiguous fallback data is never merged.
- Existing partial Ashby and Workable results now also benefit from the stronger fallback behavior.

Live check against Lever's public demo posting through the compiled SSRF-safe service returned Ready: Customer Success Manager / Lever Demo 2, with the full page description. This is a demo board posting, not a Launchboard user record.

Important scope boundary: Lever's API also exposes location, department/team, commitment, workplace type and optional salary range. These fields are not yet passed into saved Launchboard opportunities. The current saved Opportunity model only has a compensation text field and no first-class location/workplace/department fields; structured-field mapping is a separate backlog item and must be designed backwards-compatibly rather than stuffed into tags or notes.

Verification:
- Focused capture/security regression suite: 124/124 tests across 5 files.
- Full server suite: 543/543 tests across 36 files.
- Server TypeScript check and server production build passed.
- Real compiled service + public Lever API/page check passed.
- No frontend/domain code changed in this slice; no DB schema or migration changed.

No Vercel deployment, alias, environment setting, WAF rule, user record or database row changed. No commit or push. The current isolated Quick Capture test deployment remains untouched.

## 2026-11-07 — P1 Quick Capture provider: Teamtailor COMPLETE

Added a Teamtailor adapter that discovers a same-origin `application/feed+json` endpoint from the public tenant's `/.well-known/api-catalog`, validates catalog/feed origins and routes, exact-matches one posting URL, and requires embedded Schema.org JobPosting data. Employer data is accepted only from `hiringOrganization.name`. The adapter reuses the bounded SSRF-safe JSON transport and introduces no dependency or pagination/crawling.

Validation: focused adapter suite 16/16; full server suite 546/546 across 36 files; server typecheck/build passed; live compiled service returned Ready for Polestar's public posting. No deploy, env, alias, WAF, DB, commit or push changes.

Breezy HR and BambooHR were completed in the provider slices following Teamtailor. Current next provider: Personio; confirm current vendor documentation and live public careers behavior before coding.

## 2026-11-07 — P1 Quick Capture provider: Breezy HR COMPLETE (best-effort)

Added a same-origin Breezy `/json` listing adapter for `*.breezy.hr/p/{friendly_id}` URLs. It matches the exact feed row using ID, friendly ID and posting URL, and accepts employer only from the matched row's `company.name`. The feed has no description, so the implementation forces the existing bounded exact-page HTML/JobPosting parser to run. This is an undocumented public endpoint and may change; current validation used Breezy's own trial tenant, not a real customer employer board.

Validation: focused service suite 18/18; full server suite 548/548 across 36 files; server typecheck/build passed; live compiled service returned Ready with the sample page's short meta description. No schema, dependency, deployment, Vercel setting, DB, commit or push changes.

BambooHR is now complete. Next provider to investigate: Personio. Confirm current vendor documentation and live public careers behavior before implementation.

## 2026-11-07 — P1 Quick Capture provider: BambooHR COMPLETE

Added an adapter for numeric `*.bamboohr.com/careers/{id}` pages. It matches the requested ID in the same-origin `/careers/list`, fetches the `/careers/{id}/detail`, and verifies the canonical `jobOpeningShareUrl`, open status when present, and title consistency. Title/description come from the exact detail response. The API doesn't return employer name; an opt-in parser path uses the page's explicit `og:site_name` only for same-origin BambooHR job URLs, with vendor/generic labels rejected. Generic pages still ignore `og:site_name`; no tenant-slug inference.

The two public JSON routes are observed behavior, not a documented anonymous API contract. Live service validation passed on Fly.io and Red Nucleus. Focused suites 46/46; full server suite 553/553 across 36 files; server typecheck/build passed. No dependency/model/schema/deployment/DB/Git history changes.

Next provider to investigate: Personio. Confirm current docs and live public careers behavior before coding.

## 2026-11-07 — P1 Quick Capture provider: Personio COMPLETE

Added a public XML feed adapter for numeric \`*.jobs.personio.de/job/{id}\` and \`*.jobs.personio.com/job/{id}\` links. It matches exactly one feed \`position/id\`, reads title/subcompany/description from that record, and sanitizes combined description blocks. Added \`saxes\` as an explicit server dependency and an XML response mode on the shared pinned public HTTP transport (strict XML content type, no redirects, identity encoding, 2 MiB cap, DNS pinning and no ambient credentials). DTD/entity declarations, malformed XML and resource-limit violations fail closed to the safe page fallback.

When the feed has no description, the exact page parser selects Personio \`detail-block-description\` sections. A provider-only opt-in parses the explicit \`{role} | Jobs at {company}\` title format; generic pages do not infer employer. The feed is officially documented but must be enabled by each employer.

Live compiled service checks succeeded on Chrono24 and ottonova. Focused HTTP/parser/service tests 72/72; full server suite 561/561 across 36 files; server typecheck/build passed. No saved Opportunity fields, schema, migrations, DB, Vercel settings, deployment or Git history changes.

Next provider to research: Rippling. Confirm a public anonymous posting feed and exact-detail behavior before coding.


## 2026-11-07 — Quick Capture provider coverage update: Rippling COMPLETE

The Rippling adapter is implemented locally. It accepts standard and locale-prefixed hosted posting paths on `ats.rippling.com`, calls only the exact single-job detail endpoint, and validates UUID, case-sensitive board slug and canonical posting URL before using any data. It captures title, explicit employer and the role description; the generic company introduction is not appended. If the endpoint changes or the role body is missing, the existing bounded exact-page parser remains the fallback.

This endpoint is observed anonymous public-board behavior, not a documented vendor-guaranteed contract. It adds no dependency, credential, list crawl, pagination, model field or schema change.

Verification: focused capture service 30/30; full server 566/566 across 36 files; server typecheck/build passed. Live compiled safe-service validation returned Ready on Rippling's own board and Barry's board. No deployment, WAF/environment change, database operation, commit or push occurred in this slice.

All six currently prioritized provider adapters are implemented: Lever, Teamtailor, Breezy HR (best-effort), BambooHR (observed public routes), Personio (employer-enabled official XML feed) and Rippling (observed public exact-detail route). JSON-LD, Schema.org Microdata and bounded semantic description fallbacks are also implemented; remaining data-quality work is structured metadata and backward-compatible saved-field mapping, field provenance/confidence, and expanding the live provider matrix. Keep the Vercel production-path gate and user validation separate; local adapter checks do not make v1.3 release-ready.

## 2026-11-07 — Generic parser quality: Schema.org Microdata COMPLETE

Added bounded Schema.org JobPosting Microdata extraction to the existing parse5-based generic parser. It supports nested hiringOrganization / Organization / name, title, description, URL-valued properties, standard typed element values and same-document itemref references. Non-Schema.org lookalike vocabularies are rejected. JSON-LD remains preferred when present; Microdata is used only when no JSON-LD JobPosting exists. Exact URL matching and ambiguous-list behavior are shared with the existing structured parser.

The traversal is bounded to 4,096 visited nodes, 20 nested levels and 100 JobPosting items. Overflow fails closed. No new library or persisted Opportunity field was added; the reviewed Microdata packages were archived or stale.

Verification: parser suite 35/35; full server suite 573/573 across 36 files; server typecheck/build passed. Live generic safe-service check: Stripe careers returned Ready with Software Engineer / Stripe; Amazon.jobs returned Partial with title and description but no guessed employer. Microdata-specific behavior was exercised with Schema.org fixtures; no live site was identified for a separate real-page Microdata assertion. No deploy, WAF/environment change, DB operation, commit or push.

The bounded semantic description selector slice is complete in the next checkpoint. Next priority: design structured fields and provenance/confidence, then expand compatibility fixtures. Keep exact posting identity, no-guessing rules, SSRF bounds and the current Opportunity contract.


## 2026-11-07 — Generic Quick Capture semantic description fallback COMPLETE

Expanded the bounded HTML fallback with explicit job-description selectors for pages that lack useful JSON-LD or Microdata. It supports Workday-style automation IDs, test/QA attributes, ARIA labels, IDs and narrowly allowlisted class names. Explicit markers outrank styling classes; the parser selects one unique highest-priority element and refuses to merge multiple peer matches or more than 32 candidates.

The parser deliberately ignores broad page containers and generic description classes. Personio's provider-specific sibling sections remain handled separately. Text still uses the existing sanitizer and 5,000-character field cap. No new dependency or saved Opportunity field was introduced.

Verification: parser **43/43**; full server **581/581 across 36 files**; server TypeScript check and build passed. A live Visa Workday page was handled through existing structured data, while a Procore raw page yielded no metadata; neither validates the new selector path live. No deployment, DB operation, commit or push.

Next priority: design backwards-compatible structured metadata (location, department, workplace type, employment type, compensation and posted date), including field-level provenance/confidence and UI review behavior, before touching the saved Opportunity/API/database contract.

## 2026-11-07 — Quick Capture structured Opportunity fields: architecture design COMPLETE

The next data-quality phase is now specified in `docs/v1.3-quick-capture-design.md`. It introduces ordered multiple locations, department, team, workplace type, employer employment type, posted date, and optional structured compensation details while preserving the existing free-text compensation field. The existing Launchboard opportunity `type` remains a separate tracking classification.

The design adds per-field preview source/confidence evidence with deterministic conflict rules. Evidence is review-only and not persisted in this phase. Provider extraction is limited to fields explicitly exposed by a validated exact posting record or selected Schema.org JobPosting; observed/undocumented endpoints remain lower-confidence and must have fixtures before fields are used.

Compatibility plan: safe defaults for legacy LocalStorage records, backup schema v3 with v1/v2 import support, optional API request fields with omitted-field preservation for older clients, additive DB migration 005, ordered location child table, and additive CSV columns. Migration is designed only; it must not be run during local implementation.

Local implementation and verification are complete in the later checkpoint below. Remaining gates: separately approved migration 005, real-schema API/backup round-trip, and verified provider-field compatibility for remaining undocumented sources. No production release gate is implied.

## 2026-11-07 — Quick Capture structured Opportunity fields IMPLEMENTED LOCALLY

Implemented the structured field expansion across the shared Opportunity model, LocalStorage normalization, capture preview and evidence, provider adapters, API schemas and persistence, additive migration file, Quick Capture review form, shared add/edit form, detail dialog, JSON backup v3, and CSV export/import.

Fields: ordered multi-location list, department, team, workplace type, employer employment type, publication date, and structured compensation range/currency/interval. Existing free-text compensation and the user's Launchboard opportunity type remain separate and unchanged. Preview evidence is per-field and review-only; values are editable before saving. API requests remain compatible with older clients: omitted fields preserve stored values, explicit empty values clear them.

Provider field mappings now include Lever, Ashby, Greenhouse, Workable, Personio and Teamtailor, limited to actual explicit matched-posting fields. No inferred employer/currency/work mode values are introduced.

Verification: frontend/domain **663/663** across 54 files; server **610/610** across 37 files; combined **1,273/1,273** across 91 files. Root and server TypeScript checks passed; frontend (Vite 6.4.5, 1,641 modules) and server production builds passed; `git diff --check` passed with only normal line-ending warnings.

Migration `005_opportunity_job_details.sql` is authored and statically tested but **not executed**. No DB, deployment, production-path acceptance, commit or push occurred. Next: separately approved DB migration/recovery procedure and real-schema persistence test, then expand the live provider matrix for fields not yet verified on Workday, BambooHR, Breezy HR and Rippling. This local work does not complete the production release gate.

## 2026-11-07 — Pre-deployment hardening checkpoint (NOT DEPLOYED)

The local release candidate has received an additional TiDB-compatibility and database-verification pass. This checkpoint supersedes earlier local test totals below.

- Migration 005 now explicitly targets TiDB Cloud 8.5.x and no longer declares new SQL CHECK clauses. TiDB's declarative constraint enforcement is controlled by a cluster-level setting that is off by default; the new structured-field enum/range/location rules therefore remain enforced by the shared domain normalizer and strict API validation. No cluster-level setting was changed. Migration 005 remains additive and does not alter migrations 001–004.
- The read-only live-schema verifier now requires the new structured Opportunity columns, the `opportunity_locations` table, its primary/unique/parent indexes and its cascading foreign key. Its row-format diagnostic is optional so an unavailable MySQL/InnoDB variable does not fail verification against TiDB.
- The verifier's disposable cascade exercise now inserts a synthetic location and proves that it is removed with the parent while both test transactions roll back. A residue query also checks for leftover synthetic locations.
- Disposable database test: all migrations 001–005 were applied using the normal Launchboard migration runner to a fresh isolated local MariaDB 10.11.16 database on 127.0.0.1:33117. The live-schema verifier passed against it: 14 tables, 46 indexes, 13 foreign keys, all five migration checksums and the transactional cascade/rollback check. This is a real DDL/verifier test on MariaDB, not a test against hosted TiDB.
- Current code verification: frontend/domain **663/663 across 54 files**; server **612/612 across 37 files**; combined **1,275/1,275 across 91 files**. Both TypeScript checks and both production builds passed. Frontend build transformed 1,641 modules (Vite 6.4.5). `git diff --check` passed; only normal LF-to-CRLF warnings were reported.

### Still blocking a production-ready release

- The actual hosted TiDB schema was not inspected and no production backup was taken or verified. Migration 005 has not been run on TiDB. The disposable MariaDB test does not prove that the live target has the expected baseline or that TiDB will accept every DDL statement.
- An end-to-end API create/read/update/explicit-clear and backup restore smoke was submitted for execution through the Desktop Commander review panel. Its result is not visible in this chat, so it is **not counted as passed**. Do not rerun the reviewed call automatically; retrieve or ask the operator to share that result first.
- The latest Vercel READY production deployment discovered during this pass references the older Git SHA `db155ff904b31100aa171a93d879fd6a2a73abaf`; the structured-field candidate remains local/uncommitted. No Vercel deployment, domain alias, feature flag or environment value was changed or read in decrypted form.
- Before deployment: establish the exact hosted TiDB target and baseline using an approved credential path (never print or expose secrets), take and verify a production backup, inspect for partial/pre-existing migration objects, apply 005 as a separately controlled database operation, verify migration history/schema and run the actual disposable-account API/backup round trip against that TiDB schema. Only then prepare the matching frontend/API release and production smoke test.

No production database was connected to or changed; no migration was applied to hosted TiDB; no commit, push or deployment was performed. **Do not deploy until the user explicitly approves it.**


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


## 2026-11-08 — LinkedIn Quick Capture compatibility probe (PARTIAL ONLY)

- Confirmed there is **no LinkedIn-specific provider adapter** in `server/src/services/opportunityCaptureService.ts`. LinkedIn URLs currently use the generic HTML metadata / Schema.org fallback only.
- Tested three public LinkedIn job detail URLs through the same local compiled `previewOpportunityUrl()` service used by the deployed application:
  - BlackStone eIT — Full Stack Developer (.NET/Angular)
  - Webenia — Senior Full-Stack Software Engineer
  - Procore Technologies — Staff Software Engineer, Backend & Full Stack
- All three returned `outcome: partial`, not `ready`.
- Each returned only a page-metadata title and short description snippet, both labelled **low confidence**. The title was the full LinkedIn page title (including employer/location/LinkedIn suffix), not a clean job-title field.
- Company/client, locations, posted date, employment type, workplace type, department and team were empty in these results.
- This does **not** meet the same extraction quality as the tested Ashby, Workable and Lever adapters. The supported behavior today is a best-effort partial result followed by manual review; users must correct the title and manually enter missing required fields.
- LinkedIn pages can show a public job snippet while also displaying sign-in prompts; search indexing/public visibility does not guarantee that a server-side unauthenticated fetch exposes the full posting. Current public search results demonstrate this distinction (e.g. LinkedIn job detail pages can render a public title/employer/location/description excerpt alongside a sign-in prompt).
- Do not add LinkedIn cookies, user credentials, session reuse, CAPTCHA handling, authwall bypasses or bot-control circumvention to Quick Capture. Do not assume an official read API is available to this project. Any future adapter must use only an explicitly permitted public/official access path and preserve safe manual fallback if LinkedIn blocks or limits anonymous access.
- **Decision:** LinkedIn is not yet accepted as a fully supported Quick Capture provider. A dedicated, compliant adapter is a separate future enhancement; do not advertise parity with Ashby/Workable/Lever.

No application code, Vercel settings, deployment, database data or Git state was changed during this compatibility probe.


## 2026-11-08 — Narrow LinkedIn page-title fallback improvement (LOCAL, NOT DEPLOYED)

### Change
- Added an opt-in LinkedIn public job-title parser for exact HTTPS LinkedIn job-detail URLs only: `linkedin.com/jobs/view/{numeric-id}` and `www.linkedin.com/jobs/view/{numeric-id}`.
- When the public page title matches LinkedIn's observed format `<role> at <employer> — <location> | LinkedIn Jobs`, Quick Capture now separates the clean role title from the employer name.
- The title and employer are both explicitly marked as **low-confidence page metadata**. The employer provenance label is `LinkedIn job page title pattern`; users must still verify both values.
- The original posting URL is preserved. No additional LinkedIn fields are inferred: location, posted date, employment type, workplace type, team, department and compensation remain empty unless independently exposed by trusted structured metadata.
- This parser does not use LinkedIn credentials, cookies, user sessions, CAPTCHA workarounds, authwall bypasses or a private API. Non-job LinkedIn paths and identical title patterns on unrelated hosts do not receive the special parsing.

### Verification
- Targeted real-page check against the three previously sampled public LinkedIn listings: two returned `ready` with clean title + employer (BlackStone eIT and Webenia); the third was blocked by LinkedIn and returned `blocked` without data.
- Added regression coverage for the exact LinkedIn job path and for negative cases (LinkedIn search page and unrelated host).
- All six capture-related server test files passed: **187/187 tests**.
- Server TypeScript typecheck passed and server production build passed.
- No database or API write was performed. No production or Preview deployment was made.
- The updated implementation is local only; the persistent QA Preview still runs the previously deployed build until a new reviewed Preview deployment is made.

**Decision:** small, compliant LinkedIn fallback improvement accepted locally. This improves clean title/employer extraction when LinkedIn exposes the familiar public job-page title, but it is not a full LinkedIn adapter and does not guarantee extraction when LinkedIn blocks anonymous access.


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


## 2026-11-08 ? v1.3.0 production release

Quick Capture v1.3.0 is released to main and tagged ui-v1.3.0. The release adds review-first metadata suggestions for supported public employer/ATS pages, editable values with per-field provenance/confidence, structured job details, duplicate warnings, manual fallback, and the in-app What's New/Quick Capture introduction.

Release verification passed 670 frontend/domain tests and 615 server tests, both TypeScript checks, and frontend/server production builds. Production deployment verification is recorded in docs/deployment-readiness.md.

**LinkedIn decision:** Launchboard does not fetch LinkedIn pages. A prior local title parser was removed because it depended on automated LinkedIn access. LinkedIn URLs are retained and entered manually. User-pasted job-details parsing and a separately supplied employer/ATS URL are future candidates only; do not treat them as implemented in v1.3.0.

The detailed v1.2 Action Center and v1.3 Quick Capture design/implementation documents remain local working references. The repository publishes one concise release note for each version: docs/v1.2-release-notes.md and docs/v1.3-release-notes.md.
