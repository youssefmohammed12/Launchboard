import type { RequestHandler } from 'express';
import { ApiError } from '../errors.js';

/** Any request that reached this middleware matched no registered route. */
export const notFound: RequestHandler = (_req, _res, next) => {
  next(new ApiError(404, 'NOT_FOUND', 'The requested resource was not found.'));
};
