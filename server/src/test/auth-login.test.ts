import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import { deriveCsrfToken } from '../auth/csrf.js';
import {
  PRE_SESSION_COOKIE_NAME,
  SESSION_COOKIE_NAME,
} from '../auth/cookies.js';
import {
  hashPassword,
  isCurrentArgon2Params,
  verifyPassword,
} from '../auth/password.js';
import { generateToken } from '../auth/tokens.js';
import {
  consumePreAuthSession,
  createAuthSession,
  findPreAuthSession,
} from '../auth/sessionRepo.js';
import { withTestServer } from './helpers/server.js';

vi.mock('../auth/password.js', () => ({
  hashPassword: vi.fn(),
  verifyPassword: vi.fn(),
  isCurrentArgon2Params: vi.fn(),
}));

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
const preSessionToken = generateToken(32);
const authSessionToken = generateToken(32);
const password = 'correct-horse-battery-staple-2026';
const userRow = {
  id: 'user-123',
  email: 'user@example.test',
  password_hash: '$argon2id$v=19$m=19456,t=2,p=1$salt$hash',
  email_verified_at: '2026-01-01 00:00:00.000',
};

const connection = {
  query: vi.fn(),
  beginTransaction: vi.fn(),
  execute: vi.fn(),
  commit: vi.fn(),
  rollback: vi.fn(),
  release: vi.fn(),
};

const pool = {
  getConnection: vi.fn(),
} as any;

function app() {
  return createApp({ dbPool: pool, logErrors: false });
}

function requestHeaders(overrides: Record<string, string> = {}) {
  return {
    Origin: trustedOrigin,
    'Content-Type': 'application/json',
    Cookie: `${PRE_SESSION_COOKIE_NAME}=${preSessionToken}`,
    'X-CSRF-Token': deriveCsrfToken(csrfSecret, 'pre-auth', preSessionToken),
    ...overrides,
  };
}

async function postLogin(
  baseUrl: string,
  body: unknown = { email: ' User@Example.test ', password },
  headers: Record<string, string> = {},
) {
  return fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: requestHeaders(headers),
    body: JSON.stringify(body),
  });
}

describe('POST /api/auth/login', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('CSRF_SECRET', csrfSecret);
    vi.stubEnv('TRUSTED_ORIGINS', trustedOrigin);

    connection.query.mockResolvedValue([[]]);
    connection.beginTransaction.mockResolvedValue(undefined);
    connection.execute.mockResolvedValue([[userRow], []]);
    connection.commit.mockResolvedValue(undefined);
    connection.rollback.mockResolvedValue(undefined);
    connection.release.mockImplementation(() => undefined);
    pool.getConnection.mockResolvedValue(connection);

    vi.mocked(findPreAuthSession).mockResolvedValue({ id: 'pre-session-1' } as any);
    vi.mocked(isCurrentArgon2Params).mockReturnValue(true);
    vi.mocked(verifyPassword).mockResolvedValue(true);
    vi.mocked(hashPassword).mockResolvedValue('argon2id$dummy-hash');
    vi.mocked(consumePreAuthSession).mockResolvedValue(true);
    vi.mocked(createAuthSession).mockResolvedValue({
      id: 'auth-session-1',
      token: authSessionToken,
      tokenHash: 'not-returned',
    } as any);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('authenticates a valid user, consumes pre-auth state and rotates cookies', async () => {
    await withTestServer(app(), async (baseUrl) => {
      const response = await postLogin(baseUrl);
      const body = await response.json() as {
        user: { id: string; email: string };
        csrfToken: string;
      };

      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(body).toEqual({
        user: { id: userRow.id, email: userRow.email },
        csrfToken: deriveCsrfToken(csrfSecret, 'authenticated', authSessionToken),
      });

      expect(findPreAuthSession).toHaveBeenCalledWith(pool, preSessionToken);
      expect(connection.execute).toHaveBeenCalledWith(
        expect.stringContaining('FROM users'),
        ['user@example.test'],
      );
      expect(isCurrentArgon2Params).toHaveBeenCalledWith(userRow.password_hash);
      expect(verifyPassword).toHaveBeenCalledWith(password, userRow.password_hash);

      // The lookup connection is released before Argon2 verification. A second
      // connection is then used for consuming pre-auth state and creating the
      // authenticated session within one transaction.
      expect(pool.getConnection).toHaveBeenCalledTimes(2);
      expect(connection.beginTransaction).toHaveBeenCalledOnce();
      expect(consumePreAuthSession).toHaveBeenCalledWith(connection, 'pre-session-1');
      expect(createAuthSession).toHaveBeenCalledWith(connection, userRow.id);
      expect(connection.commit).toHaveBeenCalledOnce();
      expect(connection.rollback).not.toHaveBeenCalled();
      expect(connection.release).toHaveBeenCalledTimes(2);

      const setCookie = response.headers.get('set-cookie') ?? '';
      expect(setCookie).toContain(`${SESSION_COOKIE_NAME}=${authSessionToken}`);
      expect(setCookie).toContain('HttpOnly');
      expect(setCookie).toContain('SameSite=Lax');
      expect(setCookie).toContain('Path=/');
      expect(setCookie).toContain(`${PRE_SESSION_COOKIE_NAME}=;`);
      expect(setCookie).toContain('Max-Age=0');
      expect(JSON.stringify(body)).not.toContain(userRow.password_hash);
      expect(JSON.stringify(body)).not.toContain(authSessionToken);
    });
  });

  it('returns the same generic credentials error for an unverified email', async () => {
    connection.execute.mockResolvedValue([[
      { ...userRow, email_verified_at: null },
    ], []]);

    await withTestServer(app(), async (baseUrl) => {
      const response = await postLogin(baseUrl);
      const body = await response.json() as { error: { code: string; message: string } };

      expect(response.status).toBe(401);
      expect(body.error).toMatchObject({
        code: 'INVALID_CREDENTIALS',
        message: 'Email or password is incorrect.',
      });
      expect(verifyPassword).toHaveBeenCalledWith(password, userRow.password_hash);
      expect(consumePreAuthSession).not.toHaveBeenCalled();
      expect(createAuthSession).not.toHaveBeenCalled();
      expect(response.headers.get('set-cookie')).toBeNull();
    });
  });

  it('returns the same generic credentials error for an unknown email', async () => {
    connection.execute.mockResolvedValue([[], []]);

    await withTestServer(app(), async (baseUrl) => {
      const response = await postLogin(baseUrl);
      const body = await response.json() as { error: { code: string; message: string } };

      expect(response.status).toBe(401);
      expect(body.error).toMatchObject({
        code: 'INVALID_CREDENTIALS',
        message: 'Email or password is incorrect.',
      });
      expect(hashPassword).toHaveBeenCalledWith('launchboard:dummy-login-timing-check:v1');
      expect(verifyPassword).not.toHaveBeenCalled();
      expect(consumePreAuthSession).not.toHaveBeenCalled();
      expect(createAuthSession).not.toHaveBeenCalled();
      expect(response.headers.get('set-cookie')).toBeNull();
    });
  });

  it('returns the same generic credentials error for a wrong password', async () => {
    vi.mocked(verifyPassword).mockResolvedValue(false);

    await withTestServer(app(), async (baseUrl) => {
      const response = await postLogin(baseUrl);
      const body = await response.json() as { error: { code: string; message: string } };

      expect(response.status).toBe(401);
      expect(body.error).toMatchObject({
        code: 'INVALID_CREDENTIALS',
        message: 'Email or password is incorrect.',
      });
      expect(hashPassword).not.toHaveBeenCalled();
      expect(consumePreAuthSession).not.toHaveBeenCalled();
      expect(createAuthSession).not.toHaveBeenCalled();
      expect(response.headers.get('set-cookie')).toBeNull();
    });
  });

  it('does not verify unsupported stored password-hash parameters', async () => {
    vi.mocked(isCurrentArgon2Params).mockReturnValue(false);

    await withTestServer(app(), async (baseUrl) => {
      const response = await postLogin(baseUrl);

      expect(response.status).toBe(401);
      expect(verifyPassword).not.toHaveBeenCalled();
      expect(hashPassword).toHaveBeenCalledWith('launchboard:dummy-login-timing-check:v1');
      expect(consumePreAuthSession).not.toHaveBeenCalled();
    });
  });

  it('rejects an untrusted Origin before accessing pre-auth state or the database', async () => {
    await withTestServer(app(), async (baseUrl) => {
      const response = await postLogin(baseUrl, undefined, {
        Origin: 'https://attacker.example',
      });

      expect(response.status).toBe(403);
      expect(findPreAuthSession).not.toHaveBeenCalled();
      expect(pool.getConnection).not.toHaveBeenCalled();
      expect(response.headers.get('cache-control')).toBe('no-store');
    });
  });

  it('requires the matching pre-auth CSRF token', async () => {
    await withTestServer(app(), async (baseUrl) => {
      const response = await postLogin(baseUrl, undefined, {
        'X-CSRF-Token': 'incorrect-token',
      });

      expect(response.status).toBe(403);
      expect(pool.getConnection).not.toHaveBeenCalled();
      expect(verifyPassword).not.toHaveBeenCalled();
    });
  });

  it('rejects invalid login input before database access', async () => {
    await withTestServer(app(), async (baseUrl) => {
      const response = await postLogin(baseUrl, {
        email: 'not-an-email',
        password: 'short',
      });
      const body = await response.json() as { error: { code: string } };

      expect(response.status).toBe(422);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(findPreAuthSession).not.toHaveBeenCalled();
      expect(pool.getConnection).not.toHaveBeenCalled();
    });
  });

  it('does not create an authenticated session if the pre-session was consumed concurrently', async () => {
    vi.mocked(consumePreAuthSession).mockResolvedValue(false);

    await withTestServer(app(), async (baseUrl) => {
      const response = await postLogin(baseUrl);

      expect(response.status).toBe(403);
      expect(connection.rollback).toHaveBeenCalledOnce();
      expect(createAuthSession).not.toHaveBeenCalled();
      expect(connection.commit).not.toHaveBeenCalled();
      expect(response.headers.get('set-cookie')).toBeNull();
    });
  });

  it('hides database lookup failures behind the safe service error', async () => {
    connection.execute.mockRejectedValue(
      new Error('private SQL and database credential detail'),
    );

    await withTestServer(app(), async (baseUrl) => {
      const response = await postLogin(baseUrl);
      const text = await response.text();

      expect(response.status).toBe(503);
      expect(text).not.toContain('private SQL');
      expect(text).not.toContain('database credential');
      expect(verifyPassword).not.toHaveBeenCalled();
      expect(consumePreAuthSession).not.toHaveBeenCalled();
    });
  });
});
