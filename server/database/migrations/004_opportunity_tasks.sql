-- 004_opportunity_tasks.sql
--
-- Add opportunity-owned tasks for the v1.2 Action Center.
-- Existing opportunities remain valid with an empty task collection.
-- Task records are removed only when their parent opportunity is permanently deleted.

CREATE TABLE tasks (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  opportunity_id BIGINT UNSIGNED NOT NULL,
  public_id VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `position` TINYINT UNSIGNED NOT NULL,
  title VARCHAR(160) NOT NULL,
  notes TEXT NOT NULL,
  priority VARCHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'Medium',
  due_date DATE NULL,
  completed TINYINT(1) NOT NULL DEFAULT 0,
  completed_on DATE NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_tasks_opportunity_public_id (opportunity_id, public_id),
  UNIQUE KEY uq_tasks_opportunity_position (opportunity_id, `position`),
  KEY idx_tasks_opportunity_due (opportunity_id, completed, due_date, `position`),
  CONSTRAINT fk_tasks_opportunity
    FOREIGN KEY (opportunity_id) REFERENCES opportunities (id) ON DELETE CASCADE,
  CONSTRAINT chk_tasks_position CHECK (`position` BETWEEN 0 AND 99),
  CONSTRAINT chk_tasks_priority CHECK (priority IN ('Low', 'Medium', 'High')),
  CONSTRAINT chk_tasks_completed CHECK (completed IN (0, 1)),
  CONSTRAINT chk_tasks_completion_date
    CHECK (
      (completed = 1 AND completed_on IS NOT NULL) OR
      (completed = 0 AND completed_on IS NULL)
    )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
