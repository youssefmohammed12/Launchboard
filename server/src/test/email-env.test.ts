import { describe, expect, it } from 'vitest';
import { EnvValidationError, parseEmailEnv } from '../config/env.js';

const valid = {
  NODE_ENV: 'production',
  SMTP_USER: 'launchboard.notifications@gmail.com',
  SMTP_PASS: 'abcdEFGH12345678',
  APP_BASE_URL: 'https://launchboard-drab.vercel.app',
};

describe('parseEmailEnv', () => {
  it('returns null when no email-delivery settings are configured', () => {
    expect(parseEmailEnv({})).toBeNull();
  });

  it('accepts a complete production Gmail SMTP configuration', () => {
    expect(parseEmailEnv(valid)).toEqual({
      smtpUser: valid.SMTP_USER,
      smtpPassword: valid.SMTP_PASS,
      appBaseUrl: valid.APP_BASE_URL,
    });
  });

  it('normalizes spaces in the grouped app-password display', () => {
    expect(parseEmailEnv({
      ...valid,
      SMTP_PASS: 'abcd EFGH 1234 5678',
    })?.smtpPassword).toBe(valid.SMTP_PASS);
  });

  it('requires all email settings together', () => {
    expect(() => parseEmailEnv({ SMTP_USER: valid.SMTP_USER })).toThrow(EnvValidationError);
    expect(() => parseEmailEnv({
      SMTP_PASS: valid.SMTP_PASS,
      APP_BASE_URL: valid.APP_BASE_URL,
    })).toThrow(EnvValidationError);
  });

  it('rejects non-Gmail SMTP usernames', () => {
    expect(() => parseEmailEnv({ ...valid, SMTP_USER: 'sender@example.com' })).toThrow(
      EnvValidationError,
    );
  });

  it('rejects invalid Google app-password lengths or characters', () => {
    expect(() => parseEmailEnv({ ...valid, SMTP_PASS: 'too-short' })).toThrow(
      EnvValidationError,
    );
    expect(() => parseEmailEnv({ ...valid, SMTP_PASS: '123456789012345!' })).toThrow(
      EnvValidationError,
    );
  });

  it.each([
    ['non-HTTPS production URL', 'http://launchboard.example'],
    ['path', 'https://launchboard.example/app'],
    ['query', 'https://launchboard.example?next=home'],
    ['fragment', 'https://launchboard.example#section'],
    ['credentials', 'https://user:pass@launchboard.example'],
    ['trailing slash', 'https://launchboard.example/'],
    ['non-canonical host', 'https://LAUNCHBOARD.example'],
  ])('rejects unsafe APP_BASE_URL (%s)', (_label, appBaseUrl) => {
    expect(() => parseEmailEnv({ ...valid, APP_BASE_URL: appBaseUrl })).toThrow(
      EnvValidationError,
    );
  });

  it('allows canonical HTTP localhost only in development', () => {
    expect(parseEmailEnv({
      ...valid,
      NODE_ENV: 'development',
      APP_BASE_URL: 'http://127.0.0.1:5173',
    })?.appBaseUrl).toBe('http://127.0.0.1:5173');
  });

  it('does not include credentials or the sender address in validation errors', () => {
    let caught: unknown;
    try {
      parseEmailEnv({
        NODE_ENV: 'production',
        SMTP_USER: valid.SMTP_USER,
        SMTP_PASS: 'super-secret-password',
        APP_BASE_URL: 'https://launchboard.example/path',
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(EnvValidationError);
    expect((caught as Error).message).not.toContain('super-secret-password');
    expect((caught as Error).message).not.toContain(valid.SMTP_USER);
  });
});
