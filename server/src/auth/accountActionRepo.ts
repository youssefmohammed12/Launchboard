import { randomUUID } from 'node:crypto';
import type { DbExecutor } from './sessionRepo.js';
import { generateToken, hashToken, isValidToken } from './tokens.js';

export const ACCOUNT_ACTION_PURPOSES = ['verify_email', 'reset_password'] as const;
export type AccountActionPurpose = (typeof ACCOUNT_ACTION_PURPOSES)[number];

export interface AccountActionTokenRow {
  id: string;
  user_id: string;
  purpose: AccountActionPurpose;
  token_hash: string;
  expires_at: string | Date;
  consumed_at: string | Date | null;
  revoked_at: string | Date | null;
}

/** Replaces outstanding links for the same user/purpose and stores only the token hash. */
export async function createAccountActionToken(
  executor: DbExecutor,
  userId: string,
  purpose: AccountActionPurpose,
  expiresInMinutes: number,
): Promise<{ id: string; token: string; tokenHash: string }> {
  if (!Number.isInteger(expiresInMinutes) || expiresInMinutes < 1 || expiresInMinutes > 10_080) {
    throw new RangeError('Token expiry must be between 1 and 10080 minutes.');
  }

  const id = randomUUID();
  const token = generateToken(32);
  const tokenHash = hashToken(token);

  await executor.execute(
    `UPDATE auth_action_tokens
     SET revoked_at = UTC_TIMESTAMP(3)
     WHERE user_id = ? AND purpose = ?
       AND consumed_at IS NULL AND revoked_at IS NULL`,
    [userId, purpose],
  );

  await executor.execute(
    `INSERT INTO auth_action_tokens (
       id, user_id, purpose, token_hash, created_at, expires_at
     ) VALUES (?, ?, ?, ?, UTC_TIMESTAMP(3), DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ? MINUTE))`,
    [id, userId, purpose, tokenHash, expiresInMinutes],
  );

  return { id, token, tokenHash };
}

/** Locks a valid token row inside the caller's transaction. */
export async function findAccountActionTokenForUpdate(
  executor: DbExecutor,
  token: string,
  purpose: AccountActionPurpose,
): Promise<AccountActionTokenRow | null> {
  if (!isValidToken(token)) return null;

  const [rows] = await executor.execute(
    `SELECT id, user_id, purpose, token_hash, expires_at, consumed_at, revoked_at
     FROM auth_action_tokens
     WHERE token_hash = ? AND purpose = ?
       AND consumed_at IS NULL AND revoked_at IS NULL
       AND expires_at > UTC_TIMESTAMP(3)
     LIMIT 1
     FOR UPDATE`,
    [hashToken(token), purpose],
  ) as any;

  return Array.isArray(rows) && rows.length > 0
    ? rows[0] as AccountActionTokenRow
    : null;
}

/** Conditional update closes the race between concurrent token consumers. */
export async function consumeAccountActionToken(
  executor: DbExecutor,
  tokenId: string,
): Promise<boolean> {
  const [result] = await executor.execute(
    `UPDATE auth_action_tokens
     SET consumed_at = UTC_TIMESTAMP(3)
     WHERE id = ? AND consumed_at IS NULL AND revoked_at IS NULL
       AND expires_at > UTC_TIMESTAMP(3)`,
    [tokenId],
  ) as any;

  return (result?.affectedRows ?? 0) === 1;
}

export async function revokeAccountActionTokens(
  executor: DbExecutor,
  userId: string,
  purpose: AccountActionPurpose,
): Promise<number> {
  const [result] = await executor.execute(
    `UPDATE auth_action_tokens
     SET revoked_at = UTC_TIMESTAMP(3)
     WHERE user_id = ? AND purpose = ?
       AND consumed_at IS NULL AND revoked_at IS NULL`,
    [userId, purpose],
  ) as any;

  return result?.affectedRows ?? 0;
}
