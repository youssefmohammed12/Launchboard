# `@launchboard/domain`

Environment-independent domain contracts and pure rules shared by the Launchboard
frontend and the future Node.js/Express backend.

This package is **contracts only**. It contains no React, no DOM access, no
`localStorage`, no recovery policy, no downloads and no API client.

## What belongs here

| Module | Contents | Why it is shared |
|---|---|---|
| `opportunity.ts` | `Opportunity`, `ActivityEntry`, `InterviewEntry`, `ContactEntry`, `MaterialEntry`, their draft types, and every controlled-value array (`OPPORTUNITY_STATUSES`, `PRIORITIES`, `INTERVIEW_MODES`, `MATERIAL_KINDS`, `ACTIVITY_TYPES`, …) | The database, API and UI must agree on field names and allowed values. |
| `limits.ts` | Per-opportunity collection caps, per-field character limits and backup size/record caps | Client validation, storage normalization and server request validation must use the same numbers. |
| `dates.ts` | `parseISODate`, `toISODate`, `isValidISODate`, `addDaysToISODate`, `daysBetweenISODates` | Calendar dates are date-only values; a server must never turn them into timestamps. |
| `tags.ts` | `normalizeTagList` | Trim, case-insensitive dedupe and "keep the first spelling" must behave identically on both sides. |
| `validation.ts` | `isValidUrl`, `isValidInterviewTime`, `isValidContactEmail` | Small, pure field rules that both environments apply. |
| `backup.ts` | `BACKUP_FORMAT`, `BACKUP_SCHEMA_VERSION`, `LaunchboardBackup` | The version-1 JSON envelope is a shared wire contract. |

## What does not belong here

- `src/utils/storage.ts` normalization, duplicate repair, write blocking and the
  raw recovery payload. Those are browser persistence policy.
- `RecoveryViewState`, recovery warnings and raw-data downloads.
- CSV creation, file downloads, `Blob`, `document`, `window`, React or hooks.
- Server-only concerns: sessions, ownership, SQL, versions, audit timestamps.

## Client recovery vs server request validation

These are intentionally different responsibilities and are **not** unified here.

- **Client recovery** (`src/utils/storage.ts`) is permissive. A malformed stored
  record is repaired: an invalid priority becomes `Medium`, an invalid date
  becomes `''`, a dangling interview contact reference is cleared, and invalid
  nested entries are dropped without discarding the parent. The goal is to keep
  as much valid user data as possible.
- **Server request validation** (future API) is strict. An invalid field in a
  `POST`/`PUT` body is rejected with `422 VALIDATION_ERROR`; it is not silently
  repaired. The API is authoritative for what it stores.

Only rules with identical semantics in both environments live in this package.
The permissive normalizers stay in the frontend, and the server will implement
strict validation separately using these shared constants and predicates.

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
modules.

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

## Future backend consumption

The backend will add the same workspace dependency and import only the public
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

`packages/domain/test/contract.test.ts` verifies the controlled values, date and
tag rules, field predicates, backup constants, and environment independence. It
is included in the root Vitest run. Existing frontend tests continue to verify
that the re-export wrappers and the permissive storage normalizers behave as
before.
