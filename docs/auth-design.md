# Launchboard authentication design

**Current status — 3 November 2026:** the authentication, email-verification, and password-recovery flows are implemented. The API-mode UI includes sign-in, registration, verification, resend-verification, forgot-password, and reset-password states. The localStorage workspace remains the default and does not require an account.

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

## Email delivery and configuration

The server uses Nodemailer with Gmail SMTP over TLS on port 465. Configure these server-only variables together:

- `SMTP_USER` — dedicated Gmail sender address.
- `SMTP_PASS` — Google app password.
- `APP_BASE_URL` — exact canonical application origin; HTTPS in production.

Do not expose these settings through `VITE_*`, commit them, or derive account links from request Host headers. Standard Gmail accounts are suitable for low-volume project email, not high-volume transactional delivery.

## Database

Migration `002_auth_pre_sessions.sql` adds short-lived pre-authentication sessions. Migration `003_email_verification_password_reset.sql` adds the email-verification timestamp and purpose-bound action-token table. Both are additive migrations.

Use the dedicated `launchboard` database only. Runtime and migration credentials are separate; the runtime account must not receive schema-altering privileges. See [server setup](../server/README.md) and [deployment readiness](deployment-readiness.md).

## Operational limitations

- Rate-limit counters are stored in process memory and are not shared between server instances. A shared store is required before horizontal scaling.
- Gmail has sending limits and is appropriate only for low-volume use.
- This design is not a penetration test, independent security audit, or security certification.
- Production environment secrets must remain in the hosting provider's secret manager. Do not copy them into source files, chat messages, or browser-exposed variables.

## Verification record

The implementation was covered by focused frontend and backend tests, TypeScript checks, local migration verification, and a local synthetic registration/verification/login/reset lifecycle using a fake mail sender. Production rollout and manual email-delivery checks are tracked separately in the deployment record; do not interpret unit tests as proof of production email deliverability.
