-- 002_auth_pre_sessions.sql
--
-- Additive migration for anonymous pre-authentication sessions.
-- Does not modify existing tables. No csrf_token_hash columns added (HMAC-derived).

CREATE TABLE auth_pre_sessions (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  consumed_at DATETIME(3) NULL,
  revoked_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_auth_pre_sessions_token_hash (token_hash),
  KEY idx_auth_pre_sessions_expires_at (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;