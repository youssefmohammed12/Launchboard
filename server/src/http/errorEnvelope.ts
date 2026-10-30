import type { ApiError } from '../errors.js';

/**
 * The single JSON error envelope used by every failure response:
 *
 * {
 *   "error": {
 *     "code": "VALIDATION_ERROR",
 *     "message": "The request contains invalid fields.",
 *     "details": { "fields": [{ "path": "title", "message": "..." }] },
 *     "requestId": "..."
 *   }
 * }
 */
export interface ApiErrorBody {
  code: string;
  message: string;
  details?: unknown;
  requestId: string;
}

export interface ErrorEnvelope {
  error: ApiErrorBody;
}

export function buildErrorEnvelope(error: ApiError, requestId: string): ErrorEnvelope {
  return {
    error: {
      code: error.code,
      message: error.message,
      ...(error.details !== undefined ? { details: error.details } : {}),
      requestId,
    },
  };
}
