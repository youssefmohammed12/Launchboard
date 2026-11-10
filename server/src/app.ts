import { MAX_BACKUP_BYTES } from '@launchboard/domain';
import express from 'express';
import type { Express } from 'express';
import type { ReadinessProbe } from './db/readiness.js';
import { createAuthRouter, type AuthEmailSender } from './routes/auth.js';
import { createAccountActionsRouter } from './routes/accountActions.js';
import { createAccountSettingsRouter } from './routes/accountSettings.js';
import { createErrorHandler } from './middleware/errorHandler.js';
import { notFound } from './middleware/notFound.js';
import { requestId } from './middleware/requestId.js';
import { healthRouter } from './routes/health.js';
import { createReadinessRouter } from './routes/readiness.js';
import { createOpportunityRouter } from './routes/opportunities.js';
import { createCaptureRouter } from './routes/capture.js';
import type { OpportunityCapturePreviewService } from './services/opportunityCaptureService.js';

/**
 * Transport limit for JSON requests. The version-1 backup itself is capped at
 * 5 MiB; the extra MiB covers the import envelope (`mode`, `backup`, flags) and
 * JSON string escaping. A future import handler must still enforce the 5 MiB
 * backup limit after parsing.
 */
export const JSON_BODY_LIMIT_BYTES = MAX_BACKUP_BYTES + 1024 * 1024;

export interface AppOptions {
  /** Overrides the JSON transport limit, primarily for focused tests. */
  jsonLimit?: number | string;
  /** Logs unexpected 5xx causes server-side. Defaults to true. */
  logErrors?: boolean;
  /**
   * Database readiness probe. `null` means no database is configured; the
   * process health route still works and `/api/ready` returns 503.
   */
  database?: ReadinessProbe | null;
  /**
   * Database connection pool for authenticated API routes. `null` means no pool is
   * available; authenticated API endpoints respond with 503.
   */
  dbPool?: Parameters<typeof createAuthRouter>[0];
  /** Injectable transactional email sender for deterministic auth tests. */
  emailSender?: AuthEmailSender;
  /** Injectable read-only capture preview for focused route tests. */
  capturePreview?: OpportunityCapturePreviewService;
  /**
   * Extension point for route modules. Called after common middleware and the
   * health route, but before the 404 and error handlers.
   */
  registerRoutes?: (app: Express) => void;
}

/**
 * Builds the Express application without binding a port. Importing this module
 * never starts a server; `server.ts` owns the listen call.
 */
export function createApp(options: AppOptions = {}): Express {
  const app = express();
  app.disable('x-powered-by');

  app.use(requestId);
  // Capture has its own tiny body parser, deliberately mounted before the
  // global JSON parser so auth/origin checks run before any request body parse.
  app.use('/api/capture', createCaptureRouter(options.dbPool ?? null,
    options.capturePreview === undefined ? {} : { preview: options.capturePreview },
  ));
  app.use(
    express.json({
      limit: options.jsonLimit ?? JSON_BODY_LIMIT_BYTES,
      type: 'application/json',
    }),
  );

  app.use('/api', healthRouter);
  app.use('/api', createReadinessRouter(options.database ?? null));
  app.use('/api', createAuthRouter(options.dbPool ?? null, {
    emailSender: options.emailSender,
  }));
  app.use('/api', createAccountActionsRouter(options.dbPool ?? null, {
    emailSender: options.emailSender,
  }));
  app.use('/api', createAccountSettingsRouter(options.dbPool ?? null, {
    emailSender: options.emailSender,
  }));
  app.use('/api/opportunities', createOpportunityRouter(options.dbPool ?? null));
  options.registerRoutes?.(app);

  app.use(notFound);
  app.use(createErrorHandler({ logErrors: options.logErrors }));

  return app;
}

/** A ready-to-use app for consumers that do not need custom options. */
export const app = createApp();
