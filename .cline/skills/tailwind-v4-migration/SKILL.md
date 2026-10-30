---
name: tailwind-v4-migration
description: Use when maintaining or extending Launchboard's Tailwind CSS v4 styling, or diagnosing Tailwind v4 configuration and CSS compatibility issues.
---

# Tailwind CSS v4

## Current setup
Tailwind CSS v4 is integrated through the `@tailwindcss/vite` plugin and is used throughout the frontend. The styling migration is complete.

`src/styles.css` contains:
- the Tailwind import;
- the `@theme` design tokens;
- the global `@layer base` element and accessibility rules.

There is no semantic component stylesheet. `src/styles.baseline.css` and `src/styles.tw.css` are recovery artifacts and are not imported by the application.

## Changing styles
1. Use Tailwind utilities for ordinary component, page, form, dialog, and badge presentation.
2. Reuse the theme tokens in `@theme` instead of inventing colors, spacing, radii, or shadows.
3. Keep custom CSS only for global element defaults, accessibility, or specialized behavior that utilities cannot express clearly.
4. Do not reintroduce a legacy `@layer components` block or duplicate component rules.
5. Preserve stable test selectors such as `list-btn` in markup when tests depend on them; they do not require legacy CSS.
6. Do not change application behavior, data models, storage, or dependencies as part of styling work.

## Configuration
- Vite 6.4.5 with `@vitejs/plugin-react` and `@tailwindcss/vite`.
- Tailwind CSS v4 uses its CSS-first setup; no `tailwind.config.js` is required.
- Keep the existing Vite, React, and Tailwind versions unless a demonstrated defect requires a change.

## Verification
- Run `npm run build` once after a styling change.
- Perform a brief, targeted smoke test of the affected page or component.
- Run `npm run test:focus` only when dialogs, focus restoration, keyboard behavior, or shared dialog/state code could be affected.
- Do not create new baseline captures, comparison harnesses, screenshots, or diagnostic scripts for routine styling work.
- Report what changed, what was verified, and any limitations.

The comprehensive multi-browser regression pass is a separate final task and has not been completed yet. When it is run, follow `.clinerules/30-testing-and-verification.md` and include the full `npm run test:focus` suite across Chromium, Firefox, and WebKit where available.

## Related project rules
See `.clinerules/40-ui-and-accessibility.md` for design, accessibility, responsive behavior, and styling rules. See `.clinerules/30-testing-and-verification.md` for the complete testing policy.
