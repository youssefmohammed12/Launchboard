-- 005_opportunity_job_details.sql
--
-- Add structured job facts captured from public posting data.
-- Existing free-text compensation and all existing records are preserved.
-- Target: TiDB Cloud Serverless 8.5.x (MySQL-compatible DDL).
-- TiDB declarative constraint enforcement is disabled by default and requires
-- a cluster-level setting. This migration intentionally does not rely on it:
-- the shared domain normalizer and strict API schemas enforce field enums,
-- salary ranges and the maximum ten ordered locations.
-- This migration is additive and must be applied through the normal migration
-- runner only after the target schema and backup have been verified.

ALTER TABLE opportunities
  ADD COLUMN department VARCHAR(160) NOT NULL DEFAULT '',
  ADD COLUMN team VARCHAR(160) NOT NULL DEFAULT '',
  ADD COLUMN workplace_type VARCHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT '',
  ADD COLUMN employment_type VARCHAR(80) NOT NULL DEFAULT '',
  ADD COLUMN posted_date DATE NULL,
  ADD COLUMN compensation_min DECIMAL(18,4) NULL,
  ADD COLUMN compensation_max DECIMAL(18,4) NULL,
  ADD COLUMN compensation_currency CHAR(3) CHARACTER SET ascii COLLATE ascii_bin NULL,
  ADD COLUMN compensation_interval VARCHAR(10) CHARACTER SET ascii COLLATE ascii_bin NULL;

CREATE TABLE opportunity_locations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  opportunity_id BIGINT UNSIGNED NOT NULL,
  `position` TINYINT UNSIGNED NOT NULL,
  location VARCHAR(160) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_opportunity_locations_position (opportunity_id, `position`),
  KEY idx_opportunity_locations_parent (opportunity_id),
  CONSTRAINT fk_opportunity_locations_opportunity
    FOREIGN KEY (opportunity_id) REFERENCES opportunities (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
