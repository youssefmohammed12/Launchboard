import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAX_BACKUP_BYTES } from '@launchboard/domain';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createApp, JSON_BODY_LIMIT_BYTES } from '../app.js';
import { validateBody, validatedBody } from '../middleware/validateBody.js';
import { withTestServer } from './helpers/server.js';

const echoSchema = z.strictObject({ name: z.string().min(1) });

function testApp(options: { jsonLimit?: number | string } = {}) {
  return createApp({
    logErrors: false,
    ...options,
    registerRoutes: (app) => {
      app.post('/__test/echo', (req, res) => {
        res.json({ body: req.body });
      });
      app.post('/__test/validate', validateBody(echoSchema), (req, res) => {
        res.json({ body: validatedBody<z.infer<typeof echoSchema>>(req) });
      });
      app.get('/__test/throw', () => {
        throw new Error('boom secret stack');
      });
    },
  });
}

describe('health endpoint', () => {
  it('returns the documented safe liveness response', async () => {
    await withTestServer(createApp({ logErrors: false }), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/health`);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('application/json');
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(response.headers.get('x-powered-by')).toBeNull();
      expect(await response.json()).toEqual({ status: 'ok' });
      expect(response.headers.get('x-request-id')).toMatch(
        /^[A-Za-z0-9._-]{1,64}$/,
      );
    });
  });

  it('does not require a database or authentication', async () => {
    // The test server has no database module, connection or credential at all.
    await withTestServer(createApp({ logErrors: false }), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/health`);
      expect(response.status).toBe(200);
      expect(await response.text()).not.toMatch(/database|mysql|ready/i);
    });
  });
});

describe('request IDs', () => {
  it('echoes a valid client request ID', async () => {
    await withTestServer(createApp({ logErrors: false }), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/health`, {
        headers: { 'X-Request-Id': 'client-request-1' },
      });
      expect(response.headers.get('x-request-id')).toBe('client-request-1');
    });
  });

  it('replaces invalid or oversized client request IDs', async () => {
    await withTestServer(createApp({ logErrors: false }), async (baseUrl) => {
      for (const supplied of ['bad id!', 'a'.repeat(65)]) {
        const response = await fetch(`${baseUrl}/api/health`, {
          headers: { 'X-Request-Id': supplied },
        });
        const id = response.headers.get('x-request-id');
        expect(id).not.toBe(supplied);
        expect(id).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
        );
      }
    });
  });
});

describe('error responses', () => {
  it('returns the shared 404 envelope for an unknown route', async () => {
    await withTestServer(createApp({ logErrors: false }), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/does-not-exist`);
      expect(response.status).toBe(404);
      const body = (await response.json()) as {
        error: { code: string; message: string; requestId: string; details?: unknown };
      };
      expect(body.error.code).toBe('NOT_FOUND');
      expect(body.error.message).toBe('The requested resource was not found.');
      expect(body.error.details).toBeUndefined();
      expect(body.error.requestId).toBe(response.headers.get('x-request-id'));
    });
  });

  it('returns a safe 400 for malformed JSON without echoing the body', async () => {
    await withTestServer(testApp(), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/__test/echo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{"name":',
      });
      expect(response.status).toBe(400);
      const text = await response.text();
      const body = JSON.parse(text) as {
        error: { code: string; message: string; requestId: string };
      };
      expect(body.error.code).toBe('INVALID_JSON');
      expect(body.error.message).toBe('The request body is not valid JSON.');
      expect(body.error.requestId).toBe(response.headers.get('x-request-id'));
      expect(text).not.toContain('{"name"');
    });
  });

  it('returns a safe 413 when the JSON body exceeds the limit', async () => {
    await withTestServer(testApp({ jsonLimit: 64 }), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/__test/echo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'x'.repeat(200) }),
      });
      expect(response.status).toBe(413);
      const body = (await response.json()) as {
        error: { code: string; message: string };
      };
      expect(body.error.code).toBe('PAYLOAD_TOO_LARGE');
      expect(body.error.message).toBe(
        'The request body exceeds the maximum allowed size.',
      );
    });
  });

  it('keeps the transport limit above the backup file limit', () => {
    expect(JSON_BODY_LIMIT_BYTES).toBe(MAX_BACKUP_BYTES + 1024 * 1024);
  });

  it('does not expose unexpected error details or stack traces', async () => {
    await withTestServer(testApp(), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/__test/throw`);
      expect(response.status).toBe(500);
      const text = await response.text();
      const body = JSON.parse(text) as {
        error: { code: string; message: string; details?: unknown; requestId: string };
      };
      expect(body.error.code).toBe('INTERNAL_ERROR');
      expect(body.error.message).toBe('An unexpected error occurred.');
      expect(body.error.details).toBeUndefined();
      expect(body.error.requestId).toBe(response.headers.get('x-request-id'));
      expect(text).not.toContain('boom');
      expect(text).not.toContain('stack');
      expect(text).not.toContain('at ');
    });
  });
});

describe('body validation middleware', () => {
  it('exposes the parsed body to the route on success', async () => {
    await withTestServer(testApp(), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/__test/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Launchboard' }),
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ body: { name: 'Launchboard' } });
    });
  });

  it('returns 422 with safe field paths and no raw values', async () => {
    await withTestServer(testApp(), async (baseUrl) => {
      const secretValue = 'do-not-echo-this-value';
      const response = await fetch(`${baseUrl}/__test/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: '', secret: secretValue }),
      });
      expect(response.status).toBe(422);
      const text = await response.text();
      const body = JSON.parse(text) as {
        error: {
          code: string;
          message: string;
          requestId: string;
          details: { fields: Array<{ path: string; message: string }> };
        };
      };
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.message).toBe('The request contains invalid fields.');
      expect(body.error.requestId).toBe(response.headers.get('x-request-id'));
      expect(body.error.details.fields).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: 'name' }),
        ]),
      );
      expect(text).not.toContain(secretValue);
    });
  });

  it('rejects a missing body without reaching the route', async () => {
    await withTestServer(testApp(), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/__test/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      expect(response.status).toBe(422);
      const body = (await response.json()) as {
        error: { code: string; details: { fields: unknown[] } };
      };
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.details.fields.length).toBeGreaterThan(0);
    });
  });
});

describe('app and server separation', () => {
  it('does not call listen in app.ts', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const sourceRoot = join(here, '..');
    const appSource = readFileSync(join(sourceRoot, 'app.ts'), 'utf8');
    const serverSource = readFileSync(join(sourceRoot, 'server.ts'), 'utf8');
    expect(appSource).not.toMatch(/\.listen\s*\(/);
    expect(serverSource).toMatch(/\.listen\s*\(/);
  });
});
