import express from 'express';
import type { ReadinessProbe } from '../db/readiness.js';
import { ApiError } from '../errors.js';
import { buildErrorEnvelope } from '../http/errorEnvelope.js';

/**
 * Database readiness. This route never migrates or changes data. A missing
 * probe, a target mismatch, an unreachable database and a failed `SELECT 1`
 * all produce the same safe 503 envelope.
 */
export function createReadinessRouter(probe: ReadinessProbe | null) {
  const router = express.Router();

  router.get('/ready', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');

    let ready = false;
    try {
      ready = probe !== null && (await probe.check()).ready;
    } catch {
      ready = false;
    }

    if (ready) {
      res.status(200).json({ status: 'ok', db: 'ok' });
      return;
    }

    res
      .status(503)
      .json(
        buildErrorEnvelope(
          new ApiError(503, 'NOT_READY', 'The database is not ready.'),
          req.requestId,
        ),
      );
  });

  return router;
}
