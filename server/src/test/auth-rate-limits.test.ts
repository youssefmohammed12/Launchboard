import { describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { createAuthRateLimiters, AUTH_RATE_LIMITS } from '../middleware/authRateLimiters.js';
import { withTestServer } from './helpers/server.js';

function successHandler(status = 200) {
  return (_req: unknown, res: any) => res.status(status).json({ ok: true });
}

async function postJson(
  baseUrl: string,
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
) {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

describe('authentication rate limit policy', () => {
  it('uses the approved request limits and time windows', () => {
    expect(AUTH_RATE_LIMITS).toEqual({
      registrationPerIp: { limit: 3, windowMs: 60 * 60 * 1000 },
      loginPerIp: { limit: 5, windowMs: 15 * 60 * 1000 },
      loginPerAccount: { limit: 10, windowMs: 15 * 60 * 1000 },
      preSessionPerIp: { limit: 10, windowMs: 15 * 60 * 1000 },
      resendVerificationPerIp: { limit: 3, windowMs: 15 * 60 * 1000 },
      passwordResetPerIp: { limit: 5, windowMs: 15 * 60 * 1000 },
      passwordResetConfirmPerIp: { limit: 5, windowMs: 15 * 60 * 1000 },
      accountActionPerIdentifier: { limit: 6, windowMs: 60 * 60 * 1000 },
      accountProfileUpdatePerIp: { limit: 10, windowMs: 15 * 60 * 1000 },
      accountPasswordChangePerIp: { limit: 5, windowMs: 15 * 60 * 1000 },
      accountDeletionPerIp: { limit: 3, windowMs: 60 * 60 * 1000 },
    });
  });
});

describe('POST /api/auth/register rate limiting', () => {
  it('allows three registration requests through the IP limiter and rejects the fourth', async () => {
    const app = createApp({ logErrors: false });

    await withTestServer(app, async (baseUrl) => {
      for (let attempt = 0; attempt < 3; attempt++) {
        const response = await postJson(baseUrl, '/api/auth/register', {
          email: `person${attempt}@example.test`,
          password: 'not-used-in-this-middleware-test',
        });
        // No database is configured, proving each request passed the limiter
        // and reached the registration handler's availability check.
        expect(response.status).toBe(503);
      }

      const limited = await postJson(baseUrl, '/api/auth/register', {
        email: 'fourth@example.test',
        password: 'not-used-in-this-middleware-test',
      });
      const text = await limited.text();
      const body = JSON.parse(text) as {
        error: { code: string; message: string; requestId: string };
      };

      expect(limited.status).toBe(429);
      expect(body.error.code).toBe('RATE_LIMITED');
      expect(body.error.message).toBe('Too many requests. Please try again later.');
      expect(body.error.requestId).toBe(limited.headers.get('x-request-id'));
      expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
      expect(limited.headers.get('ratelimit')).toContain('r=0');
      expect(text).not.toContain('fourth@example.test');
    });
  });

  it('tracks the client IP, not one global registration counter', async () => {
    const app = createApp({ logErrors: false });

    // Test-only trusted-proxy setup lets the test simulate two client IPs.
    // Production remains at Express's default trust-proxy=false setting.
    app.set('trust proxy', 'loopback');

    await withTestServer(app, async (baseUrl) => {
      for (let attempt = 0; attempt < 3; attempt++) {
        const response = await postJson(
          baseUrl,
          '/api/auth/register',
          { email: 'same@example.test' },
          { 'X-Forwarded-For': '192.0.2.10' },
        );
        expect(response.status).toBe(503);
      }

      const firstIpLimited = await postJson(
        baseUrl,
        '/api/auth/register',
        { email: 'same@example.test' },
        { 'X-Forwarded-For': '192.0.2.10' },
      );
      expect(firstIpLimited.status).toBe(429);

      const secondIp = await postJson(
        baseUrl,
        '/api/auth/register',
        { email: 'same@example.test' },
        { 'X-Forwarded-For': '192.0.2.11' },
      );
      expect(secondIp.status).toBe(503);
    });
  });
});

describe('login IP rate limiting', () => {
  it('allows five login attempts per IP and rejects the sixth', async () => {
    const { loginByIp, loginByAccount } = createAuthRateLimiters();
    const app = createApp({
      logErrors: false,
      registerRoutes: (routes) => {
        routes.post('/__test/login-ip', loginByIp, loginByAccount, successHandler());
      },
    });

    await withTestServer(app, async (baseUrl) => {
      for (let attempt = 0; attempt < 5; attempt++) {
        const response = await postJson(baseUrl, '/__test/login-ip', {
          email: `user${attempt}@example.test`,
          password: 'wrong-password',
        });
        expect(response.status).toBe(200);
        expect(response.headers.get('ratelimit')).toContain('login-ip');
        expect(response.headers.get('ratelimit')).toContain('login-account');
      }

      const limited = await postJson(baseUrl, '/__test/login-ip', {
        email: 'sixth@example.test',
        password: 'wrong-password',
      });
      expect(limited.status).toBe(429);
      expect((await limited.json() as { error: { code: string } }).error.code).toBe('RATE_LIMITED');
      expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
    });
  });
});

describe('login account-identifier rate limiting', () => {
  it('shares one account quota across casing and surrounding whitespace variants', async () => {
    const { loginByAccount } = createAuthRateLimiters();
    const app = createApp({
      logErrors: false,
      registerRoutes: (routes) => {
        routes.post('/__test/login-account', loginByAccount, successHandler());
      },
    });

    await withTestServer(app, async (baseUrl) => {
      for (let attempt = 0; attempt < 10; attempt++) {
        const email =
          attempt % 2 === 0 ? 'Youssef.Example@example.test' : '  youssef.example@EXAMPLE.TEST  ';
        const response = await postJson(baseUrl, '/__test/login-account', {
          email,
          password: 'wrong-password',
        });
        expect(response.status).toBe(200);
      }

      const limited = await postJson(baseUrl, '/__test/login-account', {
        email: 'youssef.example@example.test',
        password: 'wrong-password',
      });
      const limitedText = await limited.text();
      const limitedBody = JSON.parse(limitedText) as { error: { code: string } };
      expect(limited.status).toBe(429);
      expect(limitedBody.error.code).toBe('RATE_LIMITED');
      expect(limitedText).not.toContain('youssef.example@example.test');
      expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);

      const otherAccount = await postJson(baseUrl, '/__test/login-account', {
        email: 'another.person@example.test',
        password: 'wrong-password',
      });
      expect(otherAccount.status).toBe(200);
    });
  });

  it('does not consume account quotas for missing or invalid email identifiers', async () => {
    const { loginByAccount } = createAuthRateLimiters();
    const app = createApp({
      logErrors: false,
      registerRoutes: (routes) => {
        routes.post('/__test/login-account', loginByAccount, successHandler());
      },
    });

    await withTestServer(app, async (baseUrl) => {
      for (let attempt = 0; attempt < 12; attempt++) {
        const response = await postJson(baseUrl, '/__test/login-account', {
          email: 'not-an-email',
          password: 'wrong-password',
        });
        expect(response.status).toBe(200);
      }

      const validAccount = await postJson(baseUrl, '/__test/login-account', {
        email: 'valid.person@example.test',
        password: 'wrong-password',
      });
      expect(validAccount.status).toBe(200);
    });
  });
});

describe('POST /api/auth/pre-session rate limiting', () => {
  it('allows ten pre-session creation attempts per IP and rejects the eleventh', async () => {
    // No pool is provided: requests that pass the limiter stop safely with
    // NOT_READY before any database access or session creation can occur.
    const app = createApp({ logErrors: false });

    await withTestServer(app, async (baseUrl) => {
      for (let attempt = 0; attempt < 10; attempt++) {
        const response = await postJson(baseUrl, '/api/auth/pre-session', {});
        expect(response.status).toBe(503);
        expect(response.headers.get('ratelimit')).toContain('pre-session-ip');
      }

      const limited = await postJson(baseUrl, '/api/auth/pre-session', {});
      const text = await limited.text();
      const body = JSON.parse(text) as {
        error: { code: string; requestId: string };
      };

      expect(limited.status).toBe(429);
      expect(body.error.code).toBe('RATE_LIMITED');
      expect(body.error.requestId).toBe(limited.headers.get('x-request-id'));
      expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
      expect(limited.headers.get('ratelimit')).toContain('pre-session-ip');
      expect(limited.headers.get('set-cookie')).toBeNull();
    });
  });
});


describe('account-action email rate limiting', () => {
  it('shares an HMAC-derived quota across normalized email variants without revealing the address', async () => {
    const { accountActionByIdentifier } = createAuthRateLimiters();
    const app = createApp({
      logErrors: false,
      registerRoutes: (routes) => {
        routes.post('/__test/account-action-email', accountActionByIdentifier, successHandler());
      },
    });

    await withTestServer(app, async (baseUrl) => {
      for (let attempt = 0; attempt < 6; attempt++) {
        const email = attempt % 2 === 0
          ? 'Person.Example@example.test'
          : '  person.example@EXAMPLE.TEST  ';
        const response = await postJson(baseUrl, '/__test/account-action-email', { email });
        expect(response.status).toBe(200);
      }

      const limited = await postJson(baseUrl, '/__test/account-action-email', {
        email: 'person.example@example.test',
      });
      const text = await limited.text();
      expect(limited.status).toBe(429);
      expect(JSON.parse(text).error.code).toBe('RATE_LIMITED');
      expect(text).not.toContain('person.example@example.test');
      expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);

      const otherAccount = await postJson(baseUrl, '/__test/account-action-email', {
        email: 'different@example.test',
      });
      expect(otherAccount.status).toBe(200);
    });
  });

  it('does not consume account-action quotas for invalid email identifiers', async () => {
    const { accountActionByIdentifier } = createAuthRateLimiters();
    const app = createApp({
      logErrors: false,
      registerRoutes: (routes) => {
        routes.post('/__test/account-action-email', accountActionByIdentifier, successHandler());
      },
    });

    await withTestServer(app, async (baseUrl) => {
      for (let attempt = 0; attempt < 8; attempt++) {
        const response = await postJson(baseUrl, '/__test/account-action-email', {
          email: 'not-an-email',
        });
        expect(response.status).toBe(200);
      }

      const validAccount = await postJson(baseUrl, '/__test/account-action-email', {
        email: 'valid@example.test',
      });
      expect(validAccount.status).toBe(200);
    });
  });
});
