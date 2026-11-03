import { describe, expect, it, vi } from 'vitest';
import * as sessionRepo from '../auth/sessionRepo.js';

describe('auth session repository', () => {
  it('creates pre-auth sessions using a parameterized statement and returns a token', async () => {
    const execute = vi.fn().mockResolvedValue([{}]);
    const result = await sessionRepo.createPreAuthSession({ execute });

    expect(execute).toHaveBeenCalledOnce();
    expect(execute.mock.calls[0]?.[1]).toHaveLength(2);
    expect(result.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('returns null when a pre-auth session is not found', async () => {
    const execute = vi.fn().mockResolvedValue([[]]);
    const result = await sessionRepo.findPreAuthSession({ execute }, 'arbitrary-token');
    expect(result).toBeNull();
  });

  it('consumes a pre-auth session when one row is affected', async () => {
    const execute = vi.fn().mockResolvedValue([{ affectedRows: 1 }]);
    await expect(sessionRepo.consumePreAuthSession({ execute }, 'pre-1')).resolves.toBe(true);
  });

  it('does not consume a pre-auth session when no row is affected', async () => {
    const execute = vi.fn().mockResolvedValue([{ affectedRows: 0 }]);
    await expect(sessionRepo.consumePreAuthSession({ execute }, 'pre-1')).resolves.toBe(false);
  });

  it('creates authenticated sessions using a parameterized statement and returns a token', async () => {
    const execute = vi.fn().mockResolvedValue([{}]);
    const result = await sessionRepo.createAuthSession({ execute }, 'user-1');

    expect(execute).toHaveBeenCalledOnce();
    expect(execute.mock.calls[0]?.[1]).toHaveLength(3);
    expect(result.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});

describe('touchAuthSession', () => {
  it('returns true when the conditional update affects one row', async () => {
    const execute = vi.fn().mockResolvedValue([{ affectedRows: 1 }]);

    await expect(sessionRepo.touchAuthSession({ execute }, 'session-1')).resolves.toBe(true);
    expect(execute).toHaveBeenCalledOnce();
    expect(execute.mock.calls[0]?.[0]).toMatch(/^UPDATE sessions SET last_seen_at/);
    expect(execute.mock.calls[0]?.[1]).toEqual(['session-1']);
  });

  it('checks session activity when the update reports no changed rows', async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce([{ affectedRows: 0 }])
      .mockResolvedValueOnce([[{ active: 1 }]]);

    await expect(sessionRepo.touchAuthSession({ execute }, 'session-1')).resolves.toBe(true);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute.mock.calls[1]?.[0]).toMatch(/SELECT 1 AS active\s+FROM sessions/);
    expect(execute.mock.calls[1]?.[1]).toEqual(['session-1']);
  });

  it('returns false when the fallback check finds no active session', async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce([{ affectedRows: 0 }])
      .mockResolvedValueOnce([[]]);

    await expect(sessionRepo.touchAuthSession({ execute }, 'session-1')).resolves.toBe(false);
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('propagates failures from the conditional update', async () => {
    const failure = new Error('database update failure');
    const execute = vi.fn().mockRejectedValue(failure);

    await expect(sessionRepo.touchAuthSession({ execute }, 'session-1')).rejects.toBe(failure);
    expect(execute).toHaveBeenCalledOnce();
  });

  it('propagates failures from the fallback activity check', async () => {
    const failure = new Error('database follow-up failure');
    const execute = vi.fn()
      .mockResolvedValueOnce([{ affectedRows: 0 }])
      .mockRejectedValueOnce(failure);

    await expect(sessionRepo.touchAuthSession({ execute }, 'session-1')).rejects.toBe(failure);
    expect(execute).toHaveBeenCalledTimes(2);
  });
});


describe('session timestamp validation in the repository', () => {
  function currentSqlDateTime(): string {
    return new Date().toISOString().replace('T', ' ').replace('Z', '');
  }

  function authSessionRow(overrides: Record<string, unknown> = {}) {
    return {
      id: 'session-1',
      user_id: 'user-1',
      user_id2: 'user-1',
      email: 'person@example.test',
      last_seen_at: currentSqlDateTime(),
      expires_at: '2099-12-31 23:59:59.999',
      ...overrides,
    };
  }

  it('returns a valid active auth session with parsed UTC timestamps', async () => {
    const row = authSessionRow();
    const execute = vi.fn().mockResolvedValue([[row]]);

    const result = await sessionRepo.findActiveAuthSession({ execute }, 'valid-token');

    expect(result).not.toBeNull();
    expect(result?.session.id).toBe('session-1');
    expect(result?.session.userId).toBe('user-1');
    expect(result?.session.lastSeenAt).toBeInstanceOf(Date);
    expect(result?.session.expiresAt.toISOString()).toBe('2099-12-31T23:59:59.999Z');
    expect(result?.user).toEqual({ id: 'user-1', email: 'person@example.test' });
    expect(execute.mock.calls[0]?.[0]).toContain(
      'JOIN users u ON u.id = s.user_id AND u.email_verified_at IS NOT NULL',
    );
  });

  it('rejects an auth session whose absolute expiry has passed', async () => {
    const execute = vi.fn().mockResolvedValue([[
      authSessionRow({ expires_at: '2000-01-01 00:00:00.000' }),
    ]]);

    await expect(
      sessionRepo.findActiveAuthSession({ execute }, 'valid-token'),
    ).resolves.toBeNull();
  });

  it('rejects an auth session outside the idle window', async () => {
    const stale = new Date(Date.now() - 31 * 60 * 1000)
      .toISOString()
      .replace('T', ' ')
      .replace('Z', '');
    const execute = vi.fn().mockResolvedValue([[
      authSessionRow({ last_seen_at: stale }),
    ]]);

    await expect(
      sessionRepo.findActiveAuthSession({ execute }, 'valid-token'),
    ).resolves.toBeNull();
  });

  it.each([null, undefined, 'not-a-date', '2026-02-30 12:00:00'])(
    'rejects an auth session with invalid last_seen_at: %s',
    async (lastSeenAt) => {
      const execute = vi.fn().mockResolvedValue([[
        authSessionRow({ last_seen_at: lastSeenAt }),
      ]]);

      await expect(
        sessionRepo.findActiveAuthSession({ execute }, 'valid-token'),
      ).resolves.toBeNull();
    },
  );

  it.each([null, undefined, 'not-a-date', '2026-02-30 12:00:00'])(
    'rejects an auth session with invalid expires_at: %s',
    async (expiresAt) => {
      const execute = vi.fn().mockResolvedValue([[
        authSessionRow({ expires_at: expiresAt }),
      ]]);

      await expect(
        sessionRepo.findActiveAuthSession({ execute }, 'valid-token'),
      ).resolves.toBeNull();
    },
  );

  it('rejects a pre-auth session with an invalid expiry timestamp', async () => {
    const execute = vi.fn().mockResolvedValue([[
      {
        id: 'pre-1',
        token_hash: 'hash',
        created_at: '2026-10-31 10:00:00.000',
        expires_at: 'not-a-date',
        consumed_at: null,
        revoked_at: null,
      },
    ]]);

    await expect(
      sessionRepo.findPreAuthSession({ execute }, 'valid-token'),
    ).resolves.toBeNull();
  });

  it('rejects an expired pre-auth session', async () => {
    const execute = vi.fn().mockResolvedValue([[
      {
        id: 'pre-1',
        token_hash: 'hash',
        created_at: '2026-10-30 10:00:00.000',
        expires_at: '2026-10-30 10:15:00.000',
        consumed_at: null,
        revoked_at: null,
      },
    ]]);

    await expect(
      sessionRepo.findPreAuthSession({ execute }, 'valid-token'),
    ).resolves.toBeNull();
  });
});
