import { describe, expect, it } from 'vitest';
import { isValidToken } from '../auth/tokens.js';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';

describe('token validation', () => {
  it('accepts valid 32-byte base64url token', () => {
    const buf = Buffer.alloc(32, 1);
    const token = buf.toString('base64url');
    expect(isValidToken(token)).toBe(true);
  });
  it('rejects incorrect length', () => expect(isValidToken('abc')).toBe(false));
  it('rejects invalid characters', () => expect(isValidToken('!'.repeat(43))).toBe(false));
  it('rejects padded token', () => expect(isValidToken('A'.repeat(42) + '=')).toBe(false));
  it('rejects non-canonical encoding', () => {
    const buf = Buffer.alloc(32, 1);
    const canonical = buf.toString('base64url');
    let nonCanonical = canonical;
    for (const ch of ALPHABET) {
      const candidate = canonical.slice(0, -1) + ch;
      if (candidate !== canonical && Buffer.from(candidate, 'base64url').equals(buf)) {
        nonCanonical = candidate;
        break;
      }
    }
    expect(nonCanonical).not.toBe(canonical);
    expect(isValidToken(nonCanonical)).toBe(false);
  });
});
