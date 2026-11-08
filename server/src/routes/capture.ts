import express, { Router } from 'express';
import type { Request, RequestHandler, Response } from 'express';
import type { Pool } from 'mysql2/promise';
import { rateLimit } from 'express-rate-limit';
import { ApiError } from '../errors.js';
import { parseAuthEnv } from '../config/env.js';
import { parseCookies, SESSION_COOKIE_NAME } from '../auth/cookies.js';
import { verifyCsrfToken } from '../auth/csrf.js';
import { findActiveAuthSession } from '../auth/sessionRepo.js';
import { isExactOriginAllowed } from '../auth/origin.js';
import { isValidToken } from '../auth/tokens.js';
import { capturePreviewBodySchema } from '../validation/captureSchemas.js';
import { previewOpportunityUrl, type OpportunityCapturePreviewService } from '../services/opportunityCaptureService.js';

const MAX_PREVIEW_REQUEST_BYTES = 2048;
const MAX_CONCURRENT_PREVIEWS_PER_INSTANCE = 2;
let activePreviews = 0;

const noStore: RequestHandler = (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  next();
};

const requireCapturePreviewEnabled: RequestHandler = (_req, _res, next) => {
  // Production stays fail-closed until the dedicated Vercel WAF rule has been
  // configured and verified, then explicitly enabled by deployment config.
  if (process.env.CAPTURE_PREVIEW_ENABLED !== 'true') {
    next(new ApiError(503, 'NOT_READY', 'Authenticated preview is not enabled.'));
    return;
  }
  next();
};

function createPreviewIpLimiter(): RequestHandler {
  return rateLimit({
    windowMs: 60 * 1000,
    limit: 5,
    identifier: 'capture-preview-ip',
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    ipv6Subnet: 56,
    passOnStoreError: false,
    handler: (_req, _res, next) => {
      next(new ApiError(429, 'RATE_LIMITED', 'Too many requests. Please try again later.'));
    },
  });
}

function validatePreviewHeaders(req: Request): string {
  const authEnv = parseAuthEnv(process.env);
  if (!authEnv) {
    throw new ApiError(503, 'NOT_READY', 'Authenticated preview is unavailable.');
  }

  if (!isExactOriginAllowed(req.get('Origin'), authEnv.trustedOrigins)) {
    throw new ApiError(403, 'FORBIDDEN', 'Origin not allowed.');
  }

  const contentType = (req.get('Content-Type') ?? '')
    .split(';', 1)[0]
    ?.trim()
    .toLowerCase();
  if (contentType !== 'application/json') {
    throw new ApiError(400, 'INVALID_REQUEST', 'Content-Type must be application/json.');
  }

  const contentEncoding = (req.get('Content-Encoding') ?? 'identity').trim().toLowerCase();
  if (contentEncoding !== 'identity') {
    throw new ApiError(415, 'INVALID_REQUEST', 'Compressed request bodies are not supported.');
  }

  const contentLength = req.get('Content-Length');
  if (contentLength !== undefined) {
    if (!/^\d+$/u.test(contentLength)) {
      throw new ApiError(400, 'INVALID_REQUEST', 'Content-Length is invalid.');
    }
    if (Number(contentLength) > MAX_PREVIEW_REQUEST_BYTES) {
      throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'The request body exceeds the maximum allowed size.');
    }
  }

  const cookies = parseCookies(req.headers.cookie);
  const sessionToken = cookies[SESSION_COOKIE_NAME];
  if (typeof sessionToken !== 'string' || !isValidToken(sessionToken)) {
    throw new ApiError(401, 'UNAUTHORIZED', 'Authentication required.');
  }

  const submittedCsrf = req.get('X-CSRF-Token');
  if (
    typeof submittedCsrf !== 'string' ||
    !verifyCsrfToken(authEnv.csrfSecret, 'authenticated', sessionToken, submittedCsrf)
  ) {
    throw new ApiError(403, 'FORBIDDEN', 'CSRF validation failed.');
  }

  return sessionToken;
}

function asyncMiddleware(
  handler: (req: Request, res: Response) => Promise<void>,
): RequestHandler {
  return (req, res, next) => {
    void handler(req, res).catch(next);
  };
}

export interface CaptureRouterOptions {
  preview?: OpportunityCapturePreviewService;
}

export function createCaptureRouter(
  pool: Pool | null,
  options: CaptureRouterOptions = {},
) {
  const router = Router();
  const preview = options.preview ?? previewOpportunityUrl;
  const previewIpLimiter = createPreviewIpLimiter();

  router.post(
    '/preview',
    noStore,
    requireCapturePreviewEnabled,
    previewIpLimiter,
    asyncMiddleware(async (req, res) => {
      if (!pool) {
        throw new ApiError(503, 'NOT_READY', 'Authenticated preview is unavailable.');
      }

      // Authorization is intentionally performed before JSON parsing. This
      // route must never parse anonymous or cross-origin preview request bodies.
      const sessionToken = validatePreviewHeaders(req);
      const session = await findActiveAuthSession(pool, sessionToken);
      if (!session) {
        throw new ApiError(401, 'UNAUTHORIZED', 'Authentication required.');
      }

      // A small route-specific parser runs only after origin, CSRF and active
      // session checks. It is mounted after the app-wide parser is bypassed.
      await new Promise<void>((resolve, reject) => {
        express.json({
          limit: MAX_PREVIEW_REQUEST_BYTES,
          strict: true,
          type: 'application/json',
          inflate: false,
        })(req, res, (error?: unknown) => {
          if (error) reject(error);
          else resolve();
        });
      });

      const parsed = capturePreviewBodySchema.safeParse(req.body);
      if (!parsed.success) {
        throw new ApiError(422, 'VALIDATION_ERROR', 'Enter one valid HTTP(S) opportunity URL.');
      }

      if (activePreviews >= MAX_CONCURRENT_PREVIEWS_PER_INSTANCE) {
        throw new ApiError(429, 'RATE_LIMITED', 'Preview capacity is busy. Try again shortly.');
      }

      activePreviews += 1;
      try {
        const result = await preview(parsed.data.url);
        res.status(200).json(result);
      } finally {
        activePreviews -= 1;
      }
    }),
  );

  return router;
}
