import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import { deriveCsrfToken } from '../auth/csrf.js';
import {
  PRE_SESSION_COOKIE_NAME,
  SESSION_COOKIE_NAME,
} from '../auth/cookies.js';
import { generateToken } from '../auth/tokens.js';
import {
  consumePreAuthSession,
  createAuthSession,
  createPreAuthSession,
  findActiveAuthSession,
  findPreAuthSession,
  revokeAuthSession,
  revokePreAuthSession,
  touchAuthSession,
} from '../auth/sessionRepo.js';
import { withTestServer } from './helpers/server.js';

vi.mock('../auth/sessionRepo.js', () => ({
  findActiveAuthSession: vi.fn(),
  touchAuthSession: vi.fn(),
  findPreAuthSession: vi.fn(),
  createPreAuthSession: vi.fn(),
  revokePreAuthSession: vi.fn(),
  consumePreAuthSession: vi.fn(),
  createAuthSession: vi.fn(),
  revokeAuthSession: vi.fn(),
}));

const pool = {} as any;
const csrfSecret = Buffer.alloc(32, 0x5a).toString('base64url');
const trustedOrigin = 'http://127.0.0.1:5173';

function authApp() {
  return createApp({ dbPool: pool, logErrors: false });
}

function cookie(name: string, value: string): string {
  return `${name}=${value}`;
}

async function readJson(response: Response): Promise<any> {
  return response.json();
}

describe('authentication CSRF routes HTTP integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('CSRF_SECRET', csrfSecret);
    vi.stubEnv('TRUSTED_ORIGINS', trustedOrigin);
    vi.mocked(findActiveAuthSession).mockResolvedValue(null);
    vi.mocked(findPreAuthSession).mockResolvedValue(null);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns the authenticated CSRF token for a valid authenticated session', async () => {
    const token = generateToken();
    vi.mocked(findActiveAuthSession).mockResolvedValue({} as any);

    await withTestServer(authApp(), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/auth/csrf`, {
        headers: { Cookie: cookie(SESSION_COOKIE_NAME, token) },
      });
      expect(response.status).toBe(200);
      expect(await readJson(response)).toEqual({
        context: 'authenticated',
        csrfToken: deriveCsrfToken(csrfSecret, 'authenticated', token),
      });
      expect(findActiveAuthSession).toHaveBeenCalledOnce();
      expect(findActiveAuthSession).toHaveBeenCalledWith(pool, token);
      expect(findPreAuthSession).not.toHaveBeenCalled();
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(response.headers.get('set-cookie')).toBeNull();
    });
  });

  it('returns the pre-auth CSRF token for a valid pre-auth session', async () => {
    const token = generateToken();
    vi.mocked(findPreAuthSession).mockResolvedValue({ id: 'pre-1' } as any);

    await withTestServer(authApp(), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/auth/csrf`, {
        headers: { Cookie: cookie(PRE_SESSION_COOKIE_NAME, token) },
      });
      expect(response.status).toBe(200);
      expect(await readJson(response)).toEqual({
        context: 'pre-auth',
        csrfToken: deriveCsrfToken(csrfSecret, 'pre-auth', token),
      });
      expect(findActiveAuthSession).not.toHaveBeenCalled();
      expect(findPreAuthSession).toHaveBeenCalledWith(pool, token);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(response.headers.get('set-cookie')).toBeNull();
    });
  });

  it('keeps pre-auth CSRF lookup read-only and never sets cookies', async () => {
    const token = generateToken();
    vi.mocked(findPreAuthSession).mockResolvedValue({ id: 'pre-read-only' } as any);

    await withTestServer(authApp(), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/auth/csrf`, {
        headers: { Cookie: cookie(PRE_SESSION_COOKIE_NAME, token) },
      });
      expect(response.status).toBe(200);
      expect(touchAuthSession).not.toHaveBeenCalled();
      expect(createPreAuthSession).not.toHaveBeenCalled();
      expect(revokePreAuthSession).not.toHaveBeenCalled();
      expect(consumePreAuthSession).not.toHaveBeenCalled();
      expect(createAuthSession).not.toHaveBeenCalled();
      expect(revokeAuthSession).not.toHaveBeenCalled();
      expect(response.headers.get('set-cookie')).toBeNull();
    });
  });

  it('returns 503 and does not fall back when authenticated session lookup fails', async () => {
    const authToken = generateToken();
    const preToken = generateToken();
    vi.mocked(findActiveAuthSession).mockRejectedValue(
      new Error('private authenticated database failure'),
    );

    await withTestServer(authApp(), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/auth/csrf`, {
        headers: {
          Cookie: [
            cookie(SESSION_COOKIE_NAME, authToken),
            cookie(PRE_SESSION_COOKIE_NAME, preToken),
          ].join('; '),
        },
      });
      const text = await response.text();
      expect(response.status).toBe(503);
      expect(findActiveAuthSession).toHaveBeenCalledWith(pool, authToken);
      expect(findPreAuthSession).not.toHaveBeenCalled();
      expect(text).not.toContain('private authenticated database failure');
      expect(response.headers.get('set-cookie')).toBeNull();
    });
  });

  it('returns 503 when the pre-auth session lookup fails', async () => {
    const token = generateToken();
    vi.mocked(findPreAuthSession).mockRejectedValue(
      new Error('private pre-auth database failure'),
    );

    await withTestServer(authApp(), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/auth/csrf`, {
        headers: { Cookie: cookie(PRE_SESSION_COOKIE_NAME, token) },
      });
      const text = await response.text();
      expect(response.status).toBe(503);
      expect(findPreAuthSession).toHaveBeenCalledWith(pool, token);
      expect(text).not.toContain('private pre-auth database failure');
      expect(response.headers.get('set-cookie')).toBeNull();
    });
  });

  it('does not query the repository for malformed session tokens', async () => {
    await withTestServer(authApp(), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/auth/csrf`, {
        headers: {
          Cookie: [
            cookie(SESSION_COOKIE_NAME, 'malformed'),
            cookie(PRE_SESSION_COOKIE_NAME, 'also-malformed'),
          ].join('; '),
        },
      });
      expect(response.status).toBe(401);
      expect(findActiveAuthSession).not.toHaveBeenCalled();
      expect(findPreAuthSession).not.toHaveBeenCalled();
      expect(response.headers.get('cache-control')).toBe('no-store');
    });
  });

  it('keeps GET CSRF read-only and never touches or mutates session state', async () => {
    const token = generateToken();
    vi.mocked(findActiveAuthSession).mockResolvedValue({} as any);

    await withTestServer(authApp(), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/auth/csrf`, {
        headers: { Cookie: cookie(SESSION_COOKIE_NAME, token) },
      });
      expect(response.status).toBe(200);
      expect(touchAuthSession).not.toHaveBeenCalled();
      expect(createPreAuthSession).not.toHaveBeenCalled();
      expect(revokePreAuthSession).not.toHaveBeenCalled();
      expect(consumePreAuthSession).not.toHaveBeenCalled();
      expect(createAuthSession).not.toHaveBeenCalled();
      expect(revokeAuthSession).not.toHaveBeenCalled();
      expect(response.headers.get('set-cookie')).toBeNull();
    });
  });

  it('returns 503 for pre-session creation database failures without exposing the driver error', async () => {
    vi.mocked(createPreAuthSession).mockRejectedValue(
      new Error('ER_ACCESS_DENIED_ERROR: private pre-session database failure'),
    );

    await withTestServer(authApp(), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/auth/pre-session`, {
        method: 'POST',
        headers: {
          Origin: trustedOrigin,
          'Content-Type': 'application/json',
        },
        body: '{}',
      });
      const text = await response.text();
      expect(response.status).toBe(503);
      expect(createPreAuthSession).toHaveBeenCalledWith(pool);
      expect(text).not.toContain('ER_ACCESS_DENIED_ERROR');
      expect(text).not.toContain('private pre-session database failure');
    });
  });

  it('rejects a missing Origin on pre-session creation without touching the repository', async () => {
    await withTestServer(authApp(), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/auth/pre-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      expect(response.status).toBe(403);
      expect(createPreAuthSession).not.toHaveBeenCalled();
    });
  });

  it('rejects an untrusted Origin on pre-session creation without touching the repository', async () => {
    await withTestServer(authApp(), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/auth/pre-session`, {
        method: 'POST',
        headers: {
          Origin: 'https://attacker.example',
          'Content-Type': 'application/json',
        },
        body: '{}',
      });
      expect(response.status).toBe(403);
      expect(createPreAuthSession).not.toHaveBeenCalled();
    });
  });
});
