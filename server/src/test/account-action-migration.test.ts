import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  new URL('../../database/migrations/003_email_verification_password_reset.sql', import.meta.url),
  'utf8',
);

describe('email verification and password reset migration', () => {
  it('adds nullable verification state without rewriting existing accounts', () => {
    expect(sql).toMatch(/ALTER TABLE users[\s\S]*ADD COLUMN email_verified_at DATETIME\(3\) NULL/i);
    expect(sql).not.toMatch(/UPDATE users/i);
    expect(sql).not.toMatch(/DROP TABLE|DROP COLUMN|TRUNCATE/i);
  });

  it('creates purpose-bound token storage with hashed token uniqueness and user cascade', () => {
    expect(sql).toContain('CREATE TABLE auth_action_tokens');
    expect(sql).toContain('token_hash CHAR(64)');
    expect(sql).toContain('UNIQUE KEY uq_auth_action_tokens_hash (token_hash)');
    expect(sql).toContain('FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE');
    expect(sql).toContain("CHECK (purpose IN ('verify_email', 'reset_password'))");
    expect(sql).toContain('consumed_at DATETIME(3) NULL');
    expect(sql).toContain('revoked_at DATETIME(3) NULL');
  });
});
