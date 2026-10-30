/**
 * Stable machine-readable error codes. The HTTP foundation owns only the codes
 * it can currently produce; later stages extend this union as endpoints land.
 */
export type ApiErrorCode =
  | 'NOT_FOUND'
  | 'INVALID_JSON'
  | 'INVALID_REQUEST'
  | 'PAYLOAD_TOO_LARGE'
  | 'VALIDATION_ERROR'
  | 'NOT_READY'
  | 'INTERNAL_ERROR';

export type ApiErrorDetails = Record<string, unknown>;

/**
 * An error that is safe to render to the client. Messages must never contain
 * stack traces, SQL, credentials, raw request bodies or environment values.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly details?: ApiErrorDetails;

  constructor(
    status: number,
    code: ApiErrorCode,
    message: string,
    details?: ApiErrorDetails,
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
