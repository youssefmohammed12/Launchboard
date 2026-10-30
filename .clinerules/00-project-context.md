# Project Context

## What Launchboard is
Launchboard is a personal opportunity-tracking application for students, junior developers and freelancers. It keeps internships, jobs and freelance projects in one place.

## Current stack
- React 18 + TypeScript (strict) + Vite 6
- Tailwind CSS v4 through `@tailwindcss/vite`, with theme and global base styles in `src/styles.css`
- Lucide React for icons
- Browser `localStorage` for persistence (no backend or database)

## Current frontend features
Dashboard with summary cards, opportunity CRUD, combined search and filters, sorting by deadline, opportunity details, confirmation dialogs, deadline tracking, responsive layouts, and focus management.

## Maturity and expectations
The application has undergone significant stabilization and browser testing (Chromium, Firefox and WebKit). Those existing build and test results are a **historical baseline, not proof that a future change is correct**. Re-verify rather than assume.

## Scope boundaries
- The project is currently **frontend-only**.
- Do **not** implement a backend, authentication system, API, database connection, or deployment infrastructure unless explicitly requested later.
- Backend work is intentionally deferred until the frontend is complete.
- Tailwind CSS v4 is integrated throughout the frontend; custom CSS is limited to the theme and necessary global/base/accessibility rules in `src/styles.css`.
- The broader roadmap may include a Kanban board, priority levels, tags, activity history, follow-ups, reporting, and data export. These are **plans, not authorization** to implement them automatically.

## Working assumptions
- Always inspect the current code, package configuration, README, and test scripts before relying on past assumptions or on this file.
- The developer's local Node.js version and Cline's runtime may differ. Check the actual environment (`node -v`) rather than assuming a specific version.
