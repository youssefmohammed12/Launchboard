-- Launchboard database bootstrap.
--
-- Run this once, deliberately, as a database administrator. It creates only
-- the dedicated `launchboard` database and does not drop or recreate anything.
-- The application never executes this file automatically.
--
-- The migration runner connects to the already provisioned database and
-- refuses to run unless `SELECT DATABASE()` returns exactly `launchboard`.

CREATE DATABASE IF NOT EXISTS launchboard
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;
