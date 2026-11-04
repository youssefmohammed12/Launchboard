# Launchboard UI redesign

**Date:** 2026-11-03
**Scope:** Complete visual-system and application-shell redesign. Existing opportunity data, authentication, import/export, and workflow behavior remain unchanged.

## Product direction

Launchboard is a personal opportunity-management workspace for collecting opportunities found on external platforms, tracking their progress, and managing deadlines. The interface is designed around that purpose rather than presenting Launchboard as a freelance marketplace.

The visual direction uses a calm, professional productivity-SaaS aesthetic:
- Deep blue-green navigation rail, with a restrained teal accent.
- Soft cool-gray application canvas and white content surfaces.
- Dark slate text, muted supporting text, and a consistent status-color vocabulary.
- Rounded cards and controls, subtle elevation, clear focus states, and restrained motion.
- Responsive desktop sidebar that becomes compact horizontal navigation on smaller screens.

## Shared design system

The theme tokens are defined in `src/styles.css` under Tailwind's `@theme` block. The shared application shell uses:
- `.lb-app-shell`, `.lb-sidebar`, `.lb-nav-link` for the product frame and navigation.
- `.lb-main-area`, `.lb-topbar`, `.lb-content`, `.lb-local-content` for page hierarchy and content width.
- `.lb-context-row`, `.lb-sync-state`, and `.lb-inline-alert` for workspace state and feedback.
- `.lb-auth-shell`, `.lb-auth-promo`, and `.lb-auth-card` for the sign-in, registration, verification and password-recovery experience.

The same shared Sidebar is used in localStorage and authenticated API modes. The local mode gets a small local-workspace header; API mode includes account, sync, migration, sign-out and a global Add opportunity action. The Ctrl+K search shortcut is preserved.

## Page coverage

The shared style layer applies consistently across Dashboard, Opportunities, Calendar, Deadlines and Reports. It improves summary cards, section cards, tables, forms, focus rings, dialog surfaces, empty states and mobile layout without changing the underlying page calculations or opportunity data model.

## Responsive behavior

- Desktop: fixed-width sticky sidebar and flexible content region.
- Tablet: compact sticky horizontal navigation, with page content using the full width.
- Mobile: two-row compact navigation, simplified account controls and tighter content spacing; the auth promo panel is hidden to prioritize the form.

## Preserved behavior and data safety

No database schema, migrations, SQL, production opportunity rows, authentication contracts, API endpoints, localStorage keys, import/export formats, or CRUD logic were changed for this redesign. The API-mode global quick-add uses the existing opportunity form and save handler. Local browser mode remains the default in source; production is built explicitly with `VITE_DATA_MODE=api`.

## Verification

Focused UI regression command:

```powershell
npx.cmd vitest run src/ApiModeApp.test.tsx src/App.test.tsx src/components/AuthScreen.test.tsx src/pages/Dashboard.test.tsx src/pages/Opportunities.test.tsx src/pages/Calendar.test.tsx src/pages/Reports.test.tsx
```

Result: **86 tests passed across 7 files**.

Production build command:

```powershell
$env:VITE_DATA_MODE='api'
npm.cmd run build
Remove-Item Env:\VITE_DATA_MODE
```

Result: TypeScript check and Vite production build passed with 1,633 modules.

## Production release

- Vercel production deployment: `dpl_AvAj3qGkrSeHC8kx7Fv5sXgj5ZR7` — READY, Frankfurt (`fra1`).
- Existing production domains remain attached: `https://launchboard-drab.vercel.app` and `https://launchboard-youssef-workplace.vercel.app`.
- Post-deploy smoke: homepage and both generated assets returned HTTP 200; health/readiness returned HTTP 200 and readiness reported `db=ok`; Playwright sign-in/registration UI smoke passed with zero JS or unexpected console errors.
- No account was created, and no existing opportunity data was changed.
- API bundle, database, Vercel project settings and environment variables were left unchanged. Deployment used prebuilt files; no Git connection, commit or push was created.
- Final generated assets: `assets/index-DGfkRjv9.js` (384,616 bytes) and `assets/index-CfJqFXoU.css` (48,723 bytes). `deployment/release-ui-smoke.mjs` checks the production routes and the emitted design markers.


## Browser branding follow-up (2026-11-04)

- Added `public/favicon.svg` as the browser tab icon: a simplified, clearly recognizable white rocket with cockpit, fins and teal exhaust on a dark blue-green rounded-square background. The SVG is deliberately lightweight and stays crisp at small tab-icon sizes.
- `index.html` references the SVG favicon and sets the browser theme color to the existing dark navigation color (`#102735`).
- Deployed to Vercel production on 2026-11-04 as `dpl_Fed9L1WuwYxQ1asTkCC5DFNLiN3K` (READY). The live favicon endpoint returned HTTP 200 with `image/svg+xml`, and its SHA-256 matched the local SVG.
