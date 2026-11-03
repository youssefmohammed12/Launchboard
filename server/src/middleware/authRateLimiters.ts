import { createHmac, randomBytes } from 'node:crypto';
import type { Request } from 'express';
import { rateLimit } from 'express-rate-limit';
import type { RateLimitRequestHandler } from 'express-rate-limit';
import { isValidEmailAddress, normalizeEmailAddress } from '../auth/accountIdentifier.js';
import { ApiError } from '../errors.js';

export const AUTH_RATE_LIMITS = {
  registrationPerIp: { limit: 3, windowMs: 60 * 60 * 1000 },
  loginPerIp: { limit: 5, windowMs: 15 * 60 * 1000 },
  loginPerAccount: { limit: 10, windowMs: 15 * 60 * 1000 },
  preSessionPerIp: { limit: 10, windowMs: 15 * 60 * 1000 },
  resendVerificationPerIp: { limit: 3, windowMs: 15 * 60 * 1000 },
  passwordResetPerIp: { limit: 5, windowMs: 15 * 60 * 1000 },
  passwordResetConfirmPerIp: { limit: 5, windowMs: 15 * 60 * 1000 },
  accountActionPerIdentifier: { limit: 6, windowMs: 60 * 60 * 1000 },
} as const;

// Email addresses are PII. Store only an HMAC-derived key in the in-memory
// limiter, never the normalized address itself. A process-local key is enough
// because the MemoryStore is also process-local and is cleared at restart.
const ACCOUNT_KEY_SECRET = randomBytes(32);

function getNormalizedAccountIdentifier(request: Request): string | null {
  if (
    typeof request.body !== 'object' ||
    request.body === null ||
    Array.isArray(request.body)
  ) {
    return null;
  }

  const email = (request.body as Record<string, unknown>).email;
  if (typeof email !== 'string') return null;

  const normalized = normalizeEmailAddress(email);
  return isValidEmailAddress(normalized) ? normalized : null;
}

function accountRateLimitKey(request: Request): string {
  const identifier = getNormalizedAccountIdentifier(request);
  if (!identifier) return 'account:missing-or-invalid';

  const digest = createHmac('sha256', ACCOUNT_KEY_SECRET)
    .update('launchboard:login-account:v1:')
    .update(identifier)
    .digest('hex');

  return `account:${digest}`;
}

function accountActionRateLimitKey(request: Request): string {
  const identifier = getNormalizedAccountIdentifier(request);
  if (!identifier) return 'account-action:missing-or-invalid';

  const digest = createHmac('sha256', ACCOUNT_KEY_SECRET)
    .update('launchboard:account-action:v1:')
    .update(identifier)
    .digest('hex');

  return `account-action:${digest}`;
}

function createLimiter(
  identifier: string,
  limit: number,
  windowMs: number,
  extraOptions: {
    keyGenerator?: (request: Request) => string;
    skip?: (request: Request) => boolean;
  } = {},
): RateLimitRequestHandler {
  return rateLimit({
    windowMs,
    limit,
    identifier,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    ...(extraOptions.keyGenerator ? {} : { ipv6Subnet: 56 }),
    passOnStoreError: false,
    ...(extraOptions.keyGenerator ? { keyGenerator: extraOptions.keyGenerator } : {}),
    ...(extraOptions.skip ? { skip: extraOptions.skip } : {}),
    handler: (_request, _response, next) => {
      next(
        new ApiError(
          429,
          'RATE_LIMITED',
          'Too many requests. Please try again later.',
        ),
      );
    },
  });
}

export interface AuthRateLimiters {
  registrationByIp: RateLimitRequestHandler;
  loginByIp: RateLimitRequestHandler;
  loginByAccount: RateLimitRequestHandler;
  preSessionByIp: RateLimitRequestHandler;
  resendVerificationByIp: RateLimitRequestHandler;
  passwordResetByIp: RateLimitRequestHandler;
  passwordResetConfirmByIp: RateLimitRequestHandler;
  accountActionByIdentifier: RateLimitRequestHandler;
}

/**
 * Creates independent in-memory authentication limiters for one Express app.
 * The default store is intentionally single-process; use a shared store before
 * deploying multiple server instances.
 */
export function createAuthRateLimiters(): AuthRateLimiters {
  return {
    registrationByIp: createLimiter(
      'registration-ip',
      AUTH_RATE_LIMITS.registrationPerIp.limit,
      AUTH_RATE_LIMITS.registrationPerIp.windowMs,
    ),
    loginByIp: createLimiter(
      'login-ip',
      AUTH_RATE_LIMITS.loginPerIp.limit,
      AUTH_RATE_LIMITS.loginPerIp.windowMs,
    ),
    loginByAccount: createLimiter(
      'login-account',
      AUTH_RATE_LIMITS.loginPerAccount.limit,
      AUTH_RATE_LIMITS.loginPerAccount.windowMs,
      {
        keyGenerator: accountRateLimitKey,
        skip: (request) => getNormalizedAccountIdentifier(request) === null,
      },
    ),
    preSessionByIp: createLimiter(
      'pre-session-ip',
      AUTH_RATE_LIMITS.preSessionPerIp.limit,
      AUTH_RATE_LIMITS.preSessionPerIp.windowMs,
    ),
    resendVerificationByIp: createLimiter(
      'resend-verification-ip',
      AUTH_RATE_LIMITS.resendVerificationPerIp.limit,
      AUTH_RATE_LIMITS.resendVerificationPerIp.windowMs,
    ),
    passwordResetByIp: createLimiter(
      'password-reset-ip',
      AUTH_RATE_LIMITS.passwordResetPerIp.limit,
      AUTH_RATE_LIMITS.passwordResetPerIp.windowMs,
    ),
    passwordResetConfirmByIp: createLimiter(
      'password-reset-confirm-ip',
      AUTH_RATE_LIMITS.passwordResetConfirmPerIp.limit,
      AUTH_RATE_LIMITS.passwordResetConfirmPerIp.windowMs,
    ),
    accountActionByIdentifier: createLimiter(
      'account-action-identifier',
      AUTH_RATE_LIMITS.accountActionPerIdentifier.limit,
      AUTH_RATE_LIMITS.accountActionPerIdentifier.windowMs,
      {
        keyGenerator: accountActionRateLimitKey,
        skip: (request) => getNormalizedAccountIdentifier(request) === null,
      },
    ),
  };
}
