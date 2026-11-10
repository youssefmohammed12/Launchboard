-- 006_account_profile.sql
--
-- Add a user-controlled display name for account settings.
-- Existing accounts keep an empty display name and can populate it later.
-- This is additive and does not change authentication identifiers.

ALTER TABLE users
  ADD COLUMN display_name VARCHAR(80) NOT NULL DEFAULT '' AFTER email;
