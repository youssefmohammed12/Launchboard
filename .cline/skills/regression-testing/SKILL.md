---
name: regression-testing
description: Use after implementing or fixing Launchboard features, changing shared components, modifying persistence or dialogs, changing styling, or investigating suspected regressions. Covers both focused per-change testing and the final comprehensive regression pass.
---

# Regression Testing

## Focused regression testing
Use this after a particular fix or when a change affects a specific interaction, data operation, or shared behavior.

1. Inspect `package.json`, README, and the existing test setup.
2. Identify the behavior at risk and the smallest check that would provide meaningful evidence.
3. Run `npm run build` once; it includes the TypeScript check.
4. Run only the relevant focused checks:
   - utility, business-logic or shared-component changes: run `npm test` or the affected Vitest file;
   - dialog, keyboard or focus restoration changes: `npm run test:focus`;
   - storage changes: run the storage tests, then create or modify data, reload to confirm persistence, and check backward compatibility where relevant;
   - date changes: run the date tests and verify the affected date behavior;
   - navigation changes: verify the affected path;
   - styling or component changes: run the relevant component tests and inspect the affected component and its primary layout at the breakpoint(s) the change directly affects.
5. Review the changed files or diff.
6. Check for new console errors when browser testing is available.
7. Report exact results and distinguish checks that ran from those that did not.

Do not default to running the entire browser test suite after every small change. Do not run a separate `npx tsc --noEmit` immediately after `npm run build` unless an independent TypeScript check is needed to diagnose a specific problem.

## Final regression testing
Use this after a major feature set or the completed Tailwind migration cleanup. Perform the comprehensive pass described in `.clinerules/30-testing-and-verification.md`, covering all pages, navigation and CRUD, search/filter/sort, dialogs and keyboard accessibility, persistence and backward compatibility, date calculations, responsive layouts at mobile/tablet/desktop, console errors, the existing automated browser tests, and relevant accessibility checks.

At the final stage, run the full Vitest suite (`npm test`) and the full `npm run test:focus` suite, verifying Chromium, Firefox and WebKit where the available setup permits. Reserve this level of multi-browser and cross-page testing for the final review or for changes with substantial cross-cutting risk.

## Diagnosing failures
If a test fails, reproduce the problem, inspect the failure, and identify whether it was introduced by the current change before proposing a fix. A failing assertion may also be a stale expectation (for example, a renamed record changes its button's accessible name) — check which it is before changing application code.

## Environment notes
- `focus-test.cjs` resolves Playwright from the globally installed `@executeautomation/playwright-mcp-server` package; it is not a project dependency and `npm install` is not required to run it.
- The script defaults to `http://127.0.0.1:5199/`; set `APP_URL` to point it at whatever the dev server is using (e.g. `APP_URL=http://127.0.0.1:5173/ npm run test:focus` for the Vite default port, or `http://127.0.0.1:5200/` for `npm run preview`).
- Do not add production dependencies merely to support a one-off test.

## Related project rules
See `.clinerules/30-testing-and-verification.md` for the complete per-stage and final testing policy, command guidance, and reporting format. See `.clinerules/20-data-integrity.md` when a change affects persisted data.
