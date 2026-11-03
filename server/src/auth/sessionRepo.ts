import type { RowDataPacket } from "mysql2/promise";
import { randomUUID } from "node:crypto";
import { isUtcExpired, isWithinIdleWindow, parseUtcDateTime } from "./time.js";
import { generateToken, hashToken } from "./tokens.js";

const PRE_AUTH_TIMEOUT_MS = 15 * 60 * 1000;
const AUTH_IDLE_TIMEOUT_MS = 30 * 60 * 1000;

export interface DbExecutor {
  execute: any;
}

export interface PreAuthSessionRow extends RowDataPacket {
  id: string;
  token_hash: string;
  created_at: string | Date;
  expires_at: string | Date;
  consumed_at: string | Date | null;
  revoked_at: string | Date | null;
}

export interface AuthSessionWithUser {
  session: {
    id: string;
    userId: string;
    lastSeenAt: Date;
    expiresAt: Date;
  };
  user: {
    id: string;
    email: string;
  };
}

export async function createPreAuthSession(executor: DbExecutor) {
  const token = generateToken(32);
  const tokenHash = hashToken(token);
  const id = randomUUID();

  await executor.execute(
    `INSERT INTO auth_pre_sessions (id, token_hash, created_at, expires_at)
     VALUES (?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3) + INTERVAL 15 MINUTE)`,
    [id, tokenHash],
  );

  const expiresAt = new Date(Date.now() + PRE_AUTH_TIMEOUT_MS);
  return { id, token, tokenHash, expiresAt };
}

export async function findPreAuthSession(executor: DbExecutor, token: string) {
  const tokenHash = hashToken(token);
  const [rows] = await (executor.execute as any)(
    `SELECT id, token_hash, created_at, expires_at, consumed_at, revoked_at
     FROM auth_pre_sessions
     WHERE token_hash = ?`,
    [tokenHash],
  );

  if (!rows || rows.length === 0) return null;
  const row = rows[0] as PreAuthSessionRow;
  if (isUtcExpired(row.expires_at)) return null;
  if (row.consumed_at) return null;
  if (row.revoked_at) return null;

  return row;
}

export async function revokePreAuthSession(executor: DbExecutor, sessionId: string) {
  await executor.execute(
    `UPDATE auth_pre_sessions SET revoked_at = UTC_TIMESTAMP(3) WHERE id = ? AND revoked_at IS NULL`,
    [sessionId],
  );
}

export async function consumePreAuthSession(executor: DbExecutor, sessionId: string) {
  const [result] = await executor.execute(
    `UPDATE auth_pre_sessions
     SET consumed_at = UTC_TIMESTAMP(3)
     WHERE id = ? AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at > UTC_TIMESTAMP(3)`,
    [sessionId],
  ) as any;
  return (result?.affectedRows ?? 0) === 1;
}

export async function createAuthSession(executor: DbExecutor, userId: string) {
  const token = generateToken(32);
  const tokenHash = hashToken(token);
  const id = randomUUID();

  await executor.execute(
    `INSERT INTO sessions (id, user_id, token_hash, created_at, last_seen_at, expires_at)
     VALUES (?, ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3), UTC_TIMESTAMP(3) + INTERVAL 7 DAY)`,
    [id, userId, tokenHash],
  );

  return { id, token, tokenHash };
}

export async function findActiveAuthSession(executor: DbExecutor, token: string): Promise<AuthSessionWithUser | null> {
  const tokenHash = hashToken(token);
  const now = new Date();

  const [rows] = await executor.execute(
    `SELECT s.id, s.user_id, s.last_seen_at, s.expires_at, u.id as user_id2, u.email
     FROM sessions s
     JOIN users u ON u.id = s.user_id AND u.email_verified_at IS NOT NULL
     WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > UTC_TIMESTAMP(3)`,
    [tokenHash],
  ) as any;

  if (!rows || rows.length === 0) return null;
  const row = rows[0];
  const lastSeenAt = parseUtcDateTime(row.last_seen_at);
  const expiresAt = parseUtcDateTime(row.expires_at);

  if (isUtcExpired(expiresAt, now)) return null;
  if (!isWithinIdleWindow(lastSeenAt, AUTH_IDLE_TIMEOUT_MS, now)) return null;

  return {
    session: {
      id: row.id,
      userId: row.user_id,
      lastSeenAt,
      expiresAt,
    },
    user: {
      id: row.user_id2 || row.user_id,
      email: row.email,
    },
  };
}

export async function revokeAuthSession(executor: DbExecutor, sessionId: string) {
  await executor.execute(
    `UPDATE sessions SET revoked_at = UTC_TIMESTAMP(3) WHERE id = ? AND revoked_at IS NULL`,
    [sessionId],
  );
}

export async function touchAuthSession(executor: DbExecutor, sessionId: string): Promise<boolean> {
  const [result] = await executor.execute(
    `UPDATE sessions SET last_seen_at = UTC_TIMESTAMP(3) WHERE id = ? AND revoked_at IS NULL AND expires_at > UTC_TIMESTAMP(3)`,
    [sessionId],
  ) as any;

  // MySQL may report zero changed rows when last_seen_at already equals the
  // current millisecond. Distinguish that no-op from a revoked, expired, or
  // missing session with a read-only check instead of parsing driver text.
  if ((result?.affectedRows ?? 0) > 0) return true;

  const [rows] = await executor.execute(
    `SELECT 1 AS active
     FROM sessions
     WHERE id = ? AND revoked_at IS NULL AND expires_at > UTC_TIMESTAMP(3)
     LIMIT 1`,
    [sessionId],
  ) as any;

  return Array.isArray(rows) && rows.length > 0;
}
