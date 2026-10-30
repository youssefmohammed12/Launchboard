# Launchboard (frontend)

A personal opportunity tracker for students, junior developers and freelancers: internships, jobs and freelance projects in one place. The frontend uses React, TypeScript, Vite, Tailwind CSS v4, and Lucide React. The browser app is still the only complete application. `server/` contains a Node/Express/TypeScript foundation with health and readiness endpoints, strict request-validation infrastructure, a MySQL/MariaDB connection pool, an explicit migration runner, and the initial relational schema, but no authentication or business API yet.

## Requirements
- Node.js 20.12+ (verified with Node 26.8.2) and npm (verified with npm 11.19.1). Nothing needs to be installed globally. The server uses Node's built-in `process.loadEnvFile`, which requires Node 20.12 or newer.

## Run
    npm install
    npm run dev

Open the URL Vite prints (usually http://localhost:5173).

## Production build
    npm run build
    npm run preview   # optional: serve the build locally

`npm run build` runs the TypeScript check (`tsc --noEmit`) and then `vite build`.

## Server foundation
`server/` is an npm workspace (`@launchboard/server`) using Express 5, TypeScript, Zod and `mysql2`. It provides environment validation, `GET /api/health`, `GET /api/ready`, the shared JSON error envelope, strict request-validation schemas for future endpoints, a MySQL/MariaDB connection pool, an explicit migration runner, and the initial relational schema. There is no authentication, session handling, CRUD/bulk/import/export endpoint, CORS setup, or frontend HTTP integration yet.

    npm run dev:server        # tsx watch; defaults to http://127.0.0.1:3000
    curl http://127.0.0.1:3000/api/health
    curl http://127.0.0.1:3000/api/ready

    npm run build:server      # compile to server/dist
    npm run start:server      # run the compiled server
    npm run typecheck:server
    npm run test:server
    npm run db:migrate        # explicit migration run; never automatic

Process environment: `NODE_ENV` (`development` default; also `test` and `production`), `HOST` (`127.0.0.1` default), `PORT` (`3000` default, integer 1-65535). A `.env` file is loaded only through the server configuration path; use [`server/.env.example`](server/.env.example) as a template.

The optional database block uses `DB_HOST` (`127.0.0.1` default), `DB_PORT` (`3306` default), `DB_NAME` (required, must be exactly `launchboard`), `DB_USER` and `DB_PASSWORD`. Leave all five unset to run without a database. Invalid configuration stops startup with a safe message that names the setting but never prints its value.

`/api/health` is process liveness only and never touches the database. `/api/ready` returns `200 {status:"ok",db:"ok"}` only when a connection succeeds, the selected database is exactly `launchboard`, and `SELECT 1` works; otherwise it returns a safe `503 NOT_READY` envelope. It never runs migrations or writes data.

Database provisioning is a separate administrator action. `server/database/create-database.sql` creates only `launchboard`; the server never creates or drops databases on startup, and the migration runner refuses any other target. See [`server/README.md`](server/README.md) for provisioning, the dedicated user grant, migration recovery limits, and the unverified live-integration status.

## Styling
Tailwind CSS v4 is configured through `@tailwindcss/vite`. The `@theme` tokens and global/base/accessibility rules live in `src/styles.css`; page and component presentation uses Tailwind utilities. There is no separate semantic component stylesheet.

`src/styles.baseline.css` and `src/styles.tw.css` are retained recovery artifacts and are not imported by the application.

## Features
- Dashboard: active summary cards, a derived Next 7 Days summary, and recent active opportunities. The summary lists eligible deadlines, follow-ups and Scheduled interviews from today through today + 6 local calendar days (seven dates, including today) in chronological order. It shows at most five events, states when more events exist and links to the Calendar for the full list. Past-due items stay in the Calendar's Overdue section. The summary is derived on read and never changes opportunity or interview records. Archived opportunities are excluded from the cards, recent list and Next 7 Days.
- Opportunities: search by title/company, filter by type, status, priority and tag (combined), sort by deadline, add, edit, delete with confirmation, details dialog, and List/Board views. A Show selector switches between Active (the default) and Archived records. Search, filters, sorting and both presentations work within the selected group, and archived records remain inspectable with a Restore action.
- Saved views: save the current Opportunities configuration under a name and restore it later. A view stores the opportunity-page search text, type/status/priority/tag filters, deadline sort, Active/Archived mode and List/Board layout - never opportunity records, selection, Global Search state or Undo history. Up to 20 views are stored locally under the separate `launchboard.views.v1` key; names are trimmed, limited to 60 characters and unique case-insensitively. Applying a view restores its settings and clears the current selection. Updating requires an explicit confirmation and preserves the view's stable ID and creation time; renaming preserves its settings and identity; deleting removes only the saved preference after confirmation. Unsupported stored enum values are repaired to All, ascending deadline order, Active and List, while custom search text and tags are kept even when they match no current record.
- Global search: the sidebar's "Search Launchboard" button or Ctrl+K (Cmd+K on macOS) opens a single search dialog over the whole collection. It matches opportunity title, company, description, notes, tags, type, status, priority, compensation and application link; interview round, preparation notes, notes, mode, location, outcome and status; contact name, role, email, phone and notes; material label, kind, version, status and notes; and activity type and note. Matching is case-insensitive substring matching on the trimmed query, with results ranked by exact title/company, title/company prefix, other opportunity fields, then nested records; collection order, category and child index provide deterministic tie-breakers. The list is limited to 20 results with a visible "showing the first 20 of N" message. Archived opportunities are excluded by default and can be included with a labelled checkbox; included results show an Archived badge, and opening one never restores it. Activating a result replaces search with the existing Details dialog - no second dialog is stacked - and a child result focuses that interview, contact, material or activity inside Details. Arrow Up/Down, Enter, Escape, focus restoration and a live result summary support keyboard use. The query and results are never persisted.
- One add/edit form with validation for required fields, URLs, deadlines and follow-up dates, plus Low/Medium/High priority and up to 10 user-defined tags (24 characters each).
- Activity timeline in details: manually logged activities plus automatic status-change history, with inline add and remove confirmation.
- Contacts in details: multiple people per opportunity, each with a required name and optional role/title, email, phone, website/profile URL, and notes. Add and edit in an inline form, view all saved details, and delete with inline confirmation. A contact linked to interviews produces an explicit warning; confirming removes the contact, clears those interview links and preserves every interview ID, date, status, outcome and note. Contact changes do not alter the opportunity's overall status or create activity entries.
- Interviews in details: multiple rounds per opportunity, each with a round/name, local date and optional `HH:mm` time, mode (Phone, Video, In person, Assessment, Other), status (Scheduled, Completed, Cancelled), optional outcome (Positive, Negative, No decision), meeting URL, location, preparation notes, general notes, and an optional contact from the same opportunity. Add and edit in an inline form, mark a round completed, cancel it, reschedule a cancelled round, record or update its outcome, and delete with inline confirmation. A linked contact is shown by name and role only; full contact details stay in Contacts. Completed and cancelled rounds remain in the opportunity's history. Interview changes do not alter the opportunity's overall status or create automatic activity entries.
- Application materials in details: each record has a required label, kind (Resume, Cover Letter, Portfolio, Assessment, Other), optional external link, optional version label, status (Draft, Ready, Submitted, Superseded), and notes. Add and edit in an inline form, change status directly on a material, open a supplied link, and delete with inline confirmation. A material without a link is valid and renders no empty anchor. Editing or changing the status of one material does not modify another. Material changes do not alter the opportunity's overall status or create activity entries.
- Follow-up dates appear in List, Board, Details and Dashboard views.
- Archive versus application status: archiving stores an ISO timestamp in `archivedAt` and never changes `status`, so an archived record can still be Saved, Applied, Interview, Offer or Rejected. A missing `archivedAt` means active. Restore removes the marker. Both actions keep every ID, field and nested activity/interview/contact/material record, and neither creates an activity-history entry. Archive and restore write the candidate collection to localStorage before updating the interface; a failed write leaves the previous archive state in place and shows an accessible error, with a success status on retry.
- One-level Undo for archive, restore and delete: after a successful action, a dismissible notification explains what happened and offers Undo for 10 seconds. Undo reverses only that latest action; a newer archive, restore, delete, core edit, status change, nested-record change or successful JSON import replaces or invalidates the pending entry. Deleting still requires the existing confirmation. Undo is in-memory only, so reloading the page ends the opportunity to undo while the completed action stays persisted. Undo writes the candidate collection before updating the interface; a failed write keeps both the visible and stored data unchanged, reports an accessible error and leaves Undo available for a safe retry. This is a short-lived safety net, not a trash or recycle-bin history.
- Multi-selection in List view: every row has a labelled checkbox, and a master "Select all visible opportunities" checkbox selects only the current filtered Active or Archived result set, never hidden records. The toolbar shows the selected count and offers Archive selected (Active view), Restore selected (Archived view), Delete selected (both views) and Clear selection, plus a status selector in the Active view. Selection is keyed by stable opportunity ID and is cleared when the Active/Archived mode, List/Board view, search, filters or sorting change, when leaving Opportunities, or after a committed bulk operation. A failed write keeps the selection so the user can retry, and stale IDs that are no longer visible are never acted on. Bulk delete is available only in List view, never in Board view.
- Bulk archive and restore: one confirmation names the affected count, then the whole candidate collection is written once before the interface updates. Every selected record keeps its status, IDs and nested activities/interviews/contacts/materials, and no activity entries are fabricated. Bulk restore only clears `archivedAt`; a record already in the requested archive state is never modified.
- Bulk status: in the Active view, selected opportunities can move to any existing status together. Archived records are excluded, records already in the destination status are left untouched, and only records whose status actually changes receive the usual automatic "Status changed from X to Y" activity entry. The result reports the updated and already-matching counts. Bulk status changes are not undoable, matching individual status changes.
- Bulk delete: Delete selected is offered in both the Active and Archived List views. Before the confirmation opens, and again when it is confirmed, the app resolves the requested IDs against the latest committed collection and the view the user confirmed. A batch is refused as a whole - never partially applied - if the request is empty, repeats an ID, refers to a record that no longer exists or moved to the other archive mode, or matches stored records whose duplicate IDs make the target ambiguous. The confirmation names the count and the Active or Archived source, states that details, activities, interviews, contacts and materials are removed, distinguishes deletion from archiving (no copy stays in Archived), and explains the 10-second Undo window and the need for a separate backup afterwards. Cancelling changes nothing and keeps the selection and any still-valid pending Undo. A successful batch is written once before the interface updates; a failed write leaves memory, storage, the selection and the previous Undo entry untouched and shows an accessible error so the user can retry. There is no trash or recycle-bin collection.
- Batch Undo: a bulk archive, restore or delete produces one Undo notification (for example "Archived 4 opportunities." or "Deleted 2 opportunities.") and one 10-second entry. Archive/restore Undo validates every affected record and refuses the whole batch if any record is missing or its archive state changed. Delete Undo validates every stored snapshot and refuses the whole batch if any ID is invalid or duplicated, a record with the same ID already exists, or an original position is unusable; it never overwrites a record or merges nested data. Snapshots are sorted by ascending original index with the ID as a stable tie-breaker and inserted at their original positions, clamped to the current collection bounds, so adjacent and separated deletions are restored in order. A failed Undo write leaves every record unchanged and keeps the entry available for retry.
- Deadlines view grouped into Overdue, Due today and Upcoming (archived records, offers and rejections excluded).
- Calendar: a derived monthly grid and unified Overdue/Upcoming view built from existing deadlines, follow-ups and interview rounds. Archived opportunities generate no events. Navigate by previous/next month or Today, select a date for its agenda, and filter All, Deadlines, Follow-ups or Interviews. Event cards open the associated opportunity's existing Details dialog. The month grid keeps Completed and Cancelled interviews for history, while Upcoming lists only Scheduled interviews. Keyboard users get one roving date tab stop, arrow-key movement between dates (including across month boundaries), Home/End week movement, and native Enter/Space selection.
- Calendar eligibility and dates: deadlines use the same valid `YYYY-MM-DD` rule and Offer/Rejected exclusion as the Deadlines view; follow-ups include any opportunity status with a valid date; interviews use their stored local date and optional `HH:mm` time. Missing or invalid dates are ignored. Overdue means strictly before today. Upcoming is today through the following 13 local dates (14 calendar days including today). A Scheduled interview whose date has passed stays Scheduled and appears as overdue; it is never automatically completed or cancelled. Completed and Cancelled interviews do not appear as upcoming appointments. Within a day, timed interviews sort chronologically; untimed events follow in deadline, follow-up, interview order. Event IDs are deterministic, and the calendar is derived on read without changing opportunity statuses, dates, nested workspace data, the localStorage key or the backup format. The Dashboard's Next 7 Days summary applies the same eligibility rules to today through today + 6 inclusive.
- Reports: current-status summary cards, proportional status/type/priority breakdowns, and up to eight recent activity entries across active opportunities (click an entry to open its details). Archived records are excluded from every Reports calculation.
- Data export from Reports: a spreadsheet-friendly CSV with one row per opportunity and activity JSON, plus a versioned JSON backup containing complete records, activity history, interviews, contacts and application materials. Both files are generated locally in the browser and include archived records. CSV columns keep their existing names and positions and have no archive-state column; JSON preserves `archivedAt`, so it remains the canonical complete backup.
- JSON restore from Reports: select a Launchboard backup, review its valid, repaired, invalid/skipped and duplicate-ID counts, then merge new records or replace the current collection. Replacement requires a separate confirmation. The candidate collection is persisted before the interface updates, so a failed write leaves current data unchanged. Interview, contact and material data, including stable IDs and valid contact links, is normalized and retained during merge or replacement. Valid archive timestamps survive both merge and replace; backups without archive metadata restore as active records.
- localStorage persistence; demo records are seeded once, labelled "Demo", and never overwrite saved data.
  Records missing optional fields are repaired on load instead of being discarded; missing priority/tags default to Medium and an empty list, invalid or missing deadline/follow-up dates become empty values, missing interviews/contacts/materials become empty collections, missing archive metadata means active, and malformed archive metadata is repaired to active. Malformed nested entries are dropped without discarding their parent record. An otherwise valid record is preserved when only an optional field is malformed.
- Interview records are normalized on load and restore: a round/name and a genuine `YYYY-MM-DD` date are required, invalid optional times/URLs become empty values, unsupported modes/statuses/outcomes use safe defaults, text is trimmed and length-limited, up to 25 rounds are kept per opportunity, and the first valid entry wins when an interview ID is duplicated inside one opportunity. A contact reference that does not resolve to a contact in the same opportunity is cleared to `''`, leaving the interview and its history intact.
- Delete undo keeps the complete pre-deletion snapshot in memory: ID, title, company, status, type, priority, tags, dates, compensation, URL, description, notes, activities, interviews, contacts, materials and archive state, plus the original collection position. Contacts referenced by interviews stay linked. If a record with the same ID now exists, Undo refuses to overwrite it and explains why. A failed delete or failed Undo write changes nothing and creates or preserves no unsafe Undo state. A bulk delete stores one independent deep snapshot per record and reverses the batch atomically, preserving each record's archive state and original order.
- Contact and material records are normalized independently on load and restore: malformed children are skipped, duplicate child IDs keep the first valid record, text is trimmed and length-limited, invalid optional emails/URLs become empty values, unsupported material kinds become Other, and unsupported statuses become Draft.
- Editing an opportunity's core fields, changing its status, or moving it between board columns preserves its activities, interviews, contacts, materials, stable nested IDs, valid contact links and archive state; the core opportunity form does not own workspace or archive data, so a normal edit never reactivates an archived record.
- Responsive layout; the table becomes cards on small screens. Dialogs use native `<dialog>` (Escape, focus trap) and restore focus to the element that opened them. Contacts, interviews and materials use inline editors inside the details dialog, so no nested second dialog is opened.

Counting rules: Applications Sent = Applied + Interview + Offer; Reports In Progress = Saved + Applied + Interview. Interviews and offers in Reports reflect current statuses, not historical activity.

## Storage recovery
Launchboard reads the opportunity collection from `launchboard.opportunities.v1`. A missing key, an empty array, and unreadable data are three distinct states:

- **Missing key:** the normal first-run path, which seeds the labelled demo records once.
- **Valid empty array (`[]`):** a deliberately empty collection. It is not seeded and shows no recovery warning.
- **Unreadable value:** invalid JSON, or valid JSON whose root is not an array. The app does not treat this as an empty collection.

When the stored value is unreadable, Launchboard preserves the exact raw string under `launchboard.recovery.raw.v1` before allowing ordinary writes. The copy is verified by reading it back. An existing, different recovery copy is never overwritten automatically. If preservation fails because of a storage/quota error, the primary value is left untouched and all opportunity writes are blocked. The recovery notice offers a retry, and writes are unblocked only after the exact payload is written and verified.

A valid array can also contain duplicate top-level opportunity IDs. The collection is normalized first, then the first valid record for each ID is kept and later valid duplicates are excluded. A malformed record does not reserve its ID, so a later valid record with that ID can still be kept. The number of excluded duplicates is reported in the app notice. The original raw array is preserved before any later write could remove the duplicates; no normalized collection is written during loading.

At startup, Launchboard also detects a recovery copy that remains from an earlier repair, even when the current opportunity collection is now valid. A retained-copy notice offers **Download recovery copy** and an explicitly confirmed **Remove recovery copy** action. Removal deletes only `launchboard.recovery.raw.v1`, verifies that the key is gone, and never rewrites or normalizes the primary opportunity collection. It is refused while the copy is still protecting an unreadable primary value or while writes are blocked. Dismissing the notice hides it for the current session only; a later reload discovers the copy again. Recovery copies are never removed automatically.

If a different recovery copy already exists while the primary value is unreadable, the notice exposes both exact payloads for download. Replacing the earlier copy requires an acknowledgement that it has been downloaded or safely retained, followed by a separate confirmation. Only then does Launchboard write the current primary raw string to the recovery key, read it back, and unblock writes after an exact match. A failed replacement leaves the primary value untouched, keeps writes blocked, and reports the error.

The recovery notice explains whether the exact raw payload was preserved, is retained from an earlier repair, or saving is blocked. **Download recovery copy** exports the exact stored string as a `.txt` file with a `text/plain` content type. That file is evidence of what was stored; it is **not necessarily a valid Launchboard backup**, and it is not modified or reformatted on download. The recovery copy is never deleted automatically, including after download. Dismissing the notice does not change the recovery state or delete the copy.

After a successful preservation, the first later successful create, edit, delete, archive/restore, bulk action, Undo or JSON import may save the normalized collection. The recovery copy remains available for explicit download or removal. If preservation failed or a conflict remains unresolved, none of those actions are reported as successful and the unreadable primary value is never replaced. Loading or displaying the notice never writes a replacement collection by itself.

## Workspace limits
Interviews, contacts and materials are each capped at 25 per opportunity. A real application normally involves only a handful of rounds, people and documents, while the cap keeps one record from growing localStorage without bound. Delete an existing entry before adding another when a collection is full.

- Saved views are capped at 20 per browser, and each name is limited to 60 characters. Delete an existing view before adding another at the limit.
- Contact fields: name 120 characters (required), role/title 120, email 254, phone 40, website 2048, notes 2000.
- Material fields: label 120 characters (required), version 80, link 2048, notes 2000.
- Contacts belong to one opportunity; there is no shared or global directory. Adding the same person to two opportunities creates two independent records.
- A stored contact keeps its history when only an optional email or website is invalid: the invalid value is cleared to `''`. A material with an invalid stored link behaves the same way. Unknown material kinds become Other and unknown statuses become Draft.
- Contact email validation is practical rather than RFC-complete. Phone numbers accept international characters and spacing and are only trimmed and length-limited. Website and material links must use `http://` or `https://`.
- Deleting a contact is explicitly confirmed. If it is linked to interviews, the confirmation says how many links will be cleared; the interview records and all of their history remain. Deleting a material removes only its metadata and never deletes an externally hosted file.

## Structure
`src/components` (reusable UI), `src/pages` (views), `src/hooks` (collection lifecycle), `src/utils` (dates, filtering, validation, storage), `src/data` (seed and the persistence boundary), `src/types`, `packages/domain` (shared domain contracts), and `server` (HTTP API foundation).

### Persistence boundary
Launchboard is still **localStorage-only**. There is no API client, server repository, authentication or frontend HTTP integration. The `server/` workspace now includes the database foundation, schema and migration runner, but no MySQL-backed API endpoint exists, so the browser never reads or writes the database.

- `src/data/opportunityRepository.ts` defines the small `OpportunityRepository` boundary: load the normalized collection with its recovery metadata, persist a complete candidate collection, and perform the three explicit recovery actions (retry preservation, replace the recovery copy, remove the recovery copy).
- `LocalStorageOpportunityRepository` is a deliberately thin adapter. Every rule stays in `src/utils/storage.ts`: the `launchboard.opportunities.v1` and `launchboard.recovery.raw.v1` keys, normalization, duplicate-ID repair, corrupt-storage detection, raw-payload preservation, write blocking and save-failure reporting. The adapter does not normalize, retry or recover on its own.
- `src/hooks/useOpportunities.ts` owns the collection and recovery view state. It loads synchronously at startup, so there is no loading screen or artificial delay. Its `commitCandidate(candidate)` writes first, returns an explicit boolean, updates React state only after success, and leaves both the collection and recovery state unchanged after a failed or blocked write.
- `App.tsx` still owns dialogs, navigation, selection reset, Undo entries and expiry, confirmation flows, product-specific messages, and construction of each candidate collection. Its local `commit()` wrapper calls `commitCandidate()` and then applies the application's Undo-invalidation policy; the hook never clears Undo.

Every ordinary and specialized mutation follows the same persist-before-commit order: build and validate the complete candidate, write it once, then expose it to React. A failed write is reported as a failure and never silently treated as success.

A future server repository is planned but unimplemented. It cannot simply mirror this synchronous whole-collection write: it will need authentication and per-user ownership, optimistic concurrency or version checks, and a server-side transaction boundary for each candidate write. Those decisions must be designed before replacing the localStorage adapter.

The proposed backend architecture, schema, API contract and migration plan are documented in [`docs/backend-contract.md`](docs/backend-contract.md). The `server/` workspace implements the runtime foundation, health and readiness endpoints, error envelope, request-validation schemas, connection pool, initial schema and migration runner. No authentication, CRUD endpoint or frontend API client exists yet.

### Shared domain package
`packages/domain` (`@launchboard/domain`) holds the environment-independent contracts that the frontend and the future API must agree on: opportunity and nested-record types, controlled values, field and collection limits, strict calendar-date rules, tag normalization, small field predicates, and the version-1 backup envelope.

- The frontend keeps its existing import paths. `src/types/opportunity.ts`, `src/utils/dates.ts`, `src/utils/opportunities.ts`, `interviews.ts`, `contacts.ts`, `materials.ts`, `exports.ts` and `backup.ts` are thin re-export wrappers; components did not change.
- Browser persistence and recovery stay in `src/utils/storage.ts`. The permissive client normalizers are intentionally **not** shared: the server will validate requests strictly and reject invalid input instead of repairing it.
- The package is an npm workspace compiled to `packages/domain/dist`. `npm run build:domain` builds it; `dev`, `build`, `test` and `test:focus` build it automatically first. See [`packages/domain/README.md`](packages/domain/README.md) for details.

## Testing
Business logic and focused component behaviour are covered by Vitest, React
Testing Library and jsdom:

    npm test                    # frontend/domain suite, then server tests
    npm run test:watch          # rerun affected frontend/domain tests while editing
    npm run test:server         # server-only Vitest suite (Node environment)

`npm test` runs the frontend/domain Vitest suite and then the server suite. Server tests use `server/vitest.config.ts` with the Node environment and are not included by the root jsdom configuration, so they are not executed twice.

The suite covers stored-record normalization and persistence, archive timestamp
validation and normalization, active/archived selection, immutable
archive/restore operations and their idempotency, archive-state preservation
through edits, status changes and reloads, active-only Dashboard, Deadlines,
Calendar and Reports calculations, one-level Undo for archive, restore and
delete, batch Undo for bulk archive/restore and bulk delete, deep snapshot
preservation and original-position restoration (adjacent, separated and fully
deleted collections), ID collision refusal, stale-entry rejection,
expiration, dismissal, Undo write failure and retry, import invalidation, and
the notification's live region, keyboard controls and focus fallback;
multi-selection (individual, select-all-visible, indeterminate, filter and
view changes, stale IDs), bulk archive/restore, bulk delete and bulk status with
automatic status history, single-write bulk transactions, target revalidation
and failure recovery; interview,
contact and material
normalization, field limits, immutable add/update/remove operations,
referential repair when a contact link is missing, local date calculations,
search/filters/sorting, dashboard and report metrics, tags, activity history,
CSV/JSON backup output and archived-record inclusion, JSON envelope validation,
record repair and duplicate handling, merge/replace archive preservation,
transactional restore persistence, the restore dialog's
preview/confirmation/error states, and the
interview/contact/material list and form interactions (empty states, validation,
add/edit/cancel, status and outcome updates, linked contacts, deletion
confirmation, focus restoration and accessible labels). Calendar tests cover
deterministic event derivation and IDs, same-day distinctions, deadline and
follow-up eligibility, malformed interviews, immutable sources, inclusive range
boundaries, month/year/leap transitions, overdue and 14-day upcoming rules,
timing, filtering, month navigation, date selection, event activation, keyboard
focus movement and empty states. Dashboard tests cover the inclusive seven-day
boundaries (today, day six, yesterday and day seven), month/year transitions,
eligibility, chronological ordering, event labels, interview time/mode,
Today/Tomorrow wording, the five-event limit and visible-versus-total count,
the empty state, Calendar navigation, event activation and the preserved
summary/recent/add behavior. Integration tests also check that core edits and
board status changes preserve all nested workspace data, that contacts and
materials survive save/load, that a dashboard or calendar interview event opens
the correct opportunity and linked contact, that Active/Archived switching,
archive/restore, failed-write recovery and focus fallback behave correctly, that
Undo reverses archive, restore, delete and a bulk delete batch without losing
nested data and keeps focus valid, and that JSON backups round-trip their stable IDs, archive state and
contact links while the CSV schema remains unchanged. Global-search tests cover
opportunity and nested-category fields, case-insensitive and trimmed queries,
stable parent/child identities, duplicate suppression, deterministic ranking
and tie-breaking, the 20-result limit and truncation count, archived exclusion
and opt-in, malformed child records, no source mutation, the dialog's empty,
no-results and result states, keyboard selection and Enter activation, focus
restoration, Ctrl/Cmd+K exclusions while typing or while another dialog is open,
child-record focus after activation, and the archived toggle. Saved-view tests
cover normalization and unsupported-value repair, duplicate IDs, name
validation, persistence across reloads, applying a view and clearing selection,
update/rename identity, deletion that leaves opportunities untouched,
zero-match views and storage-write failure feedback. Tests live next to
the implementation as `*.test.ts` or `*.test.tsx`; shared setup and fixtures are
in `src/test`.

Server tests cover environment defaults and failure diagnostics, database configuration and the strict `launchboard` target guard, readiness success/failure with safe envelopes, health remaining independent of the database, migration ordering, checksum recording and drift, partial-failure handling, static schema invariants, the health response, request IDs, 404/400/413/422/500 envelopes, the reusable body-validation middleware, strict opportunity create/update aggregates, bulk request shapes, and the version-1 backup envelope. Database tests use fake pools and connections; they do not require a running MySQL/MariaDB server. Test-only Express routes are used; no opportunity mutation, bulk, import or export endpoint exists.

Dialog focus restoration is covered separately by a Playwright script that
runs the same checks in Chromium, Firefox and WebKit. Playwright is a pinned
project dev dependency (`playwright@1.57.0`); its browser binaries are installed
separately and are not downloaded by `npm run test:focus`.

    npm ci                                              # install project dependencies
    npx playwright install chromium firefox webkit      # install browser binaries
    npm run test:focus

`npm run test:focus` starts the Vite dev server on http://127.0.0.1:5199, waits
until it is ready, runs the suite, and stops only the server process it started.
The port is strict: if another process already owns it, the script reports the
conflict and exits instead of testing an unexpected server. It never stops an
unrelated process.

To test against a server you manage yourself, leave it running and set
`APP_URL`; the script then does not start or stop a server:

    # PowerShell
    $env:APP_URL='http://127.0.0.1:5173/'; npm run test:focus

    # bash/zsh
    APP_URL=http://127.0.0.1:5173/ npm run test:focus

The suite checks that focus returns to the exact control that opened a dialog
(view, edit, delete confirmation, add, restore) for the close button, Cancel,
Save, Escape, the backdrop click and keyboard activation; that the details ->
edit transition keeps the original trigger; that the restore dialog focuses its
file input; and that a deleted row falls back to `#main-content`. Global-search
focus behavior (opening from the shortcut or sidebar, returning focus, and
focusing a matched child record) is additionally covered by a separate
Playwright smoke pass; it is not part of `test:focus`.

Playwright browser binaries live in the platform cache (for example
`%LOCALAPPDATA%\ms-playwright` on Windows or `~/.cache/ms-playwright` on Linux)
and can occupy several hundred MB in total. Run `npx playwright install` once
per machine or after changing the pinned Playwright version.

Common setup errors:

- `Executable doesn't exist ...` - install the browsers with
  `npx playwright install chromium firefox webkit`.
- `Port 5199 ... already in use` - stop that process or use `APP_URL` with a
  different port.
- `APP_URL is not reachable` - start the external server first, or unset
  `APP_URL` so the script starts one.
- Missing WebKit/Firefox system libraries on Linux - install the dependencies
  Playwright reports (`npx playwright install-deps` on supported distributions).

## Limitations
- Data lives only in this browser's localStorage: not secure, not shared across devices.
- Saved views are local UI preferences, not opportunity data. They live in this browser's localStorage under `launchboard.views.v1`, are not included in JSON backups, CSV exports or Global Search, and are not synchronized across devices or users. There are no shared/team views, saved Global Search queries or server-side persistence. A view whose tag or query no longer matches any record remains valid and can be applied; unsupported filter values are repaired when loaded.
- No auth, business API, or routing library (navigation is React state, so no deep links). The database foundation and schema exist, but the browser does not use them.
- Activity entries have no global creation timestamp, so same-date ordering across different opportunities uses their stored append order as the closest available tie-breaker.
- CSV export quotes every cell, includes a UTF-8 BOM, and prefixes text beginning with `=`, `+`, `-`, `@`, tab or carriage return with an apostrophe to reduce spreadsheet formula-injection risk. This mitigation is not a universal guarantee for every spreadsheet application or import mode. CSV intentionally keeps its existing columns and does not include interviews, contacts or materials. Archived records are still exported, but because the CSV schema is unchanged there is no archive column, so CSV rows cannot distinguish active from archived records; use JSON for a complete backup including `archivedAt`.
- Interviews, contacts and materials are stored locally with their opportunity. The Calendar is an internal derived view, not a second source of truth. There is no external calendar synchronization (Google/Outlook), reminder/notification, drag-and-drop rescheduling, global contact or company directory, redo, persistent multi-step undo history, trash/recycle bin, or file upload/binary storage. Material links point to external services, so Launchboard cannot verify that a linked file stays available.
- Global search is a case-insensitive substring search over the records already loaded in the browser. It does not provide fuzzy matching, typo correction, stemming, relevance scoring beyond the documented ranking tiers, an external search index, server-side search, saved searches or a general command palette. Results are capped at 20, and the query and results are not stored.
- Bulk delete is permanent once its 10-second Undo expires or is dismissed. There is no trash, recycle bin or persistent deletion history, and recovery afterwards depends on a separately exported JSON backup the user may have. Bulk Undo is a single in-memory entry: it cannot restore a batch after a reload, after a newer eligible action replaces it, or after a later collection change invalidates it. If any snapshot ID conflicts with a record that now exists, the entire Undo is refused rather than overwriting or partially restoring data.
- Selection is UI state only. It is not persisted, it is cleared by search, filter, sort, view or section changes, and it never survives a reload.
- Undo is deliberately limited: only the single latest archive, restore, delete, bulk archive/restore or bulk delete can be reversed, the entry expires after 10 seconds or on dismissal, and it is discarded by a later collection change or a successful JSON import. Undo metadata is never stored in localStorage, so a reload ends it. A bulk action is one entry covering the whole batch, and it is reversed atomically or not at all. While the Details dialog is open, its modal layer keeps the notification out of the tab order until the dialog is closed; the Details dialog's own Archive/Restore action remains available.
- An interview round's date is a local calendar date; no timezone conversion is applied. Time is optional and stored as `HH:mm`. Calendar grouping also stays on local `YYYY-MM-DD` values.
- JSON restore accepts only the current `launchboard-backup` format with schema version 1, up to 5 MB and 20,000 records. CSV import is not implemented.
- A backup containing records but no valid records cannot replace the current collection; this prevents an unexpectedly destructive restore. A structurally valid backup with an empty `opportunities` array can replace it after an explicit warning and confirmation.
- Unit/component coverage is intentionally focused on business logic and high-value components. The Calendar has focused component coverage, but full visual/layout behavior is checked with browser smoke passes rather than automated snapshots.
