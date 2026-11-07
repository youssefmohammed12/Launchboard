# `@launchboard/domain`

Environment-independent domain contracts and pure rules shared by the Launchboard
frontend and the Node.js/Express backend.

This package is **contracts only**. It contains no React, no DOM access, no
`localStorage`, no recovery policy, no downloads and no API client.

## What belongs here

| Module | Contents | Why it is shared |
|---|---|---|
| `opportunity.ts` | `Opportunity`, `ActivityEntry`, `InterviewEntry`, `ContactEntry`, `MaterialEntry`, `TaskEntry`, their draft types, and controlled-value arrays | The database, API and UI must agree on field names and allowed values. |
| `limits.ts` | Per-opportunity collection caps, per-field character limits and backup size/record caps | Client validation, storage normalization and server request validation must use the same numbers. |
| `dates.ts` | `parseISODate`, `toISODate`, `isValidISODate`, `addDaysToISODate`, `daysBetweenISODates` | Calendar dates are date-only values; a server must never turn them into timestamps. |
| `tags.ts` | `normalizeTagList` | Trim, case-insensitive dedupe and "keep the first spelling" must behave identically on both sides. |
| `validation.ts` | `isValidUrl`, `isValidInterviewTime`, `isValidContactEmail` | Small, pure field rules that both environments apply. |
| `tasks.ts` | Task normalization, strict validation, create/update/complete/reopen/delete operations, Action Center grouping and deterministic task sorting | The local app and API need identical task lifecycle and classification rules. |
| `backup.ts` | `BACKUP_FORMAT`, current `BACKUP_SCHEMA_VERSION` (v2), supported import versions and `LaunchboardBackup` | The browser and API share the full-fidelity v2 export envelope while retaining v1 import compatibility. |
| `backupNormalization.ts` | `normalizeBackupOpportunityRecord` and its typed result | Shared, environment-independent repair for versioned backup records. V1 records normalize to an empty task collection; v2 task data is preserved and validated/repaired consistently in browser and server imports. |

## What does not belong here

- `src/utils/storage.ts` normalization, duplicate repair, write blocking and the
  raw recovery payload. Those are browser persistence policy.
- `RecoveryViewState`, recovery warnings and raw-data downloads.
- CSV creation, file downloads, `Blob`, `document`, `window`, React or hooks.
- Server-only concerns: sessions, ownership, SQL, versions, audit timestamps.

## Import repair vs normal request validation

These are deliberately separate policies.

- **Browser storage recovery** (`src/utils/storage.ts`) remains browser-specific.
  It preserves localStorage recovery state, write blocking and UI diagnostics.
  Do not move those responsibilities into this package.
- **Versioned backup import repair** (`backupNormalization.ts`) is pure and
  environment-independent. Both the server import path and the browser
  backup-file parser use it to repair optional fields, drop malformed children,
  keep first valid child IDs and clear dangling interview-contact references
  while retaining valid parent records. V1 imports receive `tasks: []`; v2
  task children are normalized with the shared task rules. Browser localStorage
  recovery remains a separate frontend-only policy.
- **Normal API writes** remain strict. An invalid field in a `POST`/`PUT` body
  is rejected with `422 VALIDATION_ERROR`; it is never silently repaired.
  The server remains authoritative for what it stores.

The shared import helper contains no persistence, browser recovery, download or
API behavior. It can therefore be used by both import adapters without pulling
frontend modules into the backend.

## Consumption by the frontend

The package is an npm workspace (`packages/*`) and is linked as
`@launchboard/domain` during `npm install`.

The frontend keeps its existing import paths through thin re-export modules:

- `src/types/opportunity.ts` re-exports the domain types and controlled values,
  and keeps the form-only `OpportunityFormData`, `FormErrors` and `View` types.
- `src/utils/dates.ts` re-exports the shared date helpers and keeps the
  `today`/locale helpers (`addDays`, `daysUntil`, `formatDate`, labels).
- `src/utils/opportunities.ts`, `interviews.ts`, `contacts.ts`, `materials.ts`
  re-export the shared limits and predicates they previously defined.
- `src/utils/exports.ts` and `backup.ts` re-export the shared backup constants
  and envelope type.

Components do not import the package directly; they keep importing the frontend
modules. The v1.2 task contract is now integrated into the normalized Opportunity
aggregate for local and API modes. Task operations and the Action Center UI
remain later implementation stages.

## Build order

The package is compiled to `dist/` before the frontend consumes it:

```bash
npm install          # links the workspace
npm run build:domain # compile @launchboard/domain
npm run dev          # predev builds the package first
npm test             # pretest builds the package first
npm run test:focus   # pretest:focus builds the package first
npm run build        # prebuild builds the package first
```

When editing the package during development, run `npm run dev:domain` in a second
terminal to rebuild on change, or re-run `npm run build:domain`.

`dist/` is a build artifact and is git-ignored. A clean checkout therefore needs
one of the scripts above (all of which build it automatically) rather than
importing the package source directly.

## Module format

- ESM (`"type": "module"`), compiled with TypeScript `NodeNext` resolution.
- Relative imports use explicit `.js` extensions so the emitted JavaScript runs
  unchanged in Node.js.
- Public entry point: `dist/index.js`, declarations at `dist/index.d.ts`.
- `tsconfig.json` includes the `DOM` library only so the standard `URL`
  constructor used by `isValidUrl` has a type. No browser API is called, and the
  package test asserts that no browser, React or persistence module appears in
  `src/`.

## Backend consumption

The backend uses the same workspace dependency and imports only the public
entry point:

```ts
import {
  OPPORTUNITY_STATUSES,
  isValidISODate,
  isValidInterviewTime,
  isValidUrl,
  normalizeTagList,
} from '@launchboard/domain';
```

The backend must not import frontend modules (`src/utils/storage.ts` and
friends). Strict request validation and SQL persistence remain backend
responsibilities.

## Tests

- `packages/domain/test/contract.test.ts` verifies controlled values, date and
  tag rules, field predicates, backup constants and environment independence.
- `packages/domain/test/tasks.test.ts` verifies task limits, strict validation,
  normalization/repair behavior, date classification and deterministic grouping.
- Both files are included in the root Vitest run. Existing frontend tests
  continue to verify that frontend re-export wrappers and storage normalizers
  behave as before.
