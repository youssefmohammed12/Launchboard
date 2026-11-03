import { randomUUID } from 'node:crypto';
import { generateToken, hashToken } from './tokens.js';

const ABSOLUTE_TIMEOUT_MS = 7 * 24 * 60 * 60 * 1000;
const PRE_AUTH_TIMEOUT_MS = 15 * 60 * 1000;

export function nowUtc() {
  return new Date();
}

export function createAuthSessionRecord(userId: string) {
  const token = generateToken(32);
  const tokenHash = hashToken(token);
  const createdAt = nowUtc();
  const _lastSeenAt = createdAt;
  const expiresAt = new Date(createdAt.getTime() + ABSOLUTE_TIMEOUT_MS);
  return {
    id: randomUUID(),
    userId,
    token,
    tokenHash,
    createdAt,
    _lastSeenAt,
    expiresAt,
  };
}

export function createPreAuthSessionRecord() {
  const token = generateToken(32);
  const tokenHash = hashToken(token);
  const createdAt = nowUtc();
  const expiresAt = new Date(createdAt.getTime() + PRE_AUTH_TIMEOUT_MS);
  return {
    id: randomUUID(),
    token,
    tokenHash,
    createdAt,
    expiresAt,
  };
}

export function isAuthSessionValid(_lastSeenAt: Date, expiresAt: Date, now = nowUtc()) {
  if (expiresAt.getTime() <= now.getTime()) return false;
}
