import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Pool } from 'mysql2/promise';
import { createApp } from '../app.js';
import { deriveCsrfToken } from '../auth/csrf.js';
import { SESSION_COOKIE_NAME } from '../auth/cookies.js';
import { generateToken } from '../auth/tokens.js';
import type { OpportunityCapturePreview } from '../services/opportunityCaptureService.js';
import { withTestServer } from './helpers/server.js';

const csrfSecret = Buffer.alloc(32, 0x63).toString('base64url');
const trustedOrigin = 'http://127.0.0.1:5173';
const sessionToken = generateToken(32);
const csrfToken = deriveCsrfToken(csrfSecret, 'authenticated', sessionToken);
const cookieHeader = SESSION_COOKIE_NAME + '=' + sessionToken;

const activeSessionRow = {
  id: 'session-1',
  user_id: 'user-1',
  user_id2: 'user-1',
  last_seen_at: new Date(),
  expires_at: new Date(Date.now() + 60 * 60 * 1000),
  email: 'owner@example.test',
};

function createReadOnlyPool(rows: unknown[] = [activeSessionRow]) {
  const execute = vi.fn(async (sql: string) => {
    expect(sql.trim().toLowerCase()).toMatch(/^select\b/u);
    return [rows, []] as const;
  });
  return {
    pool: { execute } as unknown as Pool,
    execute,
  };
}

async function postPreview(
  baseUrl: string,
  body: string,
  headers: Record<string, string> = {},
) {
  return fetch(baseUrl + '/api/capture/preview', {
    method: 'POST',
    headers: {
      Origin: trustedOrigin,
      'Content-Type': 'application/json',
      Cookie: cookieHeader,
      'X-CSRF-Token': csrfToken,
      ...headers,
    },
    body,
  });
}

async function responseErrorCode(response: Response): Promise<string> {
  const payload = await response.json() as { error: { code: string } };
  return payload.error.code;
}

const previewResult: OpportunityCapturePreview = {
  outcome: 'ready',
  source: 'job-posting',
  title: 'Frontend Engineer',
  company: 'Example Ltd',
  description: 'Build useful interfaces.',
  compensation: '',
  locations: [],
  department: '',
  team: '',
  workplaceType: '',
  employmentType: '',
  postedDate: '',
  compensationDetails: null,
  fieldEvidence: {},
};

beforeEach(() => {
  vi.stubEnv('CSRF_SECRET', csrfSecret);
  vi.stubEnv('TRUSTED_ORIGINS', trustedOrigin);
  vi.stubEnv('CAPTURE_PREVIEW_ENABLED', 'true');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('POST /api/capture/preview authorization and parser ordering', () => {
  it('keeps the endpoint disabled until the deployment explicitly enables it', async () => {
    vi.stubEnv('CAPTURE_PREVIEW_ENABLED', 'false');
    const { pool, execute } = createReadOnlyPool();
    const preview = vi.fn(async () => previewResult);
    const app = createApp({ dbPool: pool, capturePreview: preview, logErrors: false });

    await withTestServer(app, async (baseUrl) => {
      const response = await postPreview(baseUrl, '{');
      expect(response.status).toBe(503);
      expect(await responseErrorCode(response)).toBe('NOT_READY');
      expect(execute).not.toHaveBeenCalled();
      expect(preview).not.toHaveBeenCalled();
    });
  });

  it('rejects untrusted Origin before session lookup or JSON parsing', async () => {
    const { pool, execute } = createReadOnlyPool();
    const preview = vi.fn(async () => previewResult);
    const app = createApp({ dbPool: pool, capturePreview: preview, logErrors: false });

    await withTestServer(app, async (baseUrl) => {
      const response = await postPreview(baseUrl, '{', { Origin: 'https://evil.example' });
      expect(response.status).toBe(403);
      expect(await responseErrorCode(response)).toBe('FORBIDDEN');
      expect(execute).not.toHaveBeenCalled();
      expect(preview).not.toHaveBeenCalled();
      expect(response.headers.get('cache-control')).toBe('no-store');
    });
  });

  it('rejects missing session cookies before parsing malformed JSON', async () => {
    const { pool, execute } = createReadOnlyPool();
    const app = createApp({ dbPool: pool, logErrors: false });

    await withTestServer(app, async (baseUrl) => {
      const response = await fetch(baseUrl + '/api/capture/preview', {
        method: 'POST',
        headers: {
          Origin: trustedOrigin,
          'Content-Type': 'application/json',
        },
        body: '{',
      });

      expect(response.status).toBe(401);
      expect(await responseErrorCode(response)).toBe('UNAUTHORIZED');
      expect(execute).not.toHaveBeenCalled();
    });
  });

  it('rejects invalid CSRF before database lookup and body parsing', async () => {
    const { pool, execute } = createReadOnlyPool();
    const app = createApp({ dbPool: pool, logErrors: false });

    await withTestServer(app, async (baseUrl) => {
      const response = await postPreview(baseUrl, '{', {
        'X-CSRF-Token': 'invalid',
      });
      expect(response.status).toBe(403);
      expect(await responseErrorCode(response)).toBe('FORBIDDEN');
      expect(execute).not.toHaveBeenCalled();
    });
  });

  it('rejects an oversized declared request body before database lookup', async () => {
    const { pool, execute } = createReadOnlyPool();
    const app = createApp({ dbPool: pool, logErrors: false });

    await withTestServer(app, async (baseUrl) => {
      const response = await postPreview(baseUrl, JSON.stringify({
        url: 'x'.repeat(2100),
      }));
      expect(response.status).toBe(413);
      expect(await responseErrorCode(response)).toBe('PAYLOAD_TOO_LARGE');
      expect(execute).not.toHaveBeenCalled();
    });
  });

  it('rejects non-JSON and compressed request bodies without parsing', async () => {
    const { pool, execute } = createReadOnlyPool();
    const app = createApp({ dbPool: pool, logErrors: false });

    await withTestServer(app, async (baseUrl) => {
      const wrongType = await postPreview(baseUrl, '{}', {
        'Content-Type': 'text/plain',
      });
      expect(wrongType.status).toBe(400);

      const compressed = await postPreview(baseUrl, '{}', {
        'Content-Encoding': 'gzip',
      });
      expect(compressed.status).toBe(415);
      expect(execute).not.toHaveBeenCalled();
    });
  });

  it('rejects expired or absent active sessions without invoking the preview service', async () => {
    const { pool, execute } = createReadOnlyPool([]);
    const preview = vi.fn(async () => previewResult);
    const app = createApp({ dbPool: pool, capturePreview: preview, logErrors: false });

    await withTestServer(app, async (baseUrl) => {
      const response = await postPreview(baseUrl, JSON.stringify({
        url: 'https://jobs.example.com/roles/123',
      }));
      expect(response.status).toBe(401);
      expect(execute).toHaveBeenCalledOnce();
      expect(preview).not.toHaveBeenCalled();
    });
  });
});

describe('POST /api/capture/preview request handling', () => {
  it('validates strict URL-only JSON, then returns bounded preview metadata', async () => {
    const { pool, execute } = createReadOnlyPool();
    const preview = vi.fn(async () => previewResult);
    const app = createApp({ dbPool: pool, capturePreview: preview, logErrors: false });

    await withTestServer(app, async (baseUrl) => {
      const invalid = await postPreview(baseUrl, JSON.stringify({
        url: 'https://jobs.example.com/roles/123',
        unexpected: true,
      }));
      expect(invalid.status).toBe(422);
      expect(preview).not.toHaveBeenCalled();

      const response = await postPreview(baseUrl, JSON.stringify({
        url: 'https://jobs.example.com/roles/123',
      }));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(previewResult);
      expect(preview).toHaveBeenCalledOnce();
      expect(preview).toHaveBeenCalledWith('https://jobs.example.com/roles/123');
      expect(execute).toHaveBeenCalledTimes(2);
      expect(execute.mock.calls.every(([sql]) => /^\s*SELECT\b/iu.test(sql))).toBe(true);
      expect(response.headers.get('cache-control')).toBe('no-store');
    });
  });

  it('enforces the strict URL-only schema and standard HTTP(S) schemes', async () => {
    const { pool } = createReadOnlyPool();
    const preview = vi.fn(async () => previewResult);
    const app = createApp({ dbPool: pool, capturePreview: preview, logErrors: false });

    await withTestServer(app, async (baseUrl) => {
      for (const url of ['', 'ftp://jobs.example.com/1', 'javascript:alert(1)', 'not-a-url']) {
        const response = await postPreview(baseUrl, JSON.stringify({ url }));
        expect(response.status).toBe(422);
      }
      expect(preview).not.toHaveBeenCalled();
    });
  });

  it('does not leak parser errors or attacker-controlled body values', async () => {
    const { pool } = createReadOnlyPool();
    const app = createApp({ dbPool: pool, logErrors: false });

    await withTestServer(app, async (baseUrl) => {
      const secretLikeValue = 'private-input-marker-should-not-echo';
      const response = await postPreview(baseUrl, JSON.stringify({
        url: secretLikeValue,
        extra: 'do-not-echo',
      }));
      const text = await response.text();
      expect(response.status).toBe(422);
      expect(text).not.toContain(secretLikeValue);
      expect(text).not.toContain('do-not-echo');
    });
  });
});

describe('POST /api/capture/preview abuse controls', () => {
  it('allows five preview attempts per client IP and rejects the sixth', async () => {
    const { pool } = createReadOnlyPool();
    const preview = vi.fn(async () => previewResult);
    const app = createApp({ dbPool: pool, capturePreview: preview, logErrors: false });
    app.set('trust proxy', 'loopback');

    await withTestServer(app, async (baseUrl) => {
      for (let index = 0; index < 5; index += 1) {
        const response = await postPreview(
          baseUrl,
          JSON.stringify({ url: 'https://jobs.example.com/roles/' + index }),
        );
        expect(response.status).toBe(200);
      }

      const limited = await postPreview(baseUrl, JSON.stringify({
        url: 'https://jobs.example.com/roles/last',
      }));
      expect(limited.status).toBe(429);
      expect(await responseErrorCode(limited)).toBe('RATE_LIMITED');
      expect(preview).toHaveBeenCalledTimes(5);
    });
  });

  it('enforces a low per-instance concurrency ceiling', async () => {
    const { pool } = createReadOnlyPool();
    let releaseFirst: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let started = 0;
    const preview = vi.fn(async () => {
      started += 1;
      if (started <= 2) await gate;
      return previewResult;
    });
    const app = createApp({ dbPool: pool, capturePreview: preview, logErrors: false });

    await withTestServer(app, async (baseUrl) => {
      const first = postPreview(baseUrl, JSON.stringify({ url: 'https://jobs.example.com/1' }));
      const second = postPreview(baseUrl, JSON.stringify({ url: 'https://jobs.example.com/2' }));

      // Wait for the two requests to enter the injected preview service.
      while (started < 2) await new Promise((resolve) => setTimeout(resolve, 1));

      const third = await postPreview(baseUrl, JSON.stringify({ url: 'https://jobs.example.com/3' }));
      expect(third.status).toBe(429);

      releaseFirst?.();
      const [firstResponse, secondResponse] = await Promise.all([first, second]);
      expect(firstResponse.status).toBe(200);
      expect(secondResponse.status).toBe(200);
      expect(preview).toHaveBeenCalledTimes(2);
    });
  });
});
