-- Launchboard database account provisioning template.
--
-- WARNING: This file contains placeholders, not usable credentials. Replace both
-- password placeholders with strong operator-generated values before running.
-- Do not commit an edited copy containing real passwords.
--
-- Run this ONCE, deliberately, as a database administrator after
-- create-database.sql has created the dedicated `launchboard` database.
-- This file does not create or drop any database, does not grant global
-- privileges, does not use GRANT OPTION, and only targets launchboard.*.
--
-- The host `127.0.0.1` matches the default DB_HOST used by the application.
-- If you configure a different DB_HOST, change both account hosts to match.
--
-- The application never executes this file. It is an operator action.

CREATE USER 'launchboard_app'@'127.0.0.1'
  IDENTIFIED BY '<REPLACE_WITH_RUNTIME_PASSWORD>';
GRANT SELECT, INSERT, UPDATE, DELETE
  ON launchboard.* TO 'launchboard_app'@'127.0.0.1';

CREATE USER 'launchboard_migrator'@'127.0.0.1'
  IDENTIFIED BY '<REPLACE_WITH_MIGRATION_PASSWORD>';
GRANT CREATE, ALTER, INDEX, REFERENCES, SELECT, INSERT
  ON launchboard.* TO 'launchboard_migrator'@'127.0.0.1';

-- Optional verification, run as an administrator:
-- SHOW GRANTS FOR 'launchboard_app'@'127.0.0.1';
-- SHOW GRANTS FOR 'launchboard_migrator'@'127.0.0.1';
