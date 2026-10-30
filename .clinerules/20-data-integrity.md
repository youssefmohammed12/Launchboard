# Data Integrity

Launchboard stores the user's records in the browser. Losing them is unrecoverable, so treat every change to the persisted shape as a migration.

## Source of truth
- The current persistence mechanism is **browser localStorage**.
- The existing storage key is `launchboard.opportunities.v1` (see `src/utils/storage.ts`). Verify it in the source before modifying storage.
- Use the existing TypeScript opportunity model (`src/types/opportunity.ts`) and validation utilities (`src/utils/opportunities.ts`, `src/utils/dates.ts`) as the source of truth.

## Preserving stored data
- Preserve existing opportunity identifiers, valid fields, notes, descriptions, compensation values, and other stored information.
- Do not discard valid records merely because a newly introduced field is missing.
- When extending the data model, provide safe defaults or normalization for older stored records (the existing `normalizeOpportunity` pattern repairs rather than drops).
- Use deliberate, backward-compatible data migrations when necessary.
- Seed demonstration records only according to the existing initialization behavior (seeded once, when nothing is stored).
- Never reintroduce demonstration records merely because a user intentionally saved an empty list.
- Preserve the established behavior for malformed stored data and storage failures (unreadable data → empty list, storage disabled → in-memory operation) unless an intentional change is required and verified.
- Treat localStorage as untrusted input and validate data before relying on its structure.

## Domain rules
- Keep date-only values such as `YYYY-MM-DD` consistent with the existing local-calendar-date behavior (`toISODate` uses local fields, never `toISOString`).
- Reuse existing validation and business logic instead of implementing inconsistent copies in components.
- Preserve existing opportunity statuses, types, sorting rules (records without a deadline sort last), dashboard counting rules (Applications Sent = Applied + Interview + Offer), and deadline exclusions (Offer and Rejected excluded from deadlines) unless the task explicitly changes them.
- Preserve the current demo-record behavior, including that editing a demo record turns it into the user's own record.
- Do not introduce an API, database, authentication, or backend storage during the frontend stages.

## Verification
Whenever a change affects persisted data, explicitly verify compatibility with existing records and persistence after refresh: create, edit and delete a record, reload the page, confirm the data is still there, and confirm older stored records still load.
