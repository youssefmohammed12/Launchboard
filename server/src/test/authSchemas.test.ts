import { describe, expect, it } from 'vitest';
import { loginSchema, registerSchema } from '../validation/authSchemas.js';

describe('authentication email normalization', () => {
  it('normalizes login identifiers by trimming and lowercasing', () => {
    const result = loginSchema.parse({
      email: '  Youssef.Example@EXAMPLE.TEST  ',
      password: 'existing password',
    });

    expect(result.email).toBe('youssef.example@example.test');
  });

  it('uses the same normalized identifier for registration', () => {
    const result = registerSchema.parse({
      email: '  New.User@Example.Test ',
      password: 'a sufficiently long registration password',
    });

    expect(result.email).toBe('new.user@example.test');
  });

  it.each(['', 'not-an-email', 'missing-domain@', '@missing-local.test'])(
    'rejects invalid email identifiers: %s',
    (email) => {
      expect(
        loginSchema.safeParse({ email, password: 'password' }).success,
      ).toBe(false);
    },
  );

  it('rejects extra fields instead of silently accepting them', () => {
    expect(
      loginSchema.safeParse({
        email: 'person@example.test',
        password: 'password',
        unexpected: true,
      }).success,
    ).toBe(false);
  });
});
