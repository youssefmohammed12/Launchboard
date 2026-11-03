import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import { deriveCsrfToken } from '../auth/csrf.js';
import {
  PRE_SESSION_COOKIE_NAME,
  SESSION_COOKIE_NAME,
} from '../auth/cookies.js';
import { generateToken } from '../auth/tokens.js';
import { hashPassword } from '../auth/password.js';
import { createAccountActionToken } from '../auth/accountActionRepo.js';
import {
  consumePreAuthSession,
  createAuthSession,
  findPreAuthSession,
} from '../auth/sessionRepo.js';
import { withTestServer } from './helpers/server.js';
import type { AuthEmailSender } from '../routes/auth.js';

vi.mock('../auth/password.js', () => ({
  hashPassword: vi.fn(),
  verifyPassword: vi.fn(),
  isCurrentArgon2Params: vi.fn(),
}));

vi.mock('../auth/accountActionRepo.js', () => ({
  createAccountActionToken: vi.fn(),
  findAccountActionTokenForUpdate: vi.fn(),
  consumeAccountActionToken: vi.fn(),
  revokeAccountActionTokens: vi.fn(),
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

const emailSender = vi.fn<AuthEmailSender>(async () => undefined);

function app() {
  return createApp({ dbPool: pool, logErrors: false, emailSender });
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

async function postRegister(
  baseUrl: string,
  body: unknown = { email: ' User@Example.test ', password },
  headers: Record<string, string> = {},
) {
  return fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: requestHeaders(headers),
    body: JSON.stringify(body),
  });
}

describe('POST /api/auth/register', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('CSRF_SECRET', csrfSecret);
    vi.stubEnv('TRUSTED_ORIGINS', trustedOrigin);
    vi.stubEnv('SMTP_USER', 'launchboard.test@gmail.com');
    vi.stubEnv('SMTP_PASS', 'x'.repeat(16));
    vi.stubEnv('APP_BASE_URL', 'https://launchboard.example');

    connection.query.mockResolvedValue([[]]);
    connection.beginTransaction.mockResolvedValue(undefined);
    connection.execute.mockResolvedValue([{}, []]);
    connection.commit.mockResolvedValue(undefined);
    connection.rollback.mockResolvedValue(undefined);
    connection.release.mockImplementation(() => undefined);
    pool.getConnection.mockResolvedValue(connection);

    vi.mocked(hashPassword).mockResolvedValue('argon2id$test-hash');
    vi.mocked(createAccountActionToken).mockResolvedValue({
      id: 'verify-token-1',
      token: generateToken(),
      tokenHash: 'hashed-verification-token',
    });
    vi.mocked(findPreAuthSession).mockResolvedValue({ id: 'pre-session-1' } as any);
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

  it('creates an unverified account, sends a verification link and does not sign the user in', async () => {
    await withTestServer(app(), async (baseUrl) => {
      const response = await postRegister(baseUrl);
      const body = await response.json() as { message: string };

      expect(response.status).toBe(202);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(body.message).toContain('verification instructions');
      expect(JSON.stringify(body)).not.toContain('argon2id$test-hash');
      expect(JSON.stringify(body)).not.toContain(authSessionToken);

      expect(findPreAuthSession).toHaveBeenCalledWith(pool, preSessionToken);
      expect(hashPassword).toHaveBeenCalledWith(password);
      expect(pool.getConnection).toHaveBeenCalledOnce();
      expect(connection.query).toHaveBeenCalledWith("SET time_zone = '+00:00'");
      expect(connection.beginTransaction).toHaveBeenCalledOnce();
      expect(consumePreAuthSession).toHaveBeenCalledWith(connection, 'pre-session-1');

      const insert = connection.execute.mock.calls.find(([sql]) =>
        String(sql).includes('INSERT INTO users'),
      );
      expect(insert).toBeDefined();
      expect(String(insert?.[0])).toContain('email_verified_at');
      expect(insert?.[1]).toEqual([
        expect.stringMatching(/^[0-9a-f-]{36}$/i),
        'user@example.test',
        'argon2id$test-hash',
      ]);
      expect(createAccountActionToken).toHaveBeenCalledWith(
        connection,
        expect.any(String),
        'verify_email',
        24 * 60,
      );
      expect(createAuthSession).not.toHaveBeenCalled();
      expect(emailSender).toHaveBeenCalledOnce();
      expect(emailSender.mock.calls[0]?.[0]).toMatchObject({
        appBaseUrl: 'https://launchboard.example',
      });
      expect(emailSender.mock.calls[0]?.[1]).toMatchObject({
        to: 'user@example.test',
        subject: 'Verify your Launchboard email',
      });
      const verificationLines =
        emailSender.mock.calls[0]?.[1]?.text.split(/\r?\n/) ?? [];
      expect(
        verificationLines.some((line) =>
          line.startsWith('https://launchboard.example/#verifyEmail=') &&
          /^[A-Za-z0-9_-]{43}$/.test(line.slice('https://launchboard.example/#verifyEmail='.length)),
        ),
      ).toBe(true);
      expect(connection.commit).toHaveBeenCalledOnce();
      expect(connection.rollback).not.toHaveBeenCalled();
      expect(connection.release).toHaveBeenCalledOnce();

      const setCookie = response.headers.get('set-cookie') ?? '';
      expect(setCookie).toContain(`${PRE_SESSION_COOKIE_NAME}=;`);
      expect(setCookie).toContain('Max-Age=0');
      expect(setCookie).not.toContain(`${SESSION_COOKIE_NAME}=`);
    });
  });

  it('fails closed when email delivery is not configured', async () => {
    vi.unstubAllEnvs();
    vi.stubEnv('CSRF_SECRET', csrfSecret);
    vi.stubEnv('TRUSTED_ORIGINS', trustedOrigin);

    await withTestServer(app(), async (baseUrl) => {
      const response = await postRegister(baseUrl);
      expect(response.status).toBe(503);
      expect(response.headers.get('set-cookie')).toBeNull();
      expect(findPreAuthSession).not.toHaveBeenCalled();
      expect(pool.getConnection).not.toHaveBeenCalled();
    });
  });

  it('rejects a missing Origin before looking up the pre-session', async () => {
    await withTestServer(app(), async (baseUrl) => {
      const response = await postRegister(baseUrl, undefined, { Origin: '' });
      expect(response.status).toBe(403);
      expect(findPreAuthSession).not.toHaveBeenCalled();
      expect(hashPassword).not.toHaveBeenCalled();
      expect(pool.getConnection).not.toHaveBeenCalled();
    });
  });

  it('rejects an untrusted Origin before touching authentication state', async () => {
    await withTestServer(app(), async (baseUrl) => {
      const response = await postRegister(baseUrl, undefined, {
        Origin: 'https://attacker.example',
      });
      expect(response.status).toBe(403);
      expect(findPreAuthSession).not.toHaveBeenCalled();
      expect(pool.getConnection).not.toHaveBeenCalled();
    });
  });

  it('requires JSON content type', async () => {
    await withTestServer(app(), async (baseUrl) => {
      const response = await postRegister(baseUrl, undefined, {
        'Content-Type': 'text/plain',
      });
      expect(response.status).toBe(400);
      expect(findPreAuthSession).not.toHaveBeenCalled();
    });
  });

  it.each([
    { body: { email: 'not-an-email', password } },
    { body: { email: 'user@example.test', password: 'too-short' } },
    { body: { email: 'user@example.test', password, unexpected: true } },
  ])('rejects invalid registration input without hashing or database work', async ({ body }) => {
    await withTestServer(app(), async (baseUrl) => {
      const response = await postRegister(baseUrl, body);
      const text = await response.text();
      expect(response.status).toBe(422);
      expect(text).toContain('VALIDATION_ERROR');
      expect(findPreAuthSession).not.toHaveBeenCalled();
      expect(hashPassword).not.toHaveBeenCalled();
      expect(pool.getConnection).not.toHaveBeenCalled();
    });
  });

  it('requires a valid pre-authentication cookie', async () => {
    await withTestServer(app(), async (baseUrl) => {
      const response = await postRegister(baseUrl, undefined, {
        Cookie: `${PRE_SESSION_COOKIE_NAME}=malformed`,
      });
      expect(response.status).toBe(403);
      expect(findPreAuthSession).not.toHaveBeenCalled();
      expect(hashPassword).not.toHaveBeenCalled();
    });
  });

  it('rejects an unknown or expired pre-authentication session', async () => {
    vi.mocked(findPreAuthSession).mockResolvedValue(null);

    await withTestServer(app(), async (baseUrl) => {
      const response = await postRegister(baseUrl);
      expect(response.status).toBe(403);
      expect(hashPassword).not.toHaveBeenCalled();
      expect(pool.getConnection).not.toHaveBeenCalled();
    });
  });

  it('requires the matching pre-auth CSRF token', async () => {
    await withTestServer(app(), async (baseUrl) => {
      const response = await postRegister(baseUrl, undefined, {
        'X-CSRF-Token': 'incorrect-token',
      });
      expect(response.status).toBe(403);
      expect(hashPassword).not.toHaveBeenCalled();
      expect(pool.getConnection).not.toHaveBeenCalled();
    });
  });

  it('rejects a missing CSRF token', async () => {
    await withTestServer(app(), async (baseUrl) => {
      const response = await postRegister(baseUrl, undefined, {
        'X-CSRF-Token': '',
      });
      expect(response.status).toBe(403);
      expect(hashPassword).not.toHaveBeenCalled();
    });
  });

  it('returns a safe conflict and rolls back when the email is already registered', async () => {
    connection.execute.mockRejectedValue({
      code: 'ER_DUP_ENTRY',
      sqlMessage: "Duplicate entry for key 'uq_users_email'",
      message: 'private database detail',
    });

    await withTestServer(app(), async (baseUrl) => {
      const response = await postRegister(baseUrl);
      const text = await response.text();
      expect(response.status).toBe(202);
      expect(text).toContain('verification instructions');
      expect(text).not.toContain('EMAIL_IN_USE');
      expect(text).not.toContain('private database detail');
      expect(text).not.toContain('uq_users_email');
      expect(response.headers.get('set-cookie')).toContain(`${PRE_SESSION_COOKIE_NAME}=;`);
      expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
      expect(connection.rollback).toHaveBeenCalledOnce();
      expect(connection.commit).not.toHaveBeenCalled();
      expect(createAuthSession).not.toHaveBeenCalled();
      expect(connection.release).toHaveBeenCalledOnce();
    });
  });

  it('does not create an account if the pre-session was consumed concurrently', async () => {
    vi.mocked(consumePreAuthSession).mockResolvedValue(false);

    await withTestServer(app(), async (baseUrl) => {
      const response = await postRegister(baseUrl);
      expect(response.status).toBe(403);
      expect(connection.rollback).toHaveBeenCalledOnce();
      expect(connection.execute).not.toHaveBeenCalled();
      expect(createAuthSession).not.toHaveBeenCalled();
      expect(connection.commit).not.toHaveBeenCalled();
      expect(response.headers.get('set-cookie')).toBeNull();
    });
  });

  it('rolls back and hides unexpected database failures', async () => {
    connection.execute.mockRejectedValue(
      new Error('private SQL statement and database password detail'),
    );

    await withTestServer(app(), async (baseUrl) => {
      const response = await postRegister(baseUrl);
      const text = await response.text();
      expect(response.status).toBe(503);
      expect(text).not.toContain('private SQL statement');
      expect(text).not.toContain('database password');
      expect(connection.rollback).toHaveBeenCalledOnce();
      expect(connection.commit).not.toHaveBeenCalled();
      expect(connection.release).toHaveBeenCalledOnce();
    });
  });

  it('returns 503 when the pre-authentication repository is unavailable', async () => {
    vi.mocked(findPreAuthSession).mockRejectedValue(
      new Error('private pre-session database failure'),
    );

    await withTestServer(app(), async (baseUrl) => {
      const response = await postRegister(baseUrl);
      const text = await response.text();
      expect(response.status).toBe(503);
      expect(text).not.toContain('private pre-session database failure');
      expect(hashPassword).not.toHaveBeenCalled();
      expect(pool.getConnection).not.toHaveBeenCalled();
    });
  });
});
