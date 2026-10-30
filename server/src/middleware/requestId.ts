import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';

/**
 * A client may suggest a request ID for correlation, but only a conservative
 * character set and length are accepted. Anything else is replaced so log
 * injection and oversized headers cannot reach the application.
 */
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

export function isValidRequestId(value: string): boolean {
  return REQUEST_ID_PATTERN.test(value);
}

export const requestId: RequestHandler = (req, res, next) => {
  const supplied = req.get('X-Request-Id');
  req.requestId = supplied && isValidRequestId(supplied) ? supplied : randomUUID();
  res.setHeader('X-Request-Id', req.requestId);
  next();
};
