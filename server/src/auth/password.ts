import { hash, verify } from '@node-rs/argon2';

export const ARGON2_MEMORY_KIB = 19_456;
export const ARGON2_ITERATIONS = 2;
export const ARGON2_PARALLELISM = 1;
export const ARGON2_OUTPUT_LENGTH = 32;

export const ARGON2_OPTIONS = {
  memoryCost: ARGON2_MEMORY_KIB,
  timeCost: ARGON2_ITERATIONS,
  parallelism: ARGON2_PARALLELISM,
  outputLen: ARGON2_OUTPUT_LENGTH,
  algorithm: 2,
} as const;

export async function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(password: string, encodedHash: string): Promise<boolean> {
  try {
    return await verify(encodedHash, password);
  } catch {
    return false;
  }
}

export function isCurrentArgon2Params(encodedHash: string): boolean {
  const parts = encodedHash.split('$');
  if (parts.length < 4 || parts[1] !== 'argon2id') return false;
  const params = parts[3] ?? '';
  const m = /m=(\d+)/.exec(params);
  const t = /t=(\d+)/.exec(params);
  const p = /p=(\d+)/.exec(params);
  if (!m || !t || !p) return false;
  return (
    Number(m[1]) === ARGON2_MEMORY_KIB &&
    Number(t[1]) === ARGON2_ITERATIONS &&
    Number(p[1]) === ARGON2_PARALLELISM
  );
}
