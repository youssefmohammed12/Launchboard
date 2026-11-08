import type { Opportunity } from './opportunity.js';

/**
 * The versioned JSON backup envelope. This is a shared contract: the browser
 * writes and reads it, and the future API must accept and produce exactly the
 * same shape.
 */
export const BACKUP_FORMAT = 'launchboard-backup';
/** Current full-fidelity JSON backup schema. */
export const BACKUP_SCHEMA_VERSION = 3;
/** Existing v1 and v2 user backups remain importable. */
export const BACKUP_SUPPORTED_SCHEMA_VERSIONS = [1, 2, BACKUP_SCHEMA_VERSION] as const;

export interface LaunchboardBackup {
  format: typeof BACKUP_FORMAT;
  schemaVersion: number;
  exportedAt: string;
  opportunities: Opportunity[];
}
