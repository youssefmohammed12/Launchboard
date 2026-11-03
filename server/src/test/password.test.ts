import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword, isCurrentArgon2Params } from '../auth/password.js';
import { validateRegistrationPassword, validateLoginPassword, countCodePoints, utf8ByteLength, hasUnpairedSurrogate } from '../auth/passwordPolicy.js';

describe('passwordPolicy', () => {
  it('min boundary', () => {
    expect(validateRegistrationPassword('a'.repeat(15)).ok).toBe(true);
    expect(validateRegistrationPassword('a'.repeat(14)).ok).toBe(false);
  });
  it('max code points', () => {
    expect(validateRegistrationPassword('a'.repeat(128)).ok).toBe(true);
    expect(validateRegistrationPassword('a'.repeat(129)).ok).toBe(false);
  });
  it('unicode/emoji', () => {
    expect(countCodePoints('😀'.repeat(15))).toBe(15);
    expect(validateRegistrationPassword('😀'.repeat(15)).ok).toBe(true);
  });
  it('login no min', () => {
    expect(validateLoginPassword('short').ok).toBe(true);
  });
  it('byte cap', () => {
    const big = '😀'.repeat(300);
    expect(utf8ByteLength(big)).toBeGreaterThan(1024);
    expect(validateRegistrationPassword(big).ok).toBe(false);
  });
  it('rejects unpaired high surrogate', () => {
    const bad = '\ud800'.repeat(15);
    expect(hasUnpairedSurrogate(bad)).toBe(true);
    expect(validateRegistrationPassword(bad).ok).toBe(false);
    expect(validateLoginPassword(bad).ok).toBe(false);
  });
  it('rejects unpaired low surrogate', () => {
    const bad = '\udc00'.repeat(15);
    expect(hasUnpairedSurrogate(bad)).toBe(true);
    expect(validateRegistrationPassword(bad).ok).toBe(false);
    expect(validateLoginPassword(bad).ok).toBe(false);
  });
  it('preserves exact string (no trim/lowercase/normalize)', () => {
    const pwd = '  AbCdEfGhIjKlMn  ';
    // length with spaces is 18 code points
    expect([...pwd].length).toBe(18);
    expect(countCodePoints(pwd)).toBe(18);
    expect(validateRegistrationPassword(pwd).ok).toBe(true);
  });
});

describe('argon2', () => {
  it('hash/verify', async () => {
    const h = await hashPassword('a'.repeat(15));
    expect(h.startsWith('$argon2id$')).toBe(true);
    expect(h.length).toBeLessThanOrEqual(255);
    expect(await verifyPassword('a'.repeat(15), h)).toBe(true);
    expect(await verifyPassword('wrong', h)).toBe(false);
    expect(isCurrentArgon2Params(h)).toBe(true);
  });
  it('unique salts', async () => {
    const h1 = await hashPassword('a'.repeat(15));
    const h2 = await hashPassword('a'.repeat(15));
    expect(h1).not.toBe(h2);
  });
  it('malformed hash', async () => {
    expect(await verifyPassword('x', 'not-a-hash')).toBe(false);
  });
});
