import { describe, expect, it } from 'vitest';
import { EnvValidationError, parseAuthEnv } from '../config/env.js';

const secretBytes = Buffer.alloc(32, 0x5a);
const validSecret = secretBytes.toString('base64url');

function authEnv(overrides: Record<string, string | undefined> = {}) {
  return {
    CSRF_SECRET: validSecret,
    TRUSTED_ORIGINS: 'http://localhost:5173,https://launchboard.example',
    ...overrides,
  };
}

describe('parseAuthEnv', () => {
  it('returns null when both authentication settings are absent', () => {
    expect(parseAuthEnv({})).toBeNull();
  });

  it('accepts a canonical 32-byte base64url secret and exact HTTP/HTTPS origins', () => {
    expect(parseAuthEnv(authEnv())).toEqual({
      csrfSecret: validSecret,
      trustedOrigins: ['http://localhost:5173', 'https://launchboard.example'],
    });
  });

  it('accepts a secret longer than the 32-byte minimum', () => {
    const longerSecret = Buffer.alloc(48, 0x2a).toString('base64url');
    expect(parseAuthEnv(authEnv({ CSRF_SECRET: longerSecret }))?.csrfSecret).toBe(longerSecret);
  });

  it('requires both authentication settings when either is configured', () => {
    expect(() => parseAuthEnv({ CSRF_SECRET: validSecret })).toThrow(EnvValidationError);
    expect(() => parseAuthEnv({ TRUSTED_ORIGINS: 'https://launchboard.example' })).toThrow(
      EnvValidationError,
    );
  });

  it('rejects secrets shorter than 32 decoded bytes', () => {
    const shortSecret = Buffer.alloc(31, 0x5a).toString('base64url');
    expect(() => parseAuthEnv(authEnv({ CSRF_SECRET: shortSecret }))).toThrow(
      /CSRF_SECRET must be at least 32 bytes/,
    );
  });

  it.each([
    ['padding', `${validSecret}=`],
    ['invalid characters', `${validSecret.slice(0, -1)}!`],
    ['leading whitespace', ` ${validSecret}`],
    ['trailing whitespace', `${validSecret} `],
  ])('rejects non-canonical CSRF_SECRET encoding (%s)', (_label, value) => {
    expect(() => parseAuthEnv(authEnv({ CSRF_SECRET: value }))).toThrow(EnvValidationError);
  });

  it('rejects non-canonical base64url encodings that decode to the same bytes', () => {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
    let nonCanonical = validSecret;

    for (const character of alphabet) {
      const candidate = validSecret.slice(0, -1) + character;
      if (
        candidate !== validSecret &&
        Buffer.from(candidate, 'base64url').equals(secretBytes)
      ) {
        nonCanonical = candidate;
        break;
      }
    }

    expect(nonCanonical).not.toBe(validSecret);
    expect(() => parseAuthEnv(authEnv({ CSRF_SECRET: nonCanonical }))).toThrow(
      /CSRF_SECRET must be canonical unpadded base64url/,
    );
  });

  it.each([
    ['FTP scheme', 'ftp://launchboard.example'],
    ['wildcard hostname', 'https://*.launchboard.example'],
    ['credentials', 'https://user:pass@launchboard.example'],
    ['path', 'https://launchboard.example/app'],
    ['query', 'https://launchboard.example?mode=login'],
    ['fragment', 'https://launchboard.example#section'],
    ['trailing slash', 'https://launchboard.example/'],
    ['explicit default port', 'https://launchboard.example:443'],
    ['non-canonical uppercase host', 'https://LAUNCHBOARD.example'],
  ])('rejects invalid trusted origin (%s)', (_label, origin) => {
    expect(() => parseAuthEnv(authEnv({ TRUSTED_ORIGINS: origin }))).toThrow(
      EnvValidationError,
    );
  });

  it('rejects empty entries in the trusted-origin list', () => {
    expect(() =>
      parseAuthEnv(authEnv({ TRUSTED_ORIGINS: 'https://launchboard.example,,http://localhost:5173' })),
    ).toThrow(/TRUSTED_ORIGINS must contain only non-empty exact origins/);
  });

  it('rejects an empty trusted-origin list', () => {
    expect(() => parseAuthEnv(authEnv({ TRUSTED_ORIGINS: '   ' }))).toThrow(EnvValidationError);
  });

  it('never includes secret or origin values in validation errors', () => {
    const secret = 'not-a-valid-secret-value';
    const origin = 'ftp://private-origin.example';
    let error: unknown;

    try {
      parseAuthEnv({ CSRF_SECRET: secret, TRUSTED_ORIGINS: origin });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(EnvValidationError);
    expect((error as Error).message).not.toContain(secret);
    expect((error as Error).message).not.toContain(origin);
  });
});
