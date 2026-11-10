import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import { deriveCsrfToken } from '../auth/csrf.js';
import { PRE_SESSION_COOKIE_NAME } from '../auth/cookies.js';
import { generateToken } from '../auth/tokens.js';
import {
  consumeAccountActionToken,
  createAccountActionToken,
  findAccountActionTokenForUpdate,
  revokeAccountActionTokens,
} from '../auth/accountActionRepo.js';
import { findPreAuthSession } from '../auth/sessionRepo.js';
import { hashPassword } from '../auth/password.js';
import { withTestServer } from './helpers/server.js';
import type { AccountActionEmailSender } from '../routes/accountActions.js';

vi.mock('../auth/accountActionRepo.js', () => ({
  consumeAccountActionToken: vi.fn(),
  createAccountActionToken: vi.fn(),
  findAccountActionTokenForUpdate: vi.fn(),
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

vi.mock('../auth/password.js', () => ({
  hashPassword: vi.fn(),
  verifyPassword: vi.fn(),
  isCurrentArgon2Params: vi.fn(),
}));

const csrfSecret = Buffer.alloc(32, 0x5a).toString('base64url');
const trustedOrigin = 'http://127.0.0.1:5173';
const preSessionToken = generateToken();
const actionToken = generateToken();
const user: { id: string; email: string; email_verified_at: string | null } = {
  id: 'user-123',
  email: 'person@example.test',
  email_verified_at: null,
};

const connection = {
  query: vi.fn(),
  beginTransaction: vi.fn(),
  execute: vi.fn(),
  commit: vi.fn(),
  rollback: vi.fn(),
  release: vi.fn(),
};
const pool = { getConnection: vi.fn() } as any;
const emailSender = vi.fn<AccountActionEmailSender>(async () => undefined);

function app() {
  return createApp({ dbPool: pool, logErrors: false, emailSender });
}

function headers(overrides: Record<string, string> = {}) {
  return {
    Origin: trustedOrigin,
    'Content-Type': 'application/json',
    Cookie: `${PRE_SESSION_COOKIE_NAME}=${preSessionToken}`,
    'X-CSRF-Token': deriveCsrfToken(csrfSecret, 'pre-auth', preSessionToken),
    ...overrides,
  };
}

async function post(baseUrl: string, path: string, body: unknown, extra: Record<string, string> = {}) {
  return fetch(`${baseUrl}/api/auth/${path}`, {
    method: 'POST',
    headers: headers(extra),
    body: JSON.stringify(body),
  });
}

describe('email verification and password recovery routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    user.email_verified_at = null;
    vi.stubEnv('CSRF_SECRET', csrfSecret);
    vi.stubEnv('TRUSTED_ORIGINS', trustedOrigin);
    vi.stubEnv('SMTP_USER', 'launchboard.test@gmail.com');
    vi.stubEnv('SMTP_PASS', 'abcdEFGH12345678');
    vi.stubEnv('APP_BASE_URL', 'https://launchboard.example');

    connection.query.mockResolvedValue([[]]);
    connection.beginTransaction.mockResolvedValue(undefined);
    connection.execute.mockImplementation(async (sql: unknown) => {
      const statement = String(sql);
      if (statement.includes('SELECT id, email, email_verified_at')) {
        return [[user], []];
      }
      if (statement.includes('SELECT email FROM users')) {
        return [[{ email: user.email }], []];
      }
      return [{ affectedRows: 1 }, []];
    });
    connection.commit.mockResolvedValue(undefined);
    connection.rollback.mockResolvedValue(undefined);
    connection.release.mockImplementation(() => undefined);
    pool.getConnection.mockResolvedValue(connection);

    vi.mocked(findPreAuthSession).mockResolvedValue({ id: 'pre-session-1' } as any);
    vi.mocked(createAccountActionToken).mockResolvedValue({
      id: 'token-row-1',
      token: actionToken,
      tokenHash: 'hashed-token',
    });
    vi.mocked(findAccountActionTokenForUpdate).mockResolvedValue({
      id: 'token-row-1',
      user_id: user.id,
      purpose: 'verify_email',
      token_hash: 'hashed-token',
      expires_at: new Date(Date.now() + 60_000),
      consumed_at: null,
      revoked_at: null,
    });
    vi.mocked(consumeAccountActionToken).mockResolvedValue(true);
    vi.mocked(revokeAccountActionTokens).mockResolvedValue(0);
    vi.mocked(hashPassword).mockResolvedValue('argon2id$new-password-hash');
  });

  afterEach(() => vi.unstubAllEnvs());

  it('verifies email through a single-use POST and never establishes a session', async () => {
    await withTestServer(app(), async (baseUrl) => {
      const response = await post(baseUrl, 'verify-email', { token: actionToken });
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(findAccountActionTokenForUpdate).toHaveBeenCalledWith(
        connection,
        actionToken,
        'verify_email',
      );
      expect(consumeAccountActionToken).toHaveBeenCalledWith(connection, 'token-row-1');
      expect(connection.execute).toHaveBeenCalledWith(
        expect.stringContaining('email_verified_at = COALESCE'),
        [user.id],
      );
      expect(revokeAccountActionTokens).toHaveBeenCalledWith(
        connection,
        user.id,
        'verify_email',
      );
      expect(connection.commit).toHaveBeenCalledOnce();
      expect(response.headers.get('set-cookie')).toBeNull();
      expect(JSON.stringify(await response.json())).not.toContain(actionToken);
    });
  });

  it('returns the same public response for known and unknown reset-request emails', async () => {
    user.email_verified_at = '2026-01-01 00:00:00.000';
    await withTestServer(app(), async (baseUrl) => {
      const known = await post(baseUrl, 'password-reset/request', { email: user.email });
      connection.execute.mockImplementationOnce(async () => [[], []]);
      const unknown = await post(baseUrl, 'password-reset/request', { email: 'missing@example.test' });

      expect(known.status).toBe(202);
      expect(unknown.status).toBe(202);
      expect(await known.json()).toEqual(await unknown.json());
      expect(known.headers.get('cache-control')).toBe('no-store');
      expect(emailSender).toHaveBeenCalledOnce();
      expect(emailSender.mock.calls[0]?.[1]).toMatchObject({
        subject: 'Reset your Launchboard password',
        html: expect.stringContaining('Reset password'),
      });
    });
  });

  it('resends verification without revealing account state and sends links from APP_BASE_URL', async () => {
    await withTestServer(app(), async (baseUrl) => {
      const response = await post(baseUrl, 'resend-verification', { email: user.email });
      expect(response.status).toBe(202);
      expect(createAccountActionToken).toHaveBeenCalledWith(
        connection,
        user.id,
        'verify_email',
        24 * 60,
      );
      expect(emailSender).toHaveBeenCalledWith(
        expect.objectContaining({ appBaseUrl: 'https://launchboard.example' }),
        expect.objectContaining({
          to: user.email,
          subject: 'Verify your Launchboard email address',
          text: expect.stringContaining('https://launchboard.example/#verifyEmail='),
          html: expect.stringContaining('Verify email address'),
        }),
      );
    });
  });

  it('changes password transactionally and revokes every existing session', async () => {
    vi.mocked(findAccountActionTokenForUpdate).mockResolvedValue({
      id: 'reset-token-1',
      user_id: user.id,
      purpose: 'reset_password',
      token_hash: 'hashed-token',
      expires_at: new Date(Date.now() + 60_000),
      consumed_at: null,
      revoked_at: null,
    });

    await withTestServer(app(), async (baseUrl) => {
      const response = await post(baseUrl, 'password-reset/confirm', {
        token: actionToken,
        password: 'a-new-long-passphrase-for-launchboard',
      });

      expect(response.status).toBe(200);
      expect(hashPassword).toHaveBeenCalledWith('a-new-long-passphrase-for-launchboard');
      expect(consumeAccountActionToken).toHaveBeenCalledWith(connection, 'reset-token-1');
      expect(connection.execute).toHaveBeenCalledWith(
        expect.stringContaining('SET password_hash = ?'),
        expect.arrayContaining(['argon2id$new-password-hash', user.id]),
      );
      expect(connection.execute).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE sessions'),
        [user.id],
      );
      expect(revokeAccountActionTokens).toHaveBeenCalledWith(
        connection,
        user.id,
        'reset_password',
      );
      expect(connection.commit).toHaveBeenCalledOnce();
      expect(response.headers.get('set-cookie')).toBeNull();
      expect(emailSender).toHaveBeenCalledWith(
        expect.objectContaining({ appBaseUrl: 'https://launchboard.example' }),
        expect.objectContaining({
          subject: 'Your Launchboard password was reset',
          html: expect.stringContaining('all existing sign-in sessions were signed out'),
        }),
      );
    });
  });

  it('rejects a missing or untrusted Origin before checking or consuming a link token', async () => {
    await withTestServer(app(), async (baseUrl) => {
      const response = await post(
        baseUrl,
        'verify-email',
        { token: actionToken },
        { Origin: 'https://attacker.example' },
      );
      expect(response.status).toBe(403);
      expect(findAccountActionTokenForUpdate).not.toHaveBeenCalled();
      expect(consumeAccountActionToken).not.toHaveBeenCalled();
      expect(pool.getConnection).not.toHaveBeenCalled();
    });
  });

  it('does not consume an expired, missing or already-used token', async () => {
    vi.mocked(findAccountActionTokenForUpdate).mockResolvedValue(null);

    await withTestServer(app(), async (baseUrl) => {
      const response = await post(baseUrl, 'verify-email', { token: actionToken });
      expect(response.status).toBe(400);
      expect(consumeAccountActionToken).not.toHaveBeenCalled();
      expect(connection.commit).not.toHaveBeenCalled();
      expect(response.headers.get('set-cookie')).toBeNull();
    });
  });
});
