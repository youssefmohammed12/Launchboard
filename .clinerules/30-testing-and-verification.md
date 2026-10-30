# Testing and Verification

## Choosing commands
- Inspect `package.json`, README instructions, and the existing test setup before choosing commands.
- Current scripts: `npm run dev`, `npm run build` (runs `tsc --noEmit && vite build`), `npm run preview`, `npm test` (Vitest unit/component suite), `npm run test:watch`, `npm run test:focus`.
- `npm test` runs the Vitest/React Testing Library/jsdom suite for existing utilities and focused component behavior. It does not replace the browser focus suite.
- `npm run test:focus` covers dialog focus restoration in Chromium, Firefox and WebKit. It starts its own Vite dev server on `http://127.0.0.1:5199/` and stops it afterwards; set `APP_URL` to test an already-running server instead (for example `APP_URL=http://127.0.0.1:5173/ npm run test:focus`).
- Before running a command, identify which unresolved question it answers. Choose the smallest check that provides meaningful evidence.

## Per-stage development
For small, incremental changes:

1. Inspect the affected code and identify the behavior at risk.
2. Implement the change.
3. Run `npm run build` once after the change.
4. Review the relevant diff or changed files.
5. Perform a brief, targeted smoke test of the affected page when practical.
6. Report the results honestly.

The build already runs the TypeScript check and Vite's production build. Do not run a separate `npx tsc --noEmit` immediately afterward unless an independent TypeScript check is needed to diagnose a specific problem.

Do not run the full browser suite after every styling-only change. Do not repeatedly test unrelated pages, all browsers, all viewport widths, or every existing interaction when the change does not affect them.

## Targeted testing by risk
Run the relevant focused check when a change could plausibly introduce a regression:

- **Dialogs or focus management:** run `npm run test:focus` when the change could affect dialog behavior, keyboard operation, or focus restoration.
- **Utilities or business logic:** run `npm test` (or a focused Vitest file) for the affected normalization, date, filter, calculation, activity or export behavior.
- **Storage or persisted data:** run the relevant Vitest storage tests, then test creation or modification, persistence after reload, and backward compatibility where relevant.
- **Date calculations:** test the affected date behavior with the Vitest date tests and targeted manual checks where needed.
- **Navigation:** verify the affected navigation path.
- **Shared components or global styles:** run the relevant component tests and check the shared surfaces plausibly affected by the change.
- **Styling:** inspect the affected component and check its primary layout, plus any breakpoint the change directly affects.

Do not use the existence of a test as a reason to execute it after an unrelated change.

## Avoid excessive investigation
Do not:

- create new diagnostic scripts when existing tooling is sufficient;
- rebuild baseline comparison environments without a concrete need;
- perform exhaustive computed-style comparisons during routine styling changes;
- launch multiple browser sessions to repeat completed checks;
- repeat successful commands without a reason;
- investigate unrelated theoretical issues;
- start duplicate development servers unnecessarily.

If a specific failure occurs, investigate that failure directly instead of launching a broad diagnostic investigation.

## Final comprehensive regression testing
After a major feature set or the completed Tailwind migration cleanup, perform a dedicated full regression pass. It should cover:

- production build and TypeScript (the build includes the TypeScript check; run an independent check only if needed);
- all application pages;
- navigation and CRUD operations;
- search, filters and sorting;
- dialog interactions and keyboard accessibility;
- localStorage persistence and backward compatibility;
- deadline calculations;
- responsive layouts at mobile, tablet and desktop widths;
- browser console errors;
- the Vitest unit/component suite (`npm test`);
- the existing automated browser tests, including `npm run test:focus` across Chromium, Firefox and WebKit where the available setup permits;
- relevant accessibility checks.

Use the project's existing test infrastructure for the final pass. Do not claim that checks passed unless they were actually run. Report any tests that remain unverified.

## Honesty about results
- Never claim that a command, test, or browser inspection succeeded unless it actually ran and its result was observed.
- Distinguish confirmed defects from suspicions and unverified behavior.
- Report failed or unavailable checks honestly, including checks you could not run.

## Tooling
- Avoid installing new testing frameworks unless the task requires them and the benefit justifies the added complexity.
- Never run broad dependency fixes or force upgrades as an automatic response to a warning.

## Reporting
When reporting work, identify: the files changed, the checks performed, their results, and any remaining limitations.
