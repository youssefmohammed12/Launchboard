# Launchboard authentication design

**Current status — 10 November 2026:** authentication, email verification, password recovery and Account Settings are implemented locally for the v1.3.5 candidate. The API-mode UI includes sign-in, registration, verification, resend-verification, forgot-password, reset-password and account self-service states. Account Settings supports display-name updates, password changes and confirmed account deletion. The localStorage workspace remains the default and does not require an account.

This document records the implemented security model. The earlier Stage 11 notes below were written before email verification and password recovery were added; the current Stage 12 behavior in this document supersedes those earlier deferred-policy statements.

## Architecture

- Express 5 and TypeScript own all authentication and account-action endpoints.
- MySQL-compatible persistence stores users, sessions, pre-auth sessions, and account-action token hashes.
- Passwords are hashed with Argon2id through `@node-rs/argon2`.
- The browser receives only HttpOnly session cookies; raw session tokens and passwords are never stored in localStorage.
- The API-mode frontend sends same-origin `/api` requests and keeps CSRF tokens in memory.
- The default localStorage app remains independent of the account system.

## Session and request protections

- Session tokens are cryptographically random; only SHA-256 hashes are stored.
- Cookies are HttpOnly, SameSite=Lax, Path=/, and Secure in production. Production cookies use the `__Host-` prefix.
- Sessions have a 30-minute idle timeout and a 7-day absolute lifetime.
- State-changing requests require a session-bound HMAC-derived CSRF token and a matching exact trusted Origin.
- GET, HEAD, and OPTIONS are treated as safe methods and do not refresh session state.
- Authenticated database queries are scoped to the account ID from the validated session, never an ID supplied by the browser.
- Rate limits cover pre-session, registration, login, resend, and password-reset request flows. The current limiter store is process-local.

## Registration and email verification

- Registration creates an unverified account and a random one-time verification token.
- Verification tokens expire after 24 hours. Only their SHA-256 hashes are stored.
- Verification requires an explicit POST action with the existing origin and CSRF protections; opening an email link does not automatically consume the token.
- Verification does not automatically sign the user in.
- Duplicate/eligible/ineligible account-action requests use generic responses to reduce account enumeration.

## Password recovery

- Password-reset links are sent only to verified accounts and expire after one hour.
- Reset tokens are random, purpose-bound, single-use values; only hashes are stored.
- A successful reset changes the Argon2id password hash, consumes the token, invalidates other reset tokens, and revokes all existing sessions in one transaction.
- Password recovery does not automatically sign the user in.
- Email links carry tokens in the URL fragment. The frontend removes the fragment from browser history before the user submits the action.

## Account Settings

Account Settings is available only in signed-in API mode. Its API routes live in `server/src/routes/accountSettings.ts`.

- **Profile:** `GET /api/account/profile` returns the signed-in user's display name, sign-in email, email-verification state and account creation date. `PATCH /api/account/profile` updates only the display name (trimmed, maximum 80 characters). The sign-in email remains read-only; changing it requires a separate new-address verification flow.
- **Password change:** `POST /api/account/password` requires the current password and a new password satisfying the existing 15-character policy. The server rechecks the active session and user row inside a transaction, conditionally updates the password hash, revokes all other active sessions, and retains the current browser session.
- **Account deletion:** `DELETE /api/account` requires the current password and the literal confirmation `DELETE`. The transaction removes interview rows first because interviews can RESTRICT deletion of referenced contacts, then deletes the user so existing user/session/opportunity cascades remove the account-owned data. The current session cookie is cleared on success.
- Every mutation requires an authenticated session, exact trusted Origin, JSON content type, authenticated CSRF token and strict schema validation. Profile, password and deletion mutations have separate IP rate limiters. Responses use `Cache-Control: no-store`.
- Account Settings sends a best-effort password-change notification. Email delivery failure does not roll back a successfully committed password update.
- Password changes from Settings preserve the current browser session and revoke other sessions; password resets continue to revoke all existing sessions.



## Email delivery and configuration

The server uses Nodemailer with Gmail SMTP over TLS on port 465. The shared templates in `server/src/services/accountEmails.ts` produce branded responsive HTML and plain-text versions for registration verification, verification resend, password-reset requests, password-reset completion notifications and Account Settings password-change notifications. Action buttons include a visible fallback URL; tokens remain in the URL fragment rather than the initial HTTP request. Verification remains 24 hours and password reset remains one hour.

Configure these server-only variables together:

- `SMTP_USER` — dedicated Gmail sender address.
- `SMTP_PASS` — Google app password.
- `APP_BASE_URL` — exact canonical application origin; HTTPS in production.

Do not expose these settings through `VITE_*`, commit them, or derive account links from request Host headers. Standard Gmail accounts are suitable for low-volume project email, not high-volume transactional delivery.

## Database

Migration `002_auth_pre_sessions.sql` adds short-lived pre-authentication sessions. Migration `003_email_verification_password_reset.sql` adds the email-verification timestamp and purpose-bound action-token table. Migration `006_account_profile.sql` adds `users.display_name VARCHAR(80) NOT NULL DEFAULT ''` for Account Settings. Migration `007_opportunity_contract_type.sql` expands the opportunity type constraint to include Contract. All are forward-only migrations. The hosted Launchboard TiDB database records migrations 001–007. Migration 007 adds Contract to the opportunity type CHECK; it was applied after a fresh pre-migration export and live postflight. The workstation's local XAMPP schema is separate and was not changed by the hosted migrations.

Use the dedicated `launchboard` database only. Runtime and migration credentials are separate; the runtime account must not receive schema-altering privileges. See [server setup](../server/README.md) and [deployment readiness](deployment-readiness.md).

## Operational limitations

- Rate-limit counters are stored in process memory and are not shared between server instances. A shared store is required before horizontal scaling.
- Gmail has sending limits and is appropriate only for low-volume use.
- This design is not a penetration test, independent security audit, or security certification.
- Production environment secrets must remain in the hosting provider's secret manager. Do not copy them into source files, chat messages, or browser-exposed variables.

## Verification record

The authentication/account implementation is covered by focused frontend and backend tests, TypeScript checks, route integration tests and migration verification. The 10 November 2026 email-template and Contract-type integration finished with 633/633 server tests passing across 39 files, plus a strict server TypeScript check and production build. The HTML template tests use a fake sender; no live test email was sent and no Gmail inbox rendering was visually inspected for the new HTML design. Do not interpret unit tests as proof of production email deliverability. Hosted migration 006 and live schema/grant verification are recorded in `docs/deployment-readiness.md`.
