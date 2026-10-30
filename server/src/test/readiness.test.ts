import { describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import type { ReadinessProbe } from '../db/readiness.js';
import { withTestServer } from './helpers/server.js';

const readyProbe: ReadinessProbe = {
  check: async () => ({ ready: true }),
};

const notReadyProbe: ReadinessProbe = {
  check: async () => ({ ready: false, reason: 'unreachable' }),
};

const throwingProbe: ReadinessProbe = {
  check: async () => {
    throw new Error('mysql://launchboard_app:secret@db.local/launchboard');
  },
};

describe('GET /api/ready', () => {
  it('returns the documented ready response when the probe succeeds', async () => {
    await withTestServer(
      createApp({ logErrors: false, database: readyProbe }),
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/ready`);
        expect(response.status).toBe(200);
        expect(response.headers.get('cache-control')).toBe('no-store');
        expect(response.headers.get('x-powered-by')).toBeNull();
        expect(await response.json()).toEqual({ status: 'ok', db: 'ok' });
        expect(response.headers.get('x-request-id')).toMatch(
          /^[A-Za-z0-9._-]{1,64}$/,
        );
      },
    );
  });

  it('returns a safe 503 when no database is configured', async () => {
    await withTestServer(createApp({ logErrors: false }), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/ready`);
      expect(response.status).toBe(503);
      expect(response.headers.get('cache-control')).toBe('no-store');
      const text = await response.text();
      const body = JSON.parse(text) as {
        error: { code: string; message: string; requestId: string; details?: unknown };
      };
      expect(body.error.code).toBe('NOT_READY');
      expect(body.error.message).toBe('The database is not ready.');
      expect(body.error.details).toBeUndefined();
      expect(body.error.requestId).toBe(response.headers.get('x-request-id'));
      expect(text).not.toMatch(/mysql|127\.0\.0\.1|launchboard_app|password|sql/i);
    });
  });

  it('returns a safe 503 when the probe reports not ready', async () => {
    await withTestServer(
      createApp({ logErrors: false, database: notReadyProbe }),
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/ready`);
        expect(response.status).toBe(503);
        const body = (await response.json()) as { error: { code: string } };
        expect(body.error.code).toBe('NOT_READY');
      },
    );
  });

  it('does not leak probe errors or connection details', async () => {
    await withTestServer(
      createApp({ logErrors: false, database: throwingProbe }),
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/ready`);
        expect(response.status).toBe(503);
        const text = await response.text();
        expect(text).not.toContain('mysql://');
        expect(text).not.toContain('secret');
        expect(text).not.toContain('db.local');
        expect(text).not.toContain('launchboard_app');
        expect(text).not.toContain('stack');
      },
    );
  });
});

describe('health remains independent of database readiness', () => {
  it('returns liveness when the database is not configured', async () => {
    await withTestServer(createApp({ logErrors: false }), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/health`);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ status: 'ok' });
    });
  });

  it('returns liveness when the database probe fails', async () => {
    await withTestServer(
      createApp({ logErrors: false, database: notReadyProbe }),
      async (baseUrl) => {
        const health = await fetch(`${baseUrl}/api/health`);
        expect(health.status).toBe(200);
        expect(await health.json()).toEqual({ status: 'ok' });

        const ready = await fetch(`${baseUrl}/api/ready`);
        expect(ready.status).toBe(503);
      },
    );
  });
});
