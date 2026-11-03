import { randomUUID } from 'node:crypto';
import type { ErrorRequestHandler } from 'express';
import { ApiError } from '../errors.js';
import { buildErrorEnvelope } from '../http/errorEnvelope.js';

interface HttpErrorLike {
  status?: unknown;
  statusCode?: unknown;
  type?: unknown;
}

function asHttpError(value: unknown): HttpErrorLike | null {
  return typeof value === 'object' && value !== null ? (value as HttpErrorLike) : null;
}

function numericStatus(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

/**
 * Converts any thrown value into a safe ApiError. Unknown errors become a
 * generic 500 so stack traces, SQL text and library internals never escape.
 */
export function normalizeError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;

  const httpError = asHttpError(error);
  if (httpError) {
    if (httpError.type === 'entity.parse.failed') {
      return new ApiError(400, 'INVALID_JSON', 'The request body is not valid JSON.');
    }

    const status = numericStatus(httpError.status) ?? numericStatus(httpError.statusCode);
    if (httpError.type === 'entity.too.large' || status === 413) {
      return new ApiError(
        413,
        'PAYLOAD_TOO_LARGE',
        'The request body exceeds the maximum allowed size.',
      );
    }
    if (status !== null && status >= 400 && status < 500) {
      return new ApiError(status, 'INVALID_REQUEST', 'The request could not be processed.');
    }
  }

  return new ApiError(500, 'INTERNAL_ERROR', 'An unexpected error occurred.');
}

export interface ErrorHandlerOptions {
  /**
   * Logs sanitized server failures and security/conflict events with request
   * IDs. Raw errors, request bodies and credentials are never written.
   * Disabled in tests unless a test explicitly enables it.
   */
  logErrors?: boolean;
}

export function createErrorHandler(options: ErrorHandlerOptions = {}): ErrorRequestHandler {
  const logErrors = options.logErrors ?? true;

  return (error, req, res, next) => {
    if (res.headersSent) {
      next(error);
      return;
    }

    const requestId = req.requestId ?? randomUUID();
    const parseError =
      typeof error === 'object' && error !== null &&
      (error as { type?: unknown }).type === 'entity.parse.failed';
    const isBackupImport =
      req.method === 'POST' && req.originalUrl.split('?', 1)[0] === '/api/opportunities/import';
    const apiError = isBackupImport && parseError
      ? new ApiError(
          422,
          'INVALID_BACKUP',
          'The backup file is not valid JSON.',
          { reason: 'invalid-json' },
        )
      : normalizeError(error);

    if (logErrors && apiError.status >= 500) {
      // Keep diagnostics correlatable without serializing driver errors,
      // SQL parameters, request bodies, cookies, tokens or credentials.
      console.error(`[launchboard-api] ${requestId} ${apiError.code}`);
    } else if (
      logErrors &&
      [401, 403, 409, 412, 428, 429].includes(apiError.status)
    ) {
      // Authentication failures, conflicts and rate-limit events are useful
      // security signals; log only the safe code and request ID.
      console.warn(`[launchboard-api] ${requestId} ${apiError.code}`);
    }

    res.status(apiError.status).json(buildErrorEnvelope(apiError, requestId));
  };
}
