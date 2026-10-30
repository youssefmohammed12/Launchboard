import type { Request, RequestHandler } from 'express';
import type { ZodError, ZodType } from 'zod';
import { ApiError } from '../errors.js';

/** Bounds the response size when a body contains many invalid fields. */
const MAX_FIELD_ERRORS = 25;

export interface ValidationFieldError {
  path: string;
  message: string;
}

/** Formats a Zod issue path as `interviews[0].contactId` or `(root)`. */
export function formatIssuePath(path: readonly PropertyKey[]): string {
  if (path.length === 0) return '(root)';
  let formatted = '';
  for (const part of path) {
    if (typeof part === 'number') {
      formatted += `[${part}]`;
    } else if (formatted === '') {
      formatted += String(part);
    } else {
      formatted += `.${String(part)}`;
    }
  }
  return formatted || '(root)';
}

/**
 * Maps Zod issues to the documented `422 VALIDATION_ERROR` details. Zod
 * messages describe the rule, not the submitted value, so raw input is never
 * echoed back.
 */
export function validationErrorFromZod(error: ZodError): ApiError {
  const fields: ValidationFieldError[] = [];
  for (const issue of error.issues) {
    if (fields.length >= MAX_FIELD_ERRORS) break;
    fields.push({ path: formatIssuePath(issue.path), message: issue.message });
  }
  return new ApiError(
    422,
    'VALIDATION_ERROR',
    'The request contains invalid fields.',
    { fields },
  );
}

/**
 * Validates `req.body` against a runtime schema. On success the parsed value is
 * attached to `req.validatedBody`; on failure the route handler is skipped and
 * the shared error handler renders a 422 envelope.
 */
export function validateBody<T>(schema: ZodType<T>): RequestHandler {
  return (req, _res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      next(validationErrorFromZod(result.error));
      return;
    }
    req.validatedBody = result.data;
    next();
  };
}

/**
 * Typed accessor for a body validated by `validateBody`. The generic is the
 * schema's output type, so route handlers stay explicit about their DTO.
 */
export function validatedBody<T>(req: Request): T {
  return req.validatedBody as T;
}
