import { randomBytes, createHash } from 'node:crypto';

export const SESSION_TOKEN_BYTES = 32;
export const PRE_AUTH_TOKEN_BYTES = 32;

export function generateToken(bytes = SESSION_TOKEN_BYTES): string {
  return randomBytes(bytes).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function isValidToken(token: string): boolean {
  if (typeof token !== 'string' || token.length !== 43) return false;
  if (!/^[A-Za-z0-9_-]+$/.test(token)) return false;
  let buffer: Buffer;
  try {
    buffer = Buffer.from(token, 'base64url');
  } catch {
    return false;
  }
  if (buffer.length !== SESSION_TOKEN_BYTES) return false;
  return buffer.toString('base64url') === token;
}
