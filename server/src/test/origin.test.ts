import { describe, expect, it } from 'vitest';
import { isExactOriginAllowed, validateOriginHeader } from '../auth/origin.js';

describe('exact trusted-origin checks', () => {
  it.each([
    ['HTTP origin', 'http://localhost:5173', ['http://localhost:5173']],
    ['HTTPS origin', 'https://launchboard.example', ['https://launchboard.example']],
  ])('allows an exact configured %s', (_label, origin, allowlist) => {
    expect(isExactOriginAllowed(origin, allowlist)).toBe(true);
  });

  it('does not treat a different scheme or port as the same origin', () => {
    expect(isExactOriginAllowed('http://launchboard.example', ['https://launchboard.example'])).toBe(
      false,
    );
    expect(isExactOriginAllowed('http://localhost:5174', ['http://localhost:5173'])).toBe(false);
  });

  it('rejects non-HTTP protocols even if supplied in the allowlist', () => {
    expect(isExactOriginAllowed('ftp://launchboard.example', ['ftp://launchboard.example'])).toBe(
      false,
    );
  });

  it.each([
    'https://user:password@launchboard.example',
    'https://launchboard.example/app',
    'https://launchboard.example?mode=login',
    'https://launchboard.example#section',
    'https://*.launchboard.example',
  ])('rejects non-origin URL forms: %s', (origin) => {
    expect(isExactOriginAllowed(origin, [origin])).toBe(false);
  });

  it('rejects missing and opaque null origins', () => {
    expect(isExactOriginAllowed(undefined, ['https://launchboard.example'])).toBe(false);
    expect(isExactOriginAllowed(null, ['https://launchboard.example'])).toBe(false);
    expect(isExactOriginAllowed('null', ['https://launchboard.example'])).toBe(false);
  });

  it('throws a stable forbidden error for an untrusted Origin header', () => {
    try {
      validateOriginHeader('https://attacker.example', ['https://launchboard.example']);
      throw new Error('Expected validateOriginHeader to reject the origin.');
    } catch (error) {
      expect(error).toMatchObject({ code: 'FORBIDDEN' });
      expect((error as Error).message).toBe('origin not allowed');
    }
  });
});
