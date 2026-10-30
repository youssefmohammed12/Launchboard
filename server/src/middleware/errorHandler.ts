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
   * Log unexpected 5xx causes server-side with the request ID. Disabled in
   * tests so intentional failures do not pollute the test output.
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
    const apiError = normalizeError(error);

    if (apiError.status >= 500 && logErrors) {
      console.error(`[launchboard-api] ${requestId} ${apiError.code}:`, error);
    }

    res.status(apiError.status).json(buildErrorEnvelope(apiError, requestId));
  };
}
