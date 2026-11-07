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


## Responsive follow-up audit — 2026-11-07 (before implementation)

This is a source-level audit of the current local checkout at `C:\xampp85\htdocs\launchboard-frontend\launchboard-frontend`. It records layout behavior visible in the source; it is not yet a rendered-browser or device pass.

### Findings

1. **Responsive rules are fragmented.** `src/styles.css` repeats breakpoint blocks for 860px and 620px, then applies later overrides. The sidebar, topbar and content spacing are consequently controlled by several layers rather than one coherent responsive system.
2. **Phone navigation loses context.** Below 620px the sidebar wraps into a second row. Below 480px the navigation labels are hidden, leaving five icon-only destinations. This saves width but makes the destinations less obvious.
3. **The phone header is tall and unstable.** The topbar can wrap its action group onto a full-width row at 620px and below. Combined with the two-row sidebar, the interface spends a large share of the initial viewport on navigation and chrome.
4. **Calendar is still a seven-column grid on phones.** The cells shrink to a 58px minimum and event text is hidden, leaving compact markers. The selected-day and event lists below preserve access to details, but the month overview is difficult to scan and tap precisely at narrow widths.
5. **Opportunities controls need a unified mobile flow.** The table changes into card-like rows below 640px, and selects/buttons grow to full width; archive mode, view mode, filters and bulk actions are still separate wrapping groups. Their vertical rhythm and action priority need a deliberate pass.
6. **Board density changes sharply by viewport.** Five status columns use an auto-fit grid with a 180px minimum. That naturally becomes a long single-column stack on phones; the board interaction and status controls need a touch-first treatment.
7. **Summary-card density is inconsistent.** Dashboard summary cards use a 200px minimum while Reports uses 150px. Their mobile number sizes and padding should be normalized with the shared spacing system.
8. **Spacing is only partly tokenized.** The theme has a useful `s1`–`s6` scale, but the shell and pages also use many one-off pixel values and different card paddings. The global content grid adds 16px gaps, while page sections add their own margins and spacing.

### Proposed direction for Stage 17

Retain the current blue-green navigation and teal accent, but refine the product as a responsive workspace rather than squeezing the desktop layout down:

- Consolidate breakpoints and spacing into a small, consistent set of tokens.
- Keep a compact brand/search header on phones and use a persistent, labelled bottom navigation for the five primary destinations, with safe-area spacing and large touch targets.
- Rebalance the phone topbar so the page title and its primary action are clear without wrapping into unnecessary rows.
- Use a consistent mobile page rhythm: readable side padding, predictable section gaps, compact but legible summary cards, full-width form controls where useful, and action groups that wrap intentionally.
- Keep Calendar event access strong on phones; consider a clearer selected-day agenda paired with a compact month overview rather than making the seven-column grid carry the whole experience.
- Rework the board's phone presentation for touch use without removing the desktop drag-and-drop workflow.

### Validation still required

No viewport screenshots, browser interaction checks, touch tests or horizontal-overflow measurements were performed during this source review. Before marking Stage 17 complete, render and inspect representative phone (360×800 and 390×844), tablet (768×1024) and desktop (1440×900) sizes; test navigation, filters, board, calendar, forms, dialogs, keyboard focus and reduced motion. Record only the viewports and browsers actually tested.

## Stage 17 responsive direction — 2026-11-07

Option B was selected and approved: a complete responsive improvement that preserves the existing blue-green/teal identity. The detailed design proposal is docs/superpowers/specs/2026-11-07-launchboard-responsive-ui-design.md and its implementation plan is docs/superpowers/plans/2026-11-07-launchboard-responsive-ui-plan.md.

The direction retains the desktop sidebar, provides compact labelled navigation on tablet, and uses a five-destination labelled bottom navigation on phones. It also normalizes shared spacing, cards, headers, forms and dialogs, then tunes each main page and the opportunity board for narrow viewports. No backend, persistence, authentication, API, database or deployment changes are included.

Target viewports: 360×800, 390×844, 768×1024 and 1440×900. The earlier responsive audit remains source-level only; rendered browser validation has not yet been performed. Do not mark Stage 17 implementation complete until browser inspection and focused regression checks have actually passed.

### Non-redesign visual enhancement layer

Stage 17 also includes a restrained polish pass: clearer typographic hierarchy and whitespace; consistent card surfaces; harmonized existing status/progress badges; improved empty, loading and feedback states; more readable chart labels and legends; consistent icon/control sizing; and subtle state transitions that respect reduced-motion preferences. Keep the established blue-green/teal identity, page structure, and workflows. This is not a new visual identity or feature expansion.

## Stage 17 implementation and responsive verification - 2026-11-07

Implemented the responsive follow-up while preserving the existing blue-green/teal identity and familiar page structures:

- Desktop keeps the full sidebar. Tablet uses compact horizontal navigation with labels. Phone uses a fixed five-destination bottom navigation with text labels, active state, and safe-area padding.
- Normalized responsive shell sizing, content gutters, card/metric surfaces, heading hierarchy, form controls, focus styling, and reduced-motion behavior.
- Reworked the opportunity board for phones to select one status lane at a time with per-status counts. Desktop/tablet keep all five columns and existing card status controls.
- Improved phone Opportunities controls and 44px touch targets; made calendar cells easier to select; constrained dialogs to the mobile viewport and retained reachable actions/focus behavior.
- No domain, calculation, persistence, localStorage, API, authentication, backend, database, or deployment behavior changed.

### Browser QA

A local Playwright/Chromium runner (scripts/verify-responsive-ui.mjs) inspected the local-mode application at 360x800, 390x844, 768x1024, and 1440x900. Dashboard, Opportunities, Calendar, Deadlines, and Reports passed at each viewport. The board was inspected separately for one mobile lane versus all five desktop/tablet lanes. Assertions covered horizontal overflow, full-width phone/tablet content, navigation labels and active state, 44px touch targets, add-opportunity dialog bounds and action reachability, Escape and focus restoration, visible keyboard focus, Ctrl+K, reduced motion, and browser console/page errors.

25 screenshot captures are kept locally in artifacts/responsive-ui/ and excluded from Git.

### Automated verification

- Frontend Vitest: 546 passed across 46 test files.
- Backend server Vitest: 414 passed across 31 test files. The initial combined test run saw one transient ephemeral-port bad-port error; the isolated test passed and the full server suite passed on rerun.
- npm.cmd run build: passed TypeScript and Vite 6.4.5; 1,633 modules transformed.
- API-mode component tests: 22 passed. Multi-viewport Chromium inspection was performed in local mode; no separate authenticated API-mode browser session was started.
- No deployment, commit, or push was performed.
### Small alignment follow-up — 2026-11-07

- Moved the row-selection checkbox into its matching Opportunity title cell, alongside the opportunity name. The select-all control now shares the Opportunity table heading.
- Vertically centered each checkbox against its title. Direct Chromium measurement confirmed the checkbox/title center difference is 0px.
- Vertically centered the Private workspace shield icon against its complete two-line text. Direct Chromium measurement confirmed a center difference below 0.01px.
- Responsive Playwright sweep passed again across 360×800, 390×844, 768×1024, and 1440×900, all five main pages. The mobile opportunity screenshot was visually reviewed.
- Focused Vitest: 42/42 passed across Opportunities, Sidebar, and API-mode app tests.
- Production build: passed TypeScript and Vite (1,633 modules).
### Private workspace SVG centering correction — 2026-11-07

The earlier footer alignment adjustment centered the icon wrapper but did not center its SVG: the generic .lb-sidebar-footer span { display: block; } selector had higher specificity than .lb-sidebar-footer-icon { display: grid; }. The SVG therefore remained at the top of its 32px wrapper. Fixed with the more specific .lb-sidebar-footer > .lb-sidebar-footer-icon { display: grid; place-items: center; } rule and a block-level SVG. The Playwright check now measures the actual SVG against both its wrapper and the two-line text block. Latest measured deltas: SVG-to-wrapper 0px, SVG-to-text 0.0078px. Full responsive browser sweep passed (4 viewports x 5 pages); production build passed (1,633 modules).

## Authenticated mobile account access — 2026-11-07

The phone topbar now uses a dedicated account disclosure instead of showing a non-interactive initial avatar while hiding the account email. Opening the account control reveals the signed-in email and keeps **Migrate local data** and **Sign out** reachable in the same compact panel. The panel supports outside-click and Escape dismissal, with focus returned to the trigger on Escape. Desktop retains its existing account identity and direct action buttons. This is presentation-only; authentication behavior and data contracts are unchanged.

Verification for this follow-up: `MobileAccountMenu.test.tsx`, `Sidebar.test.tsx`, and `ApiModeApp.test.tsx` passed (28/28); `npm.cmd run build` passed (TypeScript and Vite, 1,634 modules). A separate live authenticated mobile-browser pass was not run.


### Opportunity row-selection controls on phones — 2026-11-07

At widths up to 640px, the row-selection checkbox is now positioned on a dedicated line above its opportunity title. This avoids making checkbox placement depend on the variable rendered width of the title. The title remains right-aligned within the mobile opportunity card. Tablet and desktop continue using the existing inline, vertically centered checkbox/title arrangement.

Validation: Opportunities tests 18/18 passed; production build passed (TypeScript and Vite, 1,634 modules); Playwright responsive check passed at 360×800, 390×844, 768×1024 and 1440×900 across all five main pages. The browser assertions explicitly check the separate phone row and preserved tablet/desktop alignment.


### Final mobile opportunity selection layout — 2026-11-07

The initial mobile attempt that placed a bare checkbox above each title was superseded. The final phone-only layout places a bordered “Select” pill with the checkbox at the right of the “Opportunity” field label. The opportunity title occupies the next full-width line and is left-aligned, giving each card a clear header hierarchy and a consistent selection affordance. The control has a 44px minimum touch target. Tablet/desktop retain their existing inline checkbox/title layout without the visible Select pill.

Validation: Opportunities tests 18/18 passed; production build passed; Playwright responsive sweep passed at 360×800, 390×844, 768×1024 and 1440×900. Assertions cover mobile label/target/position and unchanged larger-view alignment. Phone, tablet and desktop screenshots were visually reviewed.


## Final tablet Opportunities refinement — 2026-11-07

At tablet widths (641–860px), the seven-column Opportunities table is now rendered as labelled, two-column information cards. This avoids narrow title/company/date columns without introducing horizontal scrolling. The same row elements and controls are retained: the opportunity title and selection control, company, type/priority, status, tags, dates and row actions remain available. The card has a dedicated actions footer.

The change is isolated to tablet CSS. Desktop retains the standard table, while phone keeps its existing card layout and Select pill. No opportunity selection, bulk-action, data, persistence or API behavior changed.

Validation: responsive Playwright/Chromium passed at 360×800, 390×844, 768×1024 and 1440×900 across all five main pages. Tablet-specific assertions check the card grid, title/company/date widths, viewport containment, no horizontal scrolling and functional checkbox selection. Full frontend suite passed 552/552 across 47 files; backend suite passed 414/414 across 31 files. Production API-mode build passed TypeScript and Vite (1,634 modules). Deployed to Vercel production on 2026-11-07 as `dpl_BR1qNU1KCzYXmVyUayhv9c3DZ6qC`; post-deploy homepage/assets/favicon/API health/database readiness and exact static asset hashes passed. No commit or push.
