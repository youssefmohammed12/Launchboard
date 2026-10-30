import type { Opportunity } from './opportunity.js';

/**
 * The versioned JSON backup envelope. This is a shared contract: the browser
 * writes and reads it, and the future API must accept and produce exactly the
 * same shape.
 */
export const BACKUP_FORMAT = 'launchboard-backup';
export const BACKUP_SCHEMA_VERSION = 1;

export interface LaunchboardBackup {
  format: typeof BACKUP_FORMAT;
  schemaVersion: number;
  exportedAt: string;
  opportunities: Opportunity[];
}
