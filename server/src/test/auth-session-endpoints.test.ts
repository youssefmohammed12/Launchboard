import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import { deriveCsrfToken } from '../auth/csrf.js';
import { SESSION_COOKIE_NAME } from '../auth/cookies.js';
import { generateToken } from '../auth/tokens.js';
import {
  findActiveAuthSession,
  revokeAuthSession,
  touchAuthSession,
} from '../auth/sessionRepo.js';
import { withTestServer } from './helpers/server.js';

vi.mock('../auth/sessionRepo.js', () => ({
  consumePreAuthSession: vi.fn(),
  createAuthSession: vi.fn(),
  createPreAuthSession: vi.fn(),
  findPreAuthSession: vi.fn(),
  revokePreAuthSession: vi.fn(),
  findActiveAuthSession: vi.fn(),
  revokeAuthSession: vi.fn(),
  touchAuthSession: vi.fn(),
}));

const csrfSecret = Buffer.alloc(32, 0x5a).toString('base64url');
const trustedOrigin = 'http://127.0.0.1:5173';
const sessionToken = generateToken(32);
const pool = {} as any;
const activeSession = {
  session: {
    id: 'session-current',
    userId: 'user-123',
    lastSeenAt: new Date(),
    expiresAt: new Date(Date.now() + 60_000),
  },
  user: { id: 'user-123', email: 'user@example.test' },
};

function app() {
  return createApp({ dbPool: pool, logErrors: false });
}

function authHeaders(overrides: Record<string, string> = {}) {
  return {
    Cookie: `${SESSION_COOKIE_NAME}=${sessionToken}`,
    ...overrides,
  };
}

function logoutHeaders(overrides: Record<string, string> = {}) {
  return {
    Origin: trustedOrigin,
    'Content-Type': 'application/json',
    ...authHeaders({
      'X-CSRF-Token': deriveCsrfToken(csrfSecret, 'authenticated', sessionToken),
    }),
    ...overrides,
  };
}

async function postLogout(baseUrl: string, headers: Record<string, string> = {}) {
  return fetch(`${baseUrl}/api/auth/logout`, {
    method: 'POST',
    headers: logoutHeaders(headers),
    body: '{}',
  });
}

describe('authenticated session endpoints', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('CSRF_SECRET', csrfSecret);
    vi.stubEnv('TRUSTED_ORIGINS', trustedOrigin);
    vi.mocked(findActiveAuthSession).mockResolvedValue(activeSession as any);
    vi.mocked(revokeAuthSession).mockResolvedValue(undefined);
    vi.mocked(touchAuthSession).mockResolvedValue(true);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('GET /api/auth/me', () => {
    it('returns the current user and deterministic CSRF token without writing session state', async () => {
      await withTestServer(app(), async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/auth/me`, {
          headers: authHeaders(),
        });

        expect(response.status).toBe(200);
        expect(response.headers.get('cache-control')).toBe('no-store');
        expect(response.headers.get('set-cookie')).toBeNull();
        expect(await response.json()).toEqual({
          user: activeSession.user,
          csrfToken: deriveCsrfToken(csrfSecret, 'authenticated', sessionToken),
        });
        expect(findActiveAuthSession).toHaveBeenCalledOnce();
        expect(findActiveAuthSession).toHaveBeenCalledWith(pool, sessionToken);
        expect(touchAuthSession).not.toHaveBeenCalled();
        expect(revokeAuthSession).not.toHaveBeenCalled();
      });
    });

    it.each([
      { label: 'missing', cookie: '' },
      { label: 'malformed', cookie: `${SESSION_COOKIE_NAME}=not-a-valid-token` },
    ])('returns 401 for a $label session cookie without a database lookup', async ({ cookie }) => {
      await withTestServer(app(), async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/auth/me`, {
          headers: cookie ? { Cookie: cookie } : {},
        });

        expect(response.status).toBe(401);
        expect(response.headers.get('cache-control')).toBe('no-store');
        expect(response.headers.get('set-cookie')).toBeNull();
        expect(findActiveAuthSession).not.toHaveBeenCalled();
        expect(touchAuthSession).not.toHaveBeenCalled();
      });
    });

    it('returns 401 when the repository reports an expired, idle or revoked session', async () => {
      vi.mocked(findActiveAuthSession).mockResolvedValue(null);

      await withTestServer(app(), async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/auth/me`, {
          headers: authHeaders(),
        });

        expect(response.status).toBe(401);
        expect(findActiveAuthSession).toHaveBeenCalledWith(pool, sessionToken);
        expect(response.headers.get('set-cookie')).toBeNull();
        expect(touchAuthSession).not.toHaveBeenCalled();
      });
    });

    it('returns a safe 503 when the session lookup fails', async () => {
      vi.mocked(findActiveAuthSession).mockRejectedValue(
        new Error('private database connection and SQL details'),
      );

      await withTestServer(app(), async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/auth/me`, {
          headers: authHeaders(),
        });
        const text = await response.text();

        expect(response.status).toBe(503);
        expect(text).not.toContain('private database');
        expect(text).not.toContain('SQL details');
        expect(response.headers.get('set-cookie')).toBeNull();
      });
    });
  });

  describe('POST /api/auth/logout', () => {
    it('revokes only the current session, clears its cookie and returns 204', async () => {
      await withTestServer(app(), async (baseUrl) => {
        const response = await postLogout(baseUrl);

        expect(response.status).toBe(204);
        expect(await response.text()).toBe('');
        expect(response.headers.get('cache-control')).toBe('no-store');
        expect(findActiveAuthSession).toHaveBeenCalledWith(pool, sessionToken);
        expect(revokeAuthSession).toHaveBeenCalledOnce();
        expect(revokeAuthSession).toHaveBeenCalledWith(pool, 'session-current');
        expect(touchAuthSession).not.toHaveBeenCalled();

        const setCookie = response.headers.get('set-cookie') ?? '';
        expect(setCookie).toContain(`${SESSION_COOKIE_NAME}=;`);
        expect(setCookie).toContain('Max-Age=0');
        expect(setCookie).toContain('HttpOnly');
        expect(setCookie).toContain('SameSite=Lax');
        expect(setCookie).toContain('Path=/');
        expect(setCookie).not.toContain('Domain=');
      });
    });

    it.each([
      {
        label: 'untrusted Origin',
        headers: { Origin: 'https://attacker.example' } as Record<string, string>,
        expectedStatus: 403,
      },
      {
        label: 'invalid authenticated CSRF token',
        headers: { 'X-CSRF-Token': 'incorrect-token' } as Record<string, string>,
        expectedStatus: 403,
      },
      {
        label: 'missing Origin',
        headers: { Origin: '' } as Record<string, string>,
        expectedStatus: 403,
      },
    ])('does not look up or revoke a session for $label', async ({ headers, expectedStatus }) => {
      await withTestServer(app(), async (baseUrl) => {
        const response = await postLogout(baseUrl, headers);

        expect(response.status).toBe(expectedStatus);
        expect(findActiveAuthSession).not.toHaveBeenCalled();
        expect(revokeAuthSession).not.toHaveBeenCalled();
        expect(response.headers.get('set-cookie')).toBeNull();
      });
    });

    it('rejects missing or inactive sessions without revoking anything', async () => {
      vi.mocked(findActiveAuthSession).mockResolvedValue(null);

      await withTestServer(app(), async (baseUrl) => {
        const response = await postLogout(baseUrl);

        expect(response.status).toBe(401);
        expect(findActiveAuthSession).toHaveBeenCalledWith(pool, sessionToken);
        expect(revokeAuthSession).not.toHaveBeenCalled();
        expect(response.headers.get('set-cookie')).toBeNull();
      });
    });

    it('hides database revocation failures and does not clear the cookie prematurely', async () => {
      vi.mocked(revokeAuthSession).mockRejectedValue(
        new Error('private database SQL and connection details'),
      );

      await withTestServer(app(), async (baseUrl) => {
        const response = await postLogout(baseUrl);
        const text = await response.text();

        expect(response.status).toBe(503);
        expect(text).not.toContain('private database');
        expect(text).not.toContain('connection details');
        expect(response.headers.get('set-cookie')).toBeNull();
        expect(revokeAuthSession).toHaveBeenCalledWith(pool, 'session-current');
      });
    });
  });
});
