-- 001_initial_schema.sql
--
-- Initial Launchboard relational schema.
-- Target: MariaDB 10.4+ / MySQL 8.0.16+ (CHECK constraints are enforced).
-- All statements are executed individually by the migration runner; this file
-- is never sent with multipleStatements enabled.
--
-- TEXT and MEDIUMTEXT columns intentionally have no SQL defaults. The
-- application supplies the canonical empty string for optional text, keeping
-- the DDL portable across MariaDB and MySQL versions.
--
-- User-entered calendar values use DATE. Interview times use TIME. Audit and
-- archive instants use DATETIME(3) and are written in UTC.

CREATE TABLE users (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  email VARCHAR(254) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  opportunity_revision BIGINT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE sessions (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL,
  last_seen_at DATETIME(3) NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  revoked_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_sessions_token_hash (token_hash),
  KEY idx_sessions_user_id (user_id),
  KEY idx_sessions_expires_at (expires_at),
  CONSTRAINT fk_sessions_user
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Created before opportunities so opportunities.deleted_batch_id can reference
-- an existing table without a circular creation dependency.
CREATE TABLE opportunity_deletions (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  restored_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  KEY idx_opportunity_deletions_user_expiry (user_id, expires_at),
  CONSTRAINT fk_opportunity_deletions_user
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE opportunities (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  public_id VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `position` INT UNSIGNED NOT NULL,
  title TEXT NOT NULL,
  company TEXT NOT NULL,
  `type` VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `status` VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `priority` VARCHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'Medium',
  `url` TEXT NOT NULL,
  deadline DATE NULL,
  follow_up_date DATE NULL,
  compensation TEXT NOT NULL,
  description MEDIUMTEXT NOT NULL,
  notes MEDIUMTEXT NOT NULL,
  archived_at DATETIME(3) NULL,
  is_demo TINYINT(1) NOT NULL DEFAULT 0,
  `version` INT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  deleted_at DATETIME(3) NULL,
  deleted_batch_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_opportunities_user_public_id (user_id, public_id),
  KEY idx_opportunities_user_order (user_id, deleted_at, `position`, public_id),
  KEY idx_opportunities_user_archive (user_id, deleted_at, archived_at),
  KEY idx_opportunities_deleted_batch (deleted_batch_id),
  CONSTRAINT fk_opportunities_user
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_opportunities_deleted_batch
    FOREIGN KEY (deleted_batch_id) REFERENCES opportunity_deletions (id) ON DELETE SET NULL,
  CONSTRAINT chk_opportunities_type
    CHECK (`type` IN ('Internship', 'Full-time', 'Part-time', 'Freelance')),
  CONSTRAINT chk_opportunities_status
    CHECK (`status` IN ('Saved', 'Applied', 'Interview', 'Offer', 'Rejected')),
  CONSTRAINT chk_opportunities_priority
    CHECK (`priority` IN ('Low', 'Medium', 'High')),
  CONSTRAINT chk_opportunities_version CHECK (`version` >= 1),
  CONSTRAINT chk_opportunities_is_demo CHECK (is_demo IN (0, 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE opportunity_tags (
  opportunity_id BIGINT UNSIGNED NOT NULL,
  tag VARCHAR(24) NOT NULL,
  tag_key VARCHAR(24) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `position` TINYINT UNSIGNED NOT NULL,
  PRIMARY KEY (opportunity_id, tag_key),
  UNIQUE KEY uq_opportunity_tags_position (opportunity_id, `position`),
  CONSTRAINT fk_opportunity_tags_opportunity
    FOREIGN KEY (opportunity_id) REFERENCES opportunities (id) ON DELETE CASCADE,
  CONSTRAINT chk_opportunity_tags_position CHECK (`position` BETWEEN 0 AND 9)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE contacts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  opportunity_id BIGINT UNSIGNED NOT NULL,
  public_id VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `position` TINYINT UNSIGNED NOT NULL,
  `name` VARCHAR(120) NOT NULL,
  `role` VARCHAR(120) NOT NULL DEFAULT '',
  email VARCHAR(254) NOT NULL DEFAULT '',
  phone VARCHAR(40) NOT NULL DEFAULT '',
  website VARCHAR(2048) NOT NULL DEFAULT '',
  notes TEXT NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_contacts_opportunity_public_id (opportunity_id, public_id),
  UNIQUE KEY uq_contacts_opportunity_position (opportunity_id, `position`),
  KEY idx_contacts_opportunity (opportunity_id),
  CONSTRAINT fk_contacts_opportunity
    FOREIGN KEY (opportunity_id) REFERENCES opportunities (id) ON DELETE CASCADE,
  CONSTRAINT chk_contacts_position CHECK (`position` BETWEEN 0 AND 24)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE interviews (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  opportunity_id BIGINT UNSIGNED NOT NULL,
  public_id VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `position` TINYINT UNSIGNED NOT NULL,
  `round` VARCHAR(80) NOT NULL,
  `date` DATE NOT NULL,
  `time` TIME NULL,
  `mode` VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `status` VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `outcome` VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NULL,
  meeting_url VARCHAR(2048) NOT NULL DEFAULT '',
  location VARCHAR(160) NOT NULL DEFAULT '',
  preparation_notes TEXT NOT NULL,
  notes TEXT NOT NULL,
  contact_public_id VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_interviews_opportunity_public_id (opportunity_id, public_id),
  UNIQUE KEY uq_interviews_opportunity_position (opportunity_id, `position`),
  KEY idx_interviews_contact (opportunity_id, contact_public_id),
  CONSTRAINT fk_interviews_opportunity
    FOREIGN KEY (opportunity_id) REFERENCES opportunities (id) ON DELETE CASCADE,
  CONSTRAINT fk_interviews_contact
    FOREIGN KEY (opportunity_id, contact_public_id)
    REFERENCES contacts (opportunity_id, public_id) ON DELETE RESTRICT,
  CONSTRAINT chk_interviews_position CHECK (`position` BETWEEN 0 AND 24),
  CONSTRAINT chk_interviews_mode
    CHECK (`mode` IN ('Phone', 'Video', 'In person', 'Assessment', 'Other')),
  CONSTRAINT chk_interviews_status
    CHECK (`status` IN ('Scheduled', 'Completed', 'Cancelled')),
  CONSTRAINT chk_interviews_outcome
    CHECK (`outcome` IS NULL OR `outcome` IN ('Positive', 'Negative', 'No decision'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE materials (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  opportunity_id BIGINT UNSIGNED NOT NULL,
  public_id VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `position` TINYINT UNSIGNED NOT NULL,
  label VARCHAR(120) NOT NULL,
  `kind` VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `url` VARCHAR(2048) NOT NULL DEFAULT '',
  `version` VARCHAR(80) NOT NULL DEFAULT '',
  `status` VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  notes TEXT NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_materials_opportunity_public_id (opportunity_id, public_id),
  UNIQUE KEY uq_materials_opportunity_position (opportunity_id, `position`),
  KEY idx_materials_opportunity (opportunity_id),
  CONSTRAINT fk_materials_opportunity
    FOREIGN KEY (opportunity_id) REFERENCES opportunities (id) ON DELETE CASCADE,
  CONSTRAINT chk_materials_position CHECK (`position` BETWEEN 0 AND 24),
  CONSTRAINT chk_materials_kind
    CHECK (`kind` IN ('Resume', 'Cover Letter', 'Portfolio', 'Assessment', 'Other')),
  CONSTRAINT chk_materials_status
    CHECK (`status` IN ('Draft', 'Ready', 'Submitted', 'Superseded'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE activities (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  opportunity_id BIGINT UNSIGNED NOT NULL,
  public_id VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `position` INT UNSIGNED NOT NULL,
  `type` VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `date` DATE NOT NULL,
  note TEXT NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_activities_opportunity_public_id (opportunity_id, public_id),
  UNIQUE KEY uq_activities_opportunity_position (opportunity_id, `position`),
  KEY idx_activities_opportunity_date_position (opportunity_id, `date`, `position`),
  CONSTRAINT fk_activities_opportunity
    FOREIGN KEY (opportunity_id) REFERENCES opportunities (id) ON DELETE CASCADE,
  CONSTRAINT chk_activities_type
    CHECK (`type` IN (
      'Application submitted',
      'Recruiter contacted',
      'Interview scheduled',
      'Interview completed',
      'Follow-up sent',
      'Other',
      'Status changed'
    ))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
