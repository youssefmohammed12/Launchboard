import { Router } from 'express';
import type { Pool } from 'mysql2/promise';
import type { Request, RequestHandler } from 'express';
import { ApiError } from '../errors.js';
import { parseAuthEnv, parseEmailEnv, type EmailServiceConfig } from '../config/env.js';
import { isExactOriginAllowed } from '../auth/origin.js';
import { verifyCsrfToken } from '../auth/csrf.js';
import { parseCookies, SESSION_COOKIE_NAME, serializeCookie, clearSessionCookieOptions } from '../auth/cookies.js';
import { isValidToken } from '../auth/tokens.js';
import { verifyPassword, hashPassword } from '../auth/password.js';
import { createRequireAuth, type AuthenticatedRequest } from '../middleware/requireAuth.js';
import { createAuthRateLimiters } from '../middleware/authRateLimiters.js';
import { acquireUtcConnection } from '../db/pool.js';
import { updateProfileSchema, changePasswordSchema, deleteAccountSchema } from '../validation/accountSettingsSchemas.js';
import { sendEmail, type EmailMessage } from '../services/emailService.js';
import { createPasswordChangedEmail } from '../services/accountEmails.js';

export type AccountSettingsEmailSender = (config: EmailServiceConfig, message: EmailMessage) => Promise<void>;

interface AccountSettingsOptions {
  emailSender?: AccountSettingsEmailSender;
}

interface ProfileRow {
  id: string;
  email: string;
  display_name: string;
  email_verified_at: string | Date | null;
  created_at: string | Date;
}

interface CredentialRow {
  id: string;
  email: string;
  password_hash: string;
}

function authContext(req: Request): { userId: string; sessionId: string } {
  const auth = (req as AuthenticatedRequest).auth;
  if (!auth?.userId || !auth.sessionId) {
    throw new ApiError(401, 'UNAUTHORIZED', 'Authentication required.');
  }
  return { userId: auth.userId, sessionId: auth.sessionId };
}

function validateMutationSecurity(req: Request): void {
  let authEnv;
  try {
    authEnv = parseAuthEnv(process.env);
  } catch {
    throw new ApiError(500, 'INTERNAL_ERROR', 'Authentication is not configured.');
  }
  if (!authEnv) throw new ApiError(500, 'INTERNAL_ERROR', 'Authentication is not configured.');

  const origin = req.headers.origin as string | undefined;
  if (!isExactOriginAllowed(origin, authEnv.trustedOrigins)) {
    throw new ApiError(403, 'FORBIDDEN', 'Origin not allowed.');
  }

  const contentType = ((req.get('Content-Type') ?? '').split(';', 1)[0] ?? '').trim().toLowerCase();
  if (contentType !== 'application/json') {
    throw new ApiError(400, 'INVALID_REQUEST', 'Content-Type must be application/json.');
  }

  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE_NAME];
  if (typeof token !== 'string' || !isValidToken(token)) {
    throw new ApiError(401, 'UNAUTHORIZED', 'Authentication required.');
  }
  const csrf = req.get('X-CSRF-Token');
  if (typeof csrf !== 'string' || !verifyCsrfToken(authEnv.csrfSecret, 'authenticated', token, csrf)) {
    throw new ApiError(403, 'FORBIDDEN', 'CSRF validation failed.');
  }
}

function parseBody<T>(schema: { safeParse: (value: unknown) => { success: boolean; data?: T; error?: { issues: Array<{ path: PropertyKey[]; message: string }> } } }, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success || parsed.data === undefined) {
    const fields = Object.fromEntries((parsed.error?.issues ?? []).map((issue) => [
      issue.path.map(String).join('.'),
      issue.message,
    ]));
    throw new ApiError(422, 'VALIDATION_ERROR', 'Account settings are invalid.', { fields });
  }
  return parsed.data;
}

function noStore(_req: Request, res: import('express').Response, next: () => void): void {
  res.setHeader('Cache-Control', 'no-store');
  next();
}

export function createAccountSettingsRouter(
  pool: Pool | null,
  options: AccountSettingsOptions = {},
): Router {
  const router = Router();
  const rateLimiters = createAuthRateLimiters();
  const emailSender = options.emailSender ?? sendEmail;

  if (!pool) {
    router.use('/account', (_req, _res, next) => next(new ApiError(503, 'NOT_READY', 'Service unavailable.')));
    return router;
  }

  router.use('/account', createRequireAuth(pool));

  router.get('/account/profile', noStore, (async (req, res, next) => {
    try {
      const { userId } = authContext(req);
      const [rows] = await pool.execute(
        `SELECT id, email, display_name, email_verified_at, created_at
         FROM users WHERE id = ? LIMIT 1`,
        [userId],
      ) as unknown as [ProfileRow[], unknown];
      const profile = rows[0];
      if (!profile) return next(new ApiError(404, 'NOT_FOUND', 'Account not found.'));
      return res.status(200).json({
        profile: {
          id: profile.id,
          email: profile.email,
          displayName: profile.display_name,
          emailVerified: profile.email_verified_at !== null,
          createdAt: profile.created_at,
        },
      });
    } catch {
      return next(new ApiError(503, 'NOT_READY', 'Service unavailable.'));
    }
  }) as RequestHandler);

  router.patch(
    '/account/profile',
    noStore,
    rateLimiters.accountProfileUpdateByIp,
    (async (req, res, next) => {
      try {
        validateMutationSecurity(req);
        const { userId } = authContext(req);
        const input = parseBody(updateProfileSchema, req.body);
        const [result] = await pool.execute(
          'UPDATE users SET display_name = ?, updated_at = UTC_TIMESTAMP(3) WHERE id = ?',
          [input.displayName, userId],
        ) as unknown as [{ affectedRows?: number }, unknown];
        if ((result.affectedRows ?? 0) === 0) {
          const [rows] = await pool.execute('SELECT id FROM users WHERE id = ? LIMIT 1', [userId]) as unknown as [Array<{ id: string }>, unknown];
          if (!rows[0]) return next(new ApiError(404, 'NOT_FOUND', 'Account not found.'));
        }
        return res.status(200).json({ profile: { displayName: input.displayName } });
      } catch (error) {
        return next(error instanceof ApiError ? error : new ApiError(503, 'NOT_READY', 'Service unavailable.'));
      }
    }) as RequestHandler,
  );

  router.post(
    '/account/password',
    noStore,
    rateLimiters.accountPasswordChangeByIp,
    (async (req, res, next) => {
      let connection: Awaited<ReturnType<typeof acquireUtcConnection>> | null = null;
      let transactionStarted = false;
      let notificationEmail: string | null = null;
      try {
        validateMutationSecurity(req);
        const { userId, sessionId } = authContext(req);
        const input = parseBody(changePasswordSchema, req.body);

        const [users] = await pool.execute(
          'SELECT id, email, password_hash FROM users WHERE id = ? LIMIT 1',
          [userId],
        ) as unknown as [CredentialRow[], unknown];
        const user = users[0];
        if (!user) return next(new ApiError(404, 'NOT_FOUND', 'Account not found.'));
        if (!(await verifyPassword(input.currentPassword, user.password_hash))) {
          return next(new ApiError(403, 'INVALID_CREDENTIALS', 'Your current password is incorrect.'));
        }
        if (input.currentPassword === input.newPassword) {
          return next(new ApiError(422, 'VALIDATION_ERROR', 'Choose a password different from your current password.'));
        }

        const passwordHash = await hashPassword(input.newPassword);
        connection = await acquireUtcConnection(pool);
        await connection.beginTransaction();
        transactionStarted = true;

        const [lockedUsers] = await connection.execute(
          'SELECT id FROM users WHERE id = ? FOR UPDATE',
          [userId],
        ) as unknown as [Array<{ id: string }>, unknown];
        if (!lockedUsers[0]) {
          await connection.rollback();
          transactionStarted = false;
          return next(new ApiError(404, 'NOT_FOUND', 'Account not found.'));
        }

        const [activeSessions] = await connection.execute(
          `SELECT id
           FROM sessions
           WHERE id = ? AND user_id = ? AND revoked_at IS NULL
           FOR UPDATE`,
          [sessionId, userId],
        ) as unknown as [Array<{ id: string }>, unknown];
        if (!activeSessions[0]) {
          await connection.rollback();
          transactionStarted = false;
          return next(new ApiError(401, 'UNAUTHORIZED', 'Your session is no longer active. Sign in again.'));
        }

        const [updated] = await connection.execute(
          `UPDATE users
           SET password_hash = ?, updated_at = UTC_TIMESTAMP(3)
           WHERE id = ? AND password_hash = ?`,
          [passwordHash, userId, user.password_hash],
        ) as unknown as [{ affectedRows?: number }, unknown];
        if ((updated.affectedRows ?? 0) !== 1) {
          await connection.rollback();
          transactionStarted = false;
          return next(new ApiError(409, 'ACCOUNT_CHANGED', 'Your account changed during this request. Sign in again and retry.'));
        }

        await connection.execute(
          `UPDATE sessions
           SET revoked_at = UTC_TIMESTAMP(3)
           WHERE user_id = ? AND id <> ? AND revoked_at IS NULL`,
          [userId, sessionId],
        );
        await connection.commit();
        transactionStarted = false;
        notificationEmail = user.email;
      } catch (error) {
        if (transactionStarted && connection) {
          try { await connection.rollback(); } catch { /* Preserve the safe response. */ }
        }
        return next(error instanceof ApiError
          ? error
          : new ApiError(503, 'NOT_READY', 'Service unavailable.'));
      } finally {
        connection?.release();
      }

      if (notificationEmail) {
        try {
          const emailConfig = parseEmailEnv(process.env);
          if (emailConfig) await emailSender(emailConfig, createPasswordChangedEmail(notificationEmail, emailConfig.appBaseUrl, 'account-settings'));
        } catch {
          // The committed password change must not be undone by a notification failure.
        }
      }

      return res.status(200).json({
        message: 'Your password has been changed. Other active sessions were signed out.',
      });
    }) as RequestHandler,
  );

  router.delete(
    '/account',
    noStore,
    rateLimiters.accountDeletionByIp,
    (async (req, res, next) => {
      let connection: Awaited<ReturnType<typeof acquireUtcConnection>> | null = null;
      let transactionStarted = false;
      try {
        validateMutationSecurity(req);
        const { userId, sessionId } = authContext(req);
        const input = parseBody(deleteAccountSchema, req.body);
        connection = await acquireUtcConnection(pool);
        await connection.beginTransaction();
        transactionStarted = true;

        const [users] = await connection.execute(
          'SELECT id, password_hash FROM users WHERE id = ? FOR UPDATE',
          [userId],
        ) as unknown as [Array<{ id: string; password_hash: string }>, unknown];
        const user = users[0];
        if (!user) {
          await connection.rollback();
          transactionStarted = false;
          return next(new ApiError(404, 'NOT_FOUND', 'Account not found.'));
        }

        const [activeSessions] = await connection.execute(
          `SELECT id
           FROM sessions
           WHERE id = ? AND user_id = ? AND revoked_at IS NULL
           FOR UPDATE`,
          [sessionId, userId],
        ) as unknown as [Array<{ id: string }>, unknown];
        if (!activeSessions[0]) {
          await connection.rollback();
          transactionStarted = false;
          return next(new ApiError(401, 'UNAUTHORIZED', 'Your session is no longer active. Sign in again.'));
        }

        if (!(await verifyPassword(input.currentPassword, user.password_hash))) {
          await connection.rollback();
          transactionStarted = false;
          return next(new ApiError(403, 'INVALID_CREDENTIALS', 'Your current password is incorrect.'));
        }

        // Interviews can RESTRICT deletion of their referenced contacts.
        // Remove the user's interviews first; the remaining opportunity-owned
        // records are then removed through the existing opportunity/user cascades.
        await connection.execute(
          `DELETE interview
           FROM interviews AS interview
           INNER JOIN opportunities AS opportunity
             ON opportunity.id = interview.opportunity_id
           WHERE opportunity.user_id = ?`,
          [userId],
        );

        const [deleted] = await connection.execute(
          'DELETE FROM users WHERE id = ?',
          [userId],
        ) as unknown as [{ affectedRows?: number }, unknown];
        if ((deleted.affectedRows ?? 0) !== 1) {
          await connection.rollback();
          transactionStarted = false;
          return next(new ApiError(409, 'ACCOUNT_CHANGED', 'The account changed during this request. Try again.'));
        }
        await connection.commit();
        transactionStarted = false;

        const clearCookie = serializeCookie(
          SESSION_COOKIE_NAME,
          '',
          { ...clearSessionCookieOptions(), maxAge: 0 },
        );
        res.setHeader('Set-Cookie', clearCookie);
        return res.status(204).end();
      } catch (error) {
        if (transactionStarted && connection) {
          try { await connection.rollback(); } catch { /* Preserve the safe response. */ }
        }
        return next(error instanceof ApiError
          ? error
          : new ApiError(503, 'NOT_READY', 'Service unavailable.'));
      } finally {
        connection?.release();
      }
    }) as RequestHandler,
  );

  return router;
}
