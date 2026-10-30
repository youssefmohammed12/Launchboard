import express from 'express';

/**
 * Liveness only. This endpoint deliberately does not touch a database and does
 * not claim readiness. A `/api/ready` check arrives with database connectivity.
 */
export const healthRouter = express.Router();

healthRouter.get('/health', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ status: 'ok' });
});
