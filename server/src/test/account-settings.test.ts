import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import { deriveCsrfToken } from '../auth/csrf.js';
import { SESSION_COOKIE_NAME } from '../auth/cookies.js';
import { generateToken } from '../auth/tokens.js';
import { hashPassword, verifyPassword } from '../auth/password.js';
import { withTestServer } from './helpers/server.js';
import type { AccountSettingsEmailSender } from '../routes/accountSettings.js';

vi.mock('../middleware/requireAuth.js', () => ({
  createRequireAuth: () => (req: any, _res: any, next: any) => {
    req.auth = {
      sessionId: 'session-current',
      userId: 'user-123',
      user: { id: 'user-123', email: 'person@example.test' },
    };
    next();
  },
}));

vi.mock('../auth/password.js', () => ({
  hashPassword: vi.fn(),
  verifyPassword: vi.fn(),
  isCurrentArgon2Params: vi.fn(),
}));

const csrfSecret = Buffer.alloc(32, 0x5a).toString('base64url');
const trustedOrigin = 'http://127.0.0.1:5173';
const sessionToken = generateToken(32);
const profile = {
  id: 'user-123',
  email: 'person@example.test',
  display_name: 'Youssef',
  email_verified_at: new Date('2026-10-01T10:00:00.000Z'),
  created_at: new Date('2026-10-01T10:00:00.000Z'),
};
const connection = {
  query: vi.fn(),
  beginTransaction: vi.fn(),
  execute: vi.fn(),
  commit: vi.fn(),
  rollback: vi.fn(),
  release: vi.fn(),
};
const pool = { execute: vi.fn(), getConnection: vi.fn() } as any;
const deleteUserSql = ['DELETE', 'FROM users WHERE id = ?'].join(' ');
const emailSender = vi.fn<AccountSettingsEmailSender>(async () => undefined);

function mutationHeaders(overrides: Record<string, string> = {}) {
  return {
    Origin: trustedOrigin,
    'Content-Type': 'application/json',
    Cookie: `${SESSION_COOKIE_NAME}=${sessionToken}`,
    'X-CSRF-Token': deriveCsrfToken(csrfSecret, 'authenticated', sessionToken),
    ...overrides,
  };
}

function app() {
  return createApp({
    dbPool: pool,
    logErrors: false,
    emailSender,
  });
}

async function request(
  baseUrl: string,
  path: string,
  method: 'GET' | 'PATCH' | 'POST' | 'DELETE',
  body?: unknown,
  headers: Record<string, string> = mutationHeaders(),
) {
  return fetch(`${baseUrl}/api${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe('authenticated account settings routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('CSRF_SECRET', csrfSecret);
    vi.stubEnv('TRUSTED_ORIGINS', trustedOrigin);
    vi.stubEnv('SMTP_USER', 'launchboard.test@gmail.com');
    vi.stubEnv('SMTP_PASS', 'abcdEFGH12345678');
    vi.stubEnv('APP_BASE_URL', 'https://launchboard.example');
    connection.query.mockResolvedValue([[]]);
    connection.beginTransaction.mockResolvedValue(undefined);
    connection.execute.mockImplementation(async (sql: unknown) => {
      const statement = String(sql);
      if (statement.includes('SELECT id, password_hash FROM users')) {
        return [[{ id: 'user-123', password_hash: 'existing-hash' }], []];
      }
      if (statement.includes('SELECT id FROM users') && statement.includes('FOR UPDATE')) {
        return [[{ id: 'user-123' }], []];
      }
      if (statement.includes('SELECT id') && statement.includes('FROM sessions')) {
        return [[{ id: 'session-current' }], []];
      }
      if (statement.includes('SELECT id, email, display_name')) return [[profile], []];
      if (statement.includes('SELECT id, email, password_hash FROM users')) {
        return [[{ id: 'user-123', email: profile.email, password_hash: 'existing-hash' }], []];
      }
      if (statement.startsWith('UPDATE users')) return [{ affectedRows: 1 }, []];
      if (statement === deleteUserSql) return [{ affectedRows: 1 }, []];
      return [{ affectedRows: 1 }, []];
    });
    connection.commit.mockResolvedValue(undefined);
    connection.rollback.mockResolvedValue(undefined);
    connection.release.mockImplementation(() => undefined);
    pool.getConnection.mockResolvedValue(connection);
    pool.execute.mockImplementation(async (sql: unknown) => {
      const statement = String(sql);
      if (statement.includes('SELECT id, email, display_name')) return [[profile], []];
      if (statement.includes('SELECT id, email, password_hash FROM users')) {
        return [[{ id: 'user-123', email: profile.email, password_hash: 'existing-hash' }], []];
      }
      if (statement.startsWith('UPDATE users')) return [{ affectedRows: 1 }, []];
      if (statement.includes('SELECT id FROM users')) return [[{ id: 'user-123' }], []];
      return [{ affectedRows: 1 }, []];
    });
    vi.mocked(verifyPassword).mockResolvedValue(true);
    vi.mocked(hashPassword).mockResolvedValue('argon2id$new-password-hash');
  });

  afterEach(() => vi.unstubAllEnvs());

  it('returns only the authenticated account profile and disables caching', async () => {
    await withTestServer(app(), async (baseUrl) => {
      const response = await request(baseUrl, '/account/profile', 'GET');
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(await response.json()).toEqual({
        profile: {
          id: profile.id,
          email: profile.email,
          displayName: profile.display_name,
          emailVerified: true,
          createdAt: profile.created_at.toISOString(),
        },
      });
      expect(pool.execute).toHaveBeenCalledWith(
        expect.stringContaining('WHERE id = ? LIMIT 1'),
        ['user-123'],
      );
    });
  });

  it('updates only the authenticated user display name', async () => {
    await withTestServer(app(), async (baseUrl) => {
      const response = await request(baseUrl, '/account/profile', 'PATCH', {
        displayName: '  Youssef Mohammed  ',
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ profile: { displayName: 'Youssef Mohammed' } });
      expect(pool.execute).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE users SET display_name = ?'),
        ['Youssef Mohammed', 'user-123'],
      );
    });
  });

  it('rejects an invalid profile name before writing', async () => {
    await withTestServer(app(), async (baseUrl) => {
      const response = await request(baseUrl, '/account/profile', 'PATCH', {
        displayName: 'x'.repeat(81),
      });
      expect(response.status).toBe(422);
      expect(pool.execute).not.toHaveBeenCalled();
    });
  });

  it('requires the authenticated CSRF token for profile mutations', async () => {
    await withTestServer(app(), async (baseUrl) => {
      const response = await request(
        baseUrl,
        '/account/profile',
        'PATCH',
        { displayName: 'New name' },
        mutationHeaders({ 'X-CSRF-Token': 'invalid-token' }),
      );
      expect(response.status).toBe(403);
      expect(pool.execute).not.toHaveBeenCalled();
    });
  });

  describe('password and account deletion actions', () => {
  it('changes the password after verifying the current password and revokes other sessions', async () => {
    await withTestServer(app(), async (baseUrl) => {
      const response = await request(baseUrl, '/account/password', 'POST', {
        currentPassword: 'current-password',
        newPassword: 'a-new-password-that-is-long-enough',
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        message: expect.stringContaining('Other active sessions'),
      });
      expect(verifyPassword).toHaveBeenCalledWith('current-password', 'existing-hash');
      expect(hashPassword).toHaveBeenCalledWith('a-new-password-that-is-long-enough');
      expect(connection.execute).toHaveBeenCalledWith(
        'SELECT id FROM users WHERE id = ? FOR UPDATE',
        ['user-123'],
      );
      expect(connection.execute).toHaveBeenCalledWith(
        expect.stringContaining('FROM sessions'),
        ['session-current', 'user-123'],
      );
      expect(connection.execute).toHaveBeenCalledWith(
        expect.stringContaining('WHERE id = ? AND password_hash = ?'),
        ['argon2id$new-password-hash', 'user-123', 'existing-hash'],
      );
      expect(connection.execute).toHaveBeenCalledWith(
        expect.stringContaining('id <> ? AND revoked_at IS NULL'),
        ['user-123', 'session-current'],
      );
      expect(connection.commit).toHaveBeenCalledOnce();
      expect(emailSender).toHaveBeenCalledWith(
        expect.objectContaining({ appBaseUrl: 'https://launchboard.example' }),
        expect.objectContaining({
          subject: 'Your Launchboard password was changed',
          html: expect.stringContaining('This browser remains signed in'),
        }),
      );
    });
  });

  it('does not change a password when the current password is wrong', async () => {
    vi.mocked(verifyPassword).mockResolvedValue(false);
    await withTestServer(app(), async (baseUrl) => {
      const response = await request(baseUrl, '/account/password', 'POST', {
        currentPassword: 'wrong-password',
        newPassword: 'a-new-password-that-is-long-enough',
      });
      expect(response.status).toBe(403);
      expect(hashPassword).not.toHaveBeenCalled();
      expect(pool.getConnection).not.toHaveBeenCalled();
    });
  });

  it('deletes the account only after password and exact confirmation checks', async () => {
    await withTestServer(app(), async (baseUrl) => {
      const response = await request(baseUrl, '/account', 'DELETE', {
        currentPassword: 'current-password',
        confirmation: 'DELETE',
      });
      expect(response.status).toBe(204);
      expect(connection.execute).toHaveBeenCalledWith(
        expect.stringContaining('SELECT id, password_hash FROM users WHERE id = ? FOR UPDATE'),
        ['user-123'],
      );
      expect(connection.execute).toHaveBeenCalledWith(
        expect.stringContaining('FROM sessions'),
        ['session-current', 'user-123'],
      );
      expect(connection.execute).toHaveBeenCalledWith(
        expect.stringContaining('DELETE interview'),
        ['user-123'],
      );
      expect(connection.execute).toHaveBeenCalledWith(deleteUserSql, ['user-123']);
      const interviewDeleteIndex = connection.execute.mock.calls.findIndex(
        ([sql]) => String(sql).includes('DELETE interview'),
      );
      const userDeleteIndex = connection.execute.mock.calls.findIndex(
        ([sql]) => String(sql) === deleteUserSql,
      );
      expect(interviewDeleteIndex).toBeGreaterThanOrEqual(0);
      expect(interviewDeleteIndex).toBeLessThan(userDeleteIndex);
      expect(connection.commit).toHaveBeenCalledOnce();
      expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
    });
  });

  it('rolls back account deletion when the current password is wrong', async () => {
    vi.mocked(verifyPassword).mockResolvedValue(false);
    await withTestServer(app(), async (baseUrl) => {
      const response = await request(baseUrl, '/account', 'DELETE', {
        currentPassword: 'wrong-password',
        confirmation: 'DELETE',
      });
      expect(response.status).toBe(403);
      expect(connection.rollback).toHaveBeenCalledOnce();
      expect(connection.execute).not.toHaveBeenCalledWith(deleteUserSql, ['user-123']);
      expect(connection.commit).not.toHaveBeenCalled();
    });
  });

  it('aborts a password change when its session was revoked before the transaction lock', async () => {
    connection.execute
      .mockImplementationOnce(async () => [[{ id: 'user-123' }], []])
      .mockImplementationOnce(async () => [[], []]);

    await withTestServer(app(), async (baseUrl) => {
      const response = await request(baseUrl, '/account/password', 'POST', {
        currentPassword: 'current-password',
        newPassword: 'a-new-password-that-is-long-enough',
      });
      expect(response.status).toBe(401);
      expect(connection.rollback).toHaveBeenCalledOnce();
      expect(connection.execute).not.toHaveBeenCalledWith(
        expect.stringContaining('UPDATE users'),
        expect.anything(),
      );
      expect(connection.commit).not.toHaveBeenCalled();
    });
  });

  it('aborts account deletion when its session is no longer active', async () => {
    connection.execute
      .mockImplementationOnce(async () => [[{ id: 'user-123', password_hash: 'existing-hash' }], []])
      .mockImplementationOnce(async () => [[], []]);

    await withTestServer(app(), async (baseUrl) => {
      const response = await request(baseUrl, '/account', 'DELETE', {
        currentPassword: 'current-password',
        confirmation: 'DELETE',
      });
      expect(response.status).toBe(401);
      expect(connection.rollback).toHaveBeenCalledOnce();
      expect(connection.execute).not.toHaveBeenCalledWith(
        expect.stringContaining('DELETE interview'),
        expect.anything(),
      );
      expect(connection.execute).not.toHaveBeenCalledWith(deleteUserSql, ['user-123']);
      expect(connection.commit).not.toHaveBeenCalled();
    });
  });

  it('requires the literal DELETE confirmation', async () => {
    await withTestServer(app(), async (baseUrl) => {
      const response = await request(baseUrl, '/account', 'DELETE', {
        currentPassword: 'current-password',
        confirmation: 'delete',
      });
      expect(response.status).toBe(422);
      expect(pool.getConnection).not.toHaveBeenCalled();
    });
  });
});

});
