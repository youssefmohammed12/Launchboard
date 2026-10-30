---
name: frontend-feature-development
description: Use when planning, implementing, extending, or refactoring Launchboard frontend features in React and TypeScript, especially components, forms, state, localStorage-backed functionality, and data-model changes.
---

# Frontend Feature Development

When implementing a feature:

1. Inspect the relevant components, pages, types, utilities, storage logic, and tests.
2. Identify acceptance criteria and affected behavior before editing.
3. Determine whether the feature changes the persisted data model.
4. If stored data changes, define backward-compatible defaults or a deliberate migration before updating the UI.
5. Reuse the established components, Tailwind theme tokens, validation utilities, and existing business logic (`src/utils`, `src/types`, `src/styles.css`).
6. Implement the feature in focused stages, avoiding unnecessary abstraction and unrelated changes.
7. Handle loading, empty, invalid, and error states where relevant.
8. Preserve keyboard accessibility and responsive behavior.
9. Run `npm run build` once after the implementation stage; it includes the TypeScript check.
10. Run targeted regression checks for behavior the change could plausibly affect: use `npm test` for affected utilities, business logic or components, `npm run test:focus` for dialog or focus changes, verify persistence after reload and backward compatibility for storage changes, and test affected date or navigation behavior. Do not default to the full multi-browser suite after every change.
11. Check that existing functionality and stored records remain intact when persistence or shared behavior is involved.
12. Review the final diff and report what changed and what was verified.

## Verification scope

Follow `.clinerules/30-testing-and-verification.md`. Ordinary stages need a successful build plus focused smoke or regression checks for the affected behavior. Reserve comprehensive cross-page, multi-browser testing for a completed feature set, the final migration review, or a change with substantial cross-cutting risk.

Do not create new diagnostic scripts, repeat baseline investigations, or rebuild comparison environments unless a concrete blocker requires it. Use the existing project tooling.

## Scope
For complex features, establish the data model and interaction flow before building the UI.

Do not implement additional features merely because they appear on a broader roadmap (Kanban board, priority levels, tags, activity history, follow-ups, reporting, data export). Follow the current task's scope.

Do not add unnecessary dependencies for features that can be implemented reliably using the existing stack (React, TypeScript, Vite, Tailwind CSS, Lucide React).

## Related project rules
This skill complements the workspace rules in `.clinerules/`:
- `00-project-context.md` — stack, scope boundaries, frontend-only status.
- `10-change-safety.md` — smallest reliable change, no unrelated refactoring.
- `20-data-integrity.md` — localStorage persistence, storage key, normalization and migration.
- `30-testing-and-verification.md` — which commands to run and how to report results.
- `40-ui-and-accessibility.md` — design direction, accessibility, responsive behavior.
