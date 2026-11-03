-- 003_email_verification_password_reset.sql
--
-- Additive account-identity hardening. Existing users remain unverified until
-- they complete email verification; no existing sessions or opportunity rows
-- are removed. Account action tokens are purpose-bound, single-use and stored
-- only as SHA-256 hashes.

ALTER TABLE users
  ADD COLUMN email_verified_at DATETIME(3) NULL AFTER password_hash;

CREATE TABLE auth_action_tokens (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  purpose VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  consumed_at DATETIME(3) NULL,
  revoked_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_auth_action_tokens_hash (token_hash),
  KEY idx_auth_action_tokens_user_purpose (user_id, purpose, expires_at),
  KEY idx_auth_action_tokens_expiry (expires_at),
  CONSTRAINT fk_auth_action_tokens_user
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT chk_auth_action_tokens_purpose
    CHECK (purpose IN ('verify_email', 'reset_password'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
