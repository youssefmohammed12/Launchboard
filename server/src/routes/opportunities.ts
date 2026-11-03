import { Router } from 'express';
import { z } from 'zod';
import type { Pool } from 'mysql2/promise';
import type { Request, RequestHandler } from 'express';
import { ApiError } from '../errors.js';
import { parseAuthEnv } from '../config/env.js';
import { isExactOriginAllowed } from '../auth/origin.js';
import { verifyCsrfToken } from '../auth/csrf.js';
import { parseCookies, SESSION_COOKIE_NAME } from '../auth/cookies.js';
import { isValidToken } from '../auth/tokens.js';
import { createRequireAuth, type AuthenticatedRequest } from '../middleware/requireAuth.js';
import { validationErrorFromZod } from '../middleware/validateBody.js';
import {
  createOpportunityBodySchema,
  updateOpportunityBodySchema,
} from '../validation/opportunitySchemas.js';
import { idSchema } from '../validation/common.js';
import { backupImportBodySchema } from '../validation/backupSchemas.js';
import { MAX_BACKUP_BYTES } from '@launchboard/domain';
import {
  bulkArchiveOpportunities,
  bulkDeleteOpportunities,
  bulkRestoreOpportunities,
  bulkUndoArchive,
  bulkUpdateOpportunityStatus,
  createOpportunity,
  deleteOpportunity,
  getOpportunity,
  listOpportunities,
  restoreDeletionBatch,
  setOpportunityArchived,
  updateOpportunity,
} from '../services/opportunityService.js';
import {
  exportOpportunities,
  importOpportunities,
} from '../services/backupService.js';
import {
  bulkArchiveBodySchema,
  bulkDeleteBodySchema,
  bulkRestoreBodySchema,
  bulkStatusBodySchema,
  bulkUndoArchiveBodySchema,
} from '../validation/bulkSchemas.js';

const noStore: RequestHandler = (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
};

function userIdFromRequest(req: Request): string {
  const auth = (req as AuthenticatedRequest).auth;
  if (!auth?.userId) {
    throw new ApiError(401, 'UNAUTHORIZED', 'Authentication required.');
  }
  return auth.userId;
}

function validateMutationSecurity(req: Request): void {
  let authEnv;
  try {
    authEnv = parseAuthEnv(process.env);
  } catch {
    throw new ApiError(500, 'INTERNAL_ERROR', 'Authentication is not configured.');
  }
  if (!authEnv) {
    throw new ApiError(500, 'INTERNAL_ERROR', 'Authentication is not configured.');
  }

  const origin = req.headers.origin as string | undefined;
  if (!isExactOriginAllowed(origin, authEnv.trustedOrigins)) {
    throw new ApiError(403, 'FORBIDDEN', 'Origin not allowed.');
  }
  // req.is() returns false for bodyless requests even when the caller
  // explicitly sent Content-Type. Check the header so DELETE/archive/restore
  // can use JSON semantics without requiring a dummy body.
  const contentType = ((req.get('Content-Type') ?? '').split(';', 1)[0] ?? '')
    .trim()
    .toLowerCase();
  if (contentType !== 'application/json') {
    throw new ApiError(400, 'INVALID_REQUEST', 'Content-Type must be application/json.');
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
}

function parseIfMatch(req: Request): number {
  const header = req.get('If-Match');
  if (!header) {
    throw new ApiError(
      428,
      'PRECONDITION_REQUIRED',
      'If-Match is required for this mutation.',
    );
  }

  const match = /^"([1-9]\d*)"$/.exec(header);
  const version = match ? Number(match[1]) : Number.NaN;
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new ApiError(400, 'BAD_REQUEST', 'If-Match must contain a quoted positive version.');
  }
  return version;
}

function requireEmptyObjectBody(req: Request): void {
  // These mutations carry all input in If-Match and do not require a JSON
  // payload. Accept no body or an explicitly empty object, never extra fields.
  if (req.body === undefined) return;
  if (
    typeof req.body !== 'object' ||
    req.body === null ||
    Array.isArray(req.body) ||
    Object.keys(req.body).length !== 0
  ) {
    throw new ApiError(400, 'INVALID_REQUEST', 'Request body must be empty.');
  }
}

function bulkValidationError(error: z.ZodError): never {
  const duplicateIssues = error.issues.filter((issue) =>
    issue.message === 'must not repeat an ID in the same request',
  );
  if (duplicateIssues.length > 0) {
    throw new ApiError(
      422,
      'DUPLICATE_REQUEST_ID',
      'An opportunity ID may appear only once in a bulk request.',
      { fields: duplicateIssues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })) },
    );
  }
  throw validationErrorFromZod(error);
}

function validatedId(value: unknown): string {
  const parsed = idSchema.safeParse(value);
  if (!parsed.success) {
    throw validationErrorFromZod(parsed.error);
  }
  return parsed.data;
}

function asyncRoute(
  handler: (req: Request, res: import('express').Response) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    void handler(req, res).catch(next);
  };
}

export function createOpportunityRouter(pool: Pool | null): Router {
  const router = Router();
  router.use(noStore);

  if (!pool) {
    router.use((_req, _res, next) => {
      next(new ApiError(503, 'NOT_READY', 'Service unavailable.'));
    });
    return router;
  }

  // Reject mutating requests before the session middleware can extend the
  // idle timeout. The cookie is used only to validate the CSRF proof here;
  // createRequireAuth below still verifies the active database session.
  router.use((req, _res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
      return next();
    }
    try {
      validateMutationSecurity(req);
      next();
    } catch (error) {
      next(error);
    }
  });

  router.use(createRequireAuth(pool));

  router.get('/', asyncRoute(async (req, res) => {
    const archivedRaw = req.query.archived;
    let archived: 'active' | 'archived' | 'all' = 'all';
    if (archivedRaw !== undefined) {
      if (
        typeof archivedRaw !== 'string' ||
        !['active', 'archived', 'all'].includes(archivedRaw)
      ) {
        throw new ApiError(
          400,
          'BAD_REQUEST',
          'archived must be active, archived or all.',
        );
      }
      archived = archivedRaw as typeof archived;
    }

    const result = await listOpportunities(pool, userIdFromRequest(req), archived);
    return res.status(200).json(result);
  }));

  router.get('/export', asyncRoute(async (req, res) => {
    const backup = await exportOpportunities(pool, userIdFromRequest(req));
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="launchboard-backup.json"');
    return res.status(200).json(backup);
  }));

  router.get('/:id', asyncRoute(async (req, res) => {
    const id = validatedId(req.params.id ?? '');
    const result = await getOpportunity(pool, userIdFromRequest(req), id);
    return res.status(200).json(result);
  }));

  router.post('/import', asyncRoute(async (req, res) => {
    if (typeof req.body === 'object' && req.body !== null && 'backup' in req.body) {
      const encodedBackup = JSON.stringify((req.body as Record<string, unknown>).backup);
      if (encodedBackup !== undefined && Buffer.byteLength(encodedBackup, 'utf8') > MAX_BACKUP_BYTES) {
        throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'The backup exceeds the maximum allowed size.');
      }
    }

    const parsed = backupImportBodySchema.safeParse(req.body);
    if (!parsed.success) {
      const backupIssues = parsed.error.issues.filter((issue) => issue.path[0] === 'backup');
      if (backupIssues.length > 0) {
        const tooManyRecords = backupIssues.some((issue) =>
          issue.path[1] === 'opportunities' && issue.code === 'too_big',
        );
        throw new ApiError(
          422,
          'INVALID_BACKUP',
          tooManyRecords ? 'The backup contains too many records.' : 'This is not a valid Launchboard backup.',
          { reason: tooManyRecords ? 'too-many-records' : 'invalid-envelope' },
        );
      }
      throw validationErrorFromZod(parsed.error);
    }

    const result = await importOpportunities(
      pool,
      userIdFromRequest(req),
      parsed.data,
    );
    return res.status(200).json(result);
  }));

  router.post('/', asyncRoute(async (req, res) => {
    const parsed = createOpportunityBodySchema.safeParse(req.body);
    if (!parsed.success) throw validationErrorFromZod(parsed.error);
    const result = await createOpportunity(
      pool,
      userIdFromRequest(req),
      parsed.data.opportunity,
    );
    return res.status(201).json(result);
  }));

  router.put('/:id', asyncRoute(async (req, res) => {
    const id = validatedId(req.params.id ?? '');
    const expectedVersion = parseIfMatch(req);
    const parsed = updateOpportunityBodySchema.safeParse(req.body);
    if (!parsed.success) throw validationErrorFromZod(parsed.error);
    const result = await updateOpportunity(
      pool,
      userIdFromRequest(req),
      id,
      expectedVersion,
      parsed.data.opportunity,
      parsed.data.statusActivityDate,
    );
    return res.status(200).json(result);
  }));

  router.delete('/:id', asyncRoute(async (req, res) => {
    const id = validatedId(req.params.id ?? '');
    const expectedVersion = parseIfMatch(req);
    requireEmptyObjectBody(req);
    const result = await deleteOpportunity(
      pool,
      userIdFromRequest(req),
      id,
      expectedVersion,
    );
    return res.status(200).json(result);
  }));

  router.post('/bulk/archive', asyncRoute(async (req, res) => {
    const parsed = bulkArchiveBodySchema.safeParse(req.body);
    if (!parsed.success) bulkValidationError(parsed.error);
    const result = await bulkArchiveOpportunities(pool, userIdFromRequest(req), parsed.data.items);
    return res.status(200).json(result);
  }));

  router.post('/bulk/restore', asyncRoute(async (req, res) => {
    const parsed = bulkRestoreBodySchema.safeParse(req.body);
    if (!parsed.success) bulkValidationError(parsed.error);
    const result = await bulkRestoreOpportunities(pool, userIdFromRequest(req), parsed.data.items);
    return res.status(200).json(result);
  }));

  router.post('/bulk/status', asyncRoute(async (req, res) => {
    const parsed = bulkStatusBodySchema.safeParse(req.body);
    if (!parsed.success) bulkValidationError(parsed.error);
    const result = await bulkUpdateOpportunityStatus(pool, userIdFromRequest(req), parsed.data);
    return res.status(200).json(result);
  }));

  router.post('/bulk/delete', asyncRoute(async (req, res) => {
    const parsed = bulkDeleteBodySchema.safeParse(req.body);
    if (!parsed.success) bulkValidationError(parsed.error);
    const result = await bulkDeleteOpportunities(
      pool, userIdFromRequest(req), parsed.data.items, parsed.data.archiveView,
    );
    return res.status(200).json(result);
  }));

  router.post('/bulk/undo-archive', asyncRoute(async (req, res) => {
    const parsed = bulkUndoArchiveBodySchema.safeParse(req.body);
    if (!parsed.success) bulkValidationError(parsed.error);
    const result = await bulkUndoArchive(pool, userIdFromRequest(req), parsed.data);
    return res.status(200).json(result);
  }));

  router.post('/deletions/:batchId/restore', asyncRoute(async (req, res) => {
    const batchId = validatedId(req.params.batchId ?? '');
    requireEmptyObjectBody(req);
    const result = await restoreDeletionBatch(pool, userIdFromRequest(req), batchId);
    return res.status(200).json(result);
  }));

  router.post('/:id/archive', asyncRoute(async (req, res) => {
    const id = validatedId(req.params.id ?? '');
    const expectedVersion = parseIfMatch(req);
    requireEmptyObjectBody(req);
    const result = await setOpportunityArchived(
      pool,
      userIdFromRequest(req),
      id,
      expectedVersion,
      true,
    );
    return res.status(200).json(result);
  }));

  router.post('/:id/restore', asyncRoute(async (req, res) => {
    const id = validatedId(req.params.id ?? '');
    const expectedVersion = parseIfMatch(req);
    requireEmptyObjectBody(req);
    const result = await setOpportunityArchived(
      pool,
      userIdFromRequest(req),
      id,
      expectedVersion,
      false,
    );
    return res.status(200).json(result);
  }));

  return router;
}
