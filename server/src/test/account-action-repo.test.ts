import { describe, expect, it, vi } from 'vitest';
import {
  consumeAccountActionToken,
  createAccountActionToken,
  findAccountActionTokenForUpdate,
  revokeAccountActionTokens,
} from '../auth/accountActionRepo.js';
import { hashToken, isValidToken } from '../auth/tokens.js';

describe('account action token repository', () => {
  it('stores only a SHA-256 token hash and returns the raw token only to the caller', async () => {
    const executor = {
      execute: vi.fn()
        .mockResolvedValueOnce([{ affectedRows: 1 }, []])
        .mockResolvedValueOnce([{ insertId: 1 }, []]),
    };

    const result = await createAccountActionToken(
      executor,
      'user-123',
      'verify_email',
      24 * 60,
    );

    expect(isValidToken(result.token)).toBe(true);
    expect(result.tokenHash).toBe(hashToken(result.token));
    expect(result.tokenHash).not.toBe(result.token);
    expect(executor.execute).toHaveBeenCalledTimes(2);
    expect(executor.execute.mock.calls[0]?.[0]).toContain('UPDATE auth_action_tokens');
    expect(executor.execute.mock.calls[1]?.[0]).toContain('INSERT INTO auth_action_tokens');
    expect(executor.execute.mock.calls[1]?.[1]).toContain(hashToken(result.token));
    expect(executor.execute.mock.calls[1]?.[1]).not.toContain(result.token);
  });

  it('locks and filters a token by hash, purpose, expiry and unused state', async () => {
    const row = {
      id: 'token-row-1',
      user_id: 'user-123',
      purpose: 'reset_password',
    };
    const executor = {
      execute: vi.fn().mockResolvedValueOnce([[row], []]),
    };

    const result = await findAccountActionTokenForUpdate(
      executor,
      'A'.repeat(43),
      'reset_password',
    );

    expect(result).toEqual(row);
    const [sql, params] = executor.execute.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toContain('FOR UPDATE');
    expect(sql).toContain('consumed_at IS NULL');
    expect(sql).toContain('revoked_at IS NULL');
    expect(sql).toContain('expires_at > UTC_TIMESTAMP');
    expect(params).toEqual([hashToken('A'.repeat(43)), 'reset_password']);
  });

  it('consumes only one still-valid token', async () => {
    const executor = {
      execute: vi.fn()
        .mockResolvedValueOnce([{ affectedRows: 1 }, []])
        .mockResolvedValueOnce([{ affectedRows: 0 }, []]),
    };

    await expect(consumeAccountActionToken(executor, 'token-row-1')).resolves.toBe(true);
    await expect(consumeAccountActionToken(executor, 'token-row-1')).resolves.toBe(false);
    expect(executor.execute.mock.calls[0]?.[0]).toContain('consumed_at IS NULL');
    expect(executor.execute.mock.calls[0]?.[0]).toContain('expires_at > UTC_TIMESTAMP');
  });

  it('revokes only outstanding tokens for the specified user and purpose', async () => {
    const executor = { execute: vi.fn().mockResolvedValue([{ affectedRows: 2 }, []]) };

    await expect(
      revokeAccountActionTokens(executor, 'user-123', 'verify_email'),
    ).resolves.toBe(2);
    expect(executor.execute).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE auth_action_tokens'),
      ['user-123', 'verify_email'],
    );
  });
});
