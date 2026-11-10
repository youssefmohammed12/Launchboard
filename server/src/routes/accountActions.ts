import { Router } from 'express';
import type { Pool } from 'mysql2/promise';
import type { RequestHandler } from 'express';
import { ApiError } from '../errors.js';
import { isExactOriginAllowed } from '../auth/origin.js';
import {
  parseAuthEnv,
  parseEmailEnv,
  type EmailServiceConfig,
} from '../config/env.js';
import { createAuthRateLimiters } from '../middleware/authRateLimiters.js';
import {
  consumeAccountActionToken,
  createAccountActionToken,
  findAccountActionTokenForUpdate,
  revokeAccountActionTokens,
} from '../auth/accountActionRepo.js';
import { findPreAuthSession } from '../auth/sessionRepo.js';
import { verifyCsrfToken } from '../auth/csrf.js';
import { hashPassword } from '../auth/password.js';
import { isValidToken } from '../auth/tokens.js';
import {
  PRE_SESSION_COOKIE_NAME,
  parseCookies,
} from '../auth/cookies.js';
import {
  emailActionSchema,
  passwordResetSchema,
  verifyEmailSchema,
} from '../validation/accountActionSchemas.js';
import { acquireUtcConnection } from '../db/pool.js';
import {
  sendEmail,
  type EmailMessage,
} from '../services/emailService.js';
import {
  createPasswordChangedEmail,
  createPasswordResetEmail,
  createVerificationEmail,
} from '../services/accountEmails.js';

const GENERIC_ACTION_MESSAGE =
  'If an account is eligible, instructions will be sent to its email address.';

export type AccountActionEmailSender = (
  config: EmailServiceConfig,
  message: EmailMessage,
) => Promise<void>;

interface AccountActionsOptions {
  emailSender?: AccountActionEmailSender;
}

interface UserEmailRow {
  id: string;
  email: string;
  email_verified_at: string | Date | null;
}

function parseInput<T>(
  schema: { safeParse: (value: unknown) => { success: boolean; data?: T; error?: { issues: Array<{ path: PropertyKey[]; message: string }> } } },
  body: unknown,
): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success || parsed.data === undefined) {
    const fields = Object.fromEntries(
      (parsed.error?.issues ?? []).map((issue) => [
        issue.path.map(String).join('.'),
        issue.message,
      ]),
    );
    throw new ApiError(422, 'VALIDATION_ERROR', 'Account action details are invalid.', { fields });
  }
  return parsed.data;
}

export function createAccountActionsRouter(
  pool: Pool | null,
  options: AccountActionsOptions = {},
): Router {
  const router = Router();
  const rateLimiters = createAuthRateLimiters();
  const emailSender = options.emailSender ?? sendEmail;

  const noStore: RequestHandler = (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  };

  const requirePreAuth: RequestHandler = async (req, _res, next) => {
    if (!pool) {
      return next(new ApiError(503, 'NOT_READY', 'Service unavailable.'));
    }

    let authEnv;
    try {
      authEnv = parseAuthEnv(process.env);
    } catch {
      return next(new ApiError(500, 'INTERNAL_ERROR', 'Authentication is not configured.'));
    }
    if (!authEnv) {
      return next(new ApiError(500, 'INTERNAL_ERROR', 'Authentication is not configured.'));
    }

    const origin = req.headers.origin as string | undefined;
    if (!isExactOriginAllowed(origin, authEnv.trustedOrigins)) {
      return next(new ApiError(403, 'FORBIDDEN', 'Origin not allowed.'));
    }
    if (!req.is('application/json')) {
      return next(new ApiError(400, 'INVALID_REQUEST', 'Content-Type must be application/json.'));
    }

    const cookies = parseCookies(req.headers.cookie);
    const preSessionToken = cookies[PRE_SESSION_COOKIE_NAME];
    if (typeof preSessionToken !== 'string' || !isValidToken(preSessionToken)) {
      return next(new ApiError(403, 'FORBIDDEN', 'A valid pre-authentication session is required.'));
    }

    try {
      const preSession = await findPreAuthSession(pool, preSessionToken);
      if (!preSession) {
        return next(new ApiError(403, 'FORBIDDEN', 'A valid pre-authentication session is required.'));
      }

      const submittedCsrf = req.get('X-CSRF-Token');
      if (
        typeof submittedCsrf !== 'string' ||
        !verifyCsrfToken(authEnv.csrfSecret, 'pre-auth', preSessionToken, submittedCsrf)
      ) {
        return next(new ApiError(403, 'FORBIDDEN', 'CSRF validation failed.'));
      }

      return next();
    } catch {
      return next(new ApiError(503, 'NOT_READY', 'Service unavailable.'));
    }
  };

  function getEmailConfig(): EmailServiceConfig {
    try {
      const config = parseEmailEnv(process.env);
      if (!config) {
        throw new ApiError(503, 'NOT_READY', 'Email delivery is not configured.');
      }
      return config;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(503, 'NOT_READY', 'Email delivery is not configured.');
    }
  }

  async function sendWithoutDisclosure(
    config: EmailServiceConfig,
    message: EmailMessage,
  ): Promise<void> {
    try {
      await emailSender(config, message);
    } catch {
      // The public response remains identical for unknown and eligible accounts.
      // Do not log provider errors or account details.
    }
  }

  router.post(
    '/auth/verify-email',
    noStore,
    rateLimiters.resendVerificationByIp,
    requirePreAuth,
    (async (req, res, next) => {
      let input;
      try {
        input = parseInput(verifyEmailSchema, req.body);
      } catch (error) {
        return next(error);
      }

      if (!pool) return next(new ApiError(503, 'NOT_READY', 'Service unavailable.'));

      let connection: Awaited<ReturnType<typeof acquireUtcConnection>> | null = null;
      let transactionStarted = false;
      try {
        connection = await acquireUtcConnection(pool);
        await connection.beginTransaction();
        transactionStarted = true;

        const action = await findAccountActionTokenForUpdate(
          connection,
          input.token,
          'verify_email',
        );
        if (!action) {
          await connection.rollback();
          transactionStarted = false;
          return next(new ApiError(400, 'BAD_REQUEST', 'This verification link is invalid or has expired.'));
        }

        const consumed = await consumeAccountActionToken(connection, action.id);
        if (!consumed) {
          await connection.rollback();
          transactionStarted = false;
          return next(new ApiError(400, 'BAD_REQUEST', 'This verification link is invalid or has expired.'));
        }

        await connection.execute(
          `UPDATE users
           SET email_verified_at = COALESCE(email_verified_at, UTC_TIMESTAMP(3)),
               updated_at = UTC_TIMESTAMP(3)
           WHERE id = ?`,
          [action.user_id],
        );
        await revokeAccountActionTokens(connection, action.user_id, 'verify_email');

        await connection.commit();
        transactionStarted = false;
        return res.status(200).json({ message: 'Email verified. You can now sign in.' });
      } catch {
        if (transactionStarted && connection) {
          try { await connection.rollback(); } catch { /* Preserve safe error. */ }
        }
        return next(new ApiError(503, 'NOT_READY', 'Service unavailable.'));
      } finally {
        connection?.release();
      }
    }) as RequestHandler,
  );

  router.post(
    '/auth/resend-verification',
    noStore,
    rateLimiters.resendVerificationByIp,
    rateLimiters.accountActionByIdentifier,
    requirePreAuth,
    (async (req, res, next) => {
      let input: { email: string };
      let emailConfig: EmailServiceConfig;
      try {
        input = parseInput(emailActionSchema, req.body);
        emailConfig = getEmailConfig();
      } catch (error) {
        return next(error);
      }
      if (!pool) return next(new ApiError(503, 'NOT_READY', 'Service unavailable.'));

      let connection: Awaited<ReturnType<typeof acquireUtcConnection>> | null = null;
      try {
        connection = await acquireUtcConnection(pool);
        await connection.beginTransaction();

        const [rows] = await connection.execute(
          `SELECT id, email, email_verified_at
           FROM users
           WHERE email = ?
           LIMIT 1`,
          [input.email],
        ) as unknown as [UserEmailRow[], unknown];
        const user = rows[0];

        if (user && user.email_verified_at === null) {
          const token = await createAccountActionToken(
            connection,
            user.id,
            'verify_email',
            24 * 60,
          );
          await connection.commit();
          await sendWithoutDisclosure(
            emailConfig,
            createVerificationEmail(emailConfig, user.email, token.token),
          );
        } else {
          await connection.commit();
        }

        return res.status(202).json({ message: GENERIC_ACTION_MESSAGE });
      } catch {
        try { await connection?.rollback(); } catch { /* Do not expose driver errors. */ }
        return next(new ApiError(503, 'NOT_READY', 'Service unavailable.'));
      } finally {
        connection?.release();
      }
    }) as RequestHandler,
  );

  router.post(
    '/auth/password-reset/request',
    noStore,
    rateLimiters.passwordResetByIp,
    rateLimiters.accountActionByIdentifier,
    requirePreAuth,
    (async (req, res, next) => {
      let input: { email: string };
      let emailConfig: EmailServiceConfig;
      try {
        input = parseInput(emailActionSchema, req.body);
        emailConfig = getEmailConfig();
      } catch (error) {
        return next(error);
      }
      if (!pool) return next(new ApiError(503, 'NOT_READY', 'Service unavailable.'));

      let connection: Awaited<ReturnType<typeof acquireUtcConnection>> | null = null;
      try {
        connection = await acquireUtcConnection(pool);
        await connection.beginTransaction();

        const [rows] = await connection.execute(
          `SELECT id, email, email_verified_at
           FROM users
           WHERE email = ?
           LIMIT 1`,
          [input.email],
        ) as unknown as [UserEmailRow[], unknown];
        const user = rows[0];

        if (user && user.email_verified_at !== null) {
          const token = await createAccountActionToken(
            connection,
            user.id,
            'reset_password',
            60,
          );
          await connection.commit();
          await sendWithoutDisclosure(
            emailConfig,
            createPasswordResetEmail(emailConfig, user.email, token.token),
          );
        } else {
          await connection.commit();
        }

        return res.status(202).json({ message: GENERIC_ACTION_MESSAGE });
      } catch {
        try { await connection?.rollback(); } catch { /* Do not expose driver errors. */ }
        return next(new ApiError(503, 'NOT_READY', 'Service unavailable.'));
      } finally {
        connection?.release();
      }
    }) as RequestHandler,
  );

  router.post(
    '/auth/password-reset/confirm',
    noStore,
    rateLimiters.passwordResetConfirmByIp,
    requirePreAuth,
    (async (req, res, next) => {
      let input;
      try {
        input = parseInput(passwordResetSchema, req.body);
      } catch (error) {
        return next(error);
      }
      if (!pool) return next(new ApiError(503, 'NOT_READY', 'Service unavailable.'));

      let connection: Awaited<ReturnType<typeof acquireUtcConnection>> | null = null;
      let transactionStarted = false;
      let email: string | null = null;
      try {
        connection = await acquireUtcConnection(pool);
        await connection.beginTransaction();
        transactionStarted = true;

        const action = await findAccountActionTokenForUpdate(
          connection,
          input.token,
          'reset_password',
        );
        if (!action) {
          await connection.rollback();
          transactionStarted = false;
          return next(new ApiError(400, 'BAD_REQUEST', 'This password-reset link is invalid or has expired.'));
        }

        const passwordHash = await hashPassword(input.password);
        const consumed = await consumeAccountActionToken(connection, action.id);
        if (!consumed) {
          await connection.rollback();
          transactionStarted = false;
          return next(new ApiError(400, 'BAD_REQUEST', 'This password-reset link is invalid or has expired.'));
        }

        const [users] = await connection.execute(
          'SELECT email FROM users WHERE id = ? LIMIT 1',
          [action.user_id],
        ) as unknown as [{ email: string }[], unknown];
        email = users[0]?.email ?? null;

        await connection.execute(
          `UPDATE users
           SET password_hash = ?, updated_at = UTC_TIMESTAMP(3)
           WHERE id = ?`,
          [passwordHash, action.user_id],
        );
        await connection.execute(
          `UPDATE sessions
           SET revoked_at = UTC_TIMESTAMP(3)
           WHERE user_id = ? AND revoked_at IS NULL`,
          [action.user_id],
        );
        await revokeAccountActionTokens(connection, action.user_id, 'reset_password');

        await connection.commit();
        transactionStarted = false;
      } catch {
        if (transactionStarted && connection) {
          try { await connection.rollback(); } catch { /* Preserve safe error. */ }
        }
        return next(new ApiError(503, 'NOT_READY', 'Service unavailable.'));
      } finally {
        connection?.release();
      }

      // Password changes remain committed even if this best-effort notification fails.
      if (email) {
        try {
          const emailConfig = parseEmailEnv(process.env);
          if (emailConfig) {
            await emailSender(
              emailConfig,
              createPasswordChangedEmail(email, emailConfig.appBaseUrl, 'password-reset'),
            );
          }
        } catch {
          // Never undo a completed password reset because notification delivery failed.
        }
      }

      return res.status(200).json({
        message: 'Your password has been changed. Sign in with your new password.',
      });
    }) as RequestHandler,
  );

  return router;
}
