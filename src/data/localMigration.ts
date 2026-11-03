import {
  BACKUP_FORMAT,
  BACKUP_SCHEMA_VERSION,
  MAX_BACKUP_BYTES,
  type LaunchboardBackup,
} from '@launchboard/domain';
import type { Opportunity } from '../types/opportunity';
import { createJsonBackup } from '../utils/exports';
import { parseBackupJson } from '../utils/backup';
import {
  httpOpportunityRepository,
  type BackupImportResult,
  type OpportunityCollection,
} from './httpOpportunityRepository';

export const LOCAL_MIGRATION_KEY_PREFIX = 'launchboard.server-migration.v1.';

export interface LocalMigrationMarker {
  schemaVersion: 1;
  userId: string;
  completedAt: string;
  mode: 'merge' | 'replace';
  localRecordCount: number;
  serverRecordCount: number;
  serverRevision: number;
}

export interface MigrationRepository {
  load: (archived?: 'active' | 'archived' | 'all') => Promise<OpportunityCollection>;
  importBackup: (input: {
    mode: 'merge' | 'replace';
    backup: LaunchboardBackup;
    dryRun?: boolean;
    confirmReplace?: boolean;
    expectedRevision?: number;
  }) => Promise<BackupImportResult>;
}

export interface LocalMigrationPreview {
  userId: string;
  mode: 'merge' | 'replace';
  backup: LaunchboardBackup;
  expectedRevision: number;
  localRecordCount: number;
  serverRecordCount: number;
  result: BackupImportResult;
}

export interface LocalMigrationCompletion {
  importResult: BackupImportResult;
  collection: OpportunityCollection;
  marker: LocalMigrationMarker;
}

export type MigrationErrorCode =
  | 'INVALID_LOCAL_BACKUP'
  | 'DRY_RUN_NOT_CONFIRMED'
  | 'IMPORT_NOT_APPLIED'
  | 'STALE_PREVIEW'
  | 'IMPORT_SUCCEEDED_RELOAD_FAILED'
  | 'MIGRATION_MARKER_FAILED';

export class LocalMigrationError extends Error {
  readonly code: MigrationErrorCode;
  readonly importResult?: BackupImportResult;
  readonly collection?: OpportunityCollection;

  constructor(
    code: MigrationErrorCode,
    message: string,
    importResult?: BackupImportResult,
    collection?: OpportunityCollection,
  ) {
    super(message);
    this.name = 'LocalMigrationError';
    this.code = code;
    this.importResult = importResult;
    this.collection = collection;
  }
}

function migrationKey(userId: string): string {
  return `${LOCAL_MIGRATION_KEY_PREFIX}${encodeURIComponent(userId)}`;
}

/** Reads only this account's migration marker; opportunity/recovery keys are untouched. */
export function getLocalMigrationMarker(userId: string): LocalMigrationMarker | null {
  try {
    const raw = localStorage.getItem(migrationKey(userId));
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
    const marker = value as Record<string, unknown>;
    if (
      marker.schemaVersion !== 1 ||
      marker.userId !== userId ||
      (marker.mode !== 'merge' && marker.mode !== 'replace') ||
      typeof marker.completedAt !== 'string' ||
      !Number.isSafeInteger(marker.localRecordCount) ||
      !Number.isSafeInteger(marker.serverRecordCount) ||
      !Number.isSafeInteger(marker.serverRevision)
    ) {
      return null;
    }
    if (
      (marker.localRecordCount as number) < 0 ||
      (marker.serverRecordCount as number) < 0 ||
      (marker.serverRevision as number) < 0
    ) {
      return null;
    }
    return marker as unknown as LocalMigrationMarker;
  } catch {
    return null;
  }
}

function saveMigrationMarker(marker: LocalMigrationMarker): boolean {
  try {
    const key = migrationKey(marker.userId);
    const raw = JSON.stringify(marker);
    localStorage.setItem(key, raw);
    return localStorage.getItem(key) === raw;
  } catch {
    return false;
  }
}

/**
 * Builds the server-compatible v1 backup from the local snapshot and runs its
 * records through the shared domain normalizer via the browser file parser.
 */
function createNormalizedBackup(items: Opportunity[]): LaunchboardBackup {
  let raw: string;
  try {
    raw = createJsonBackup(items);
  } catch {
    throw new LocalMigrationError(
      'INVALID_LOCAL_BACKUP',
      'The local records could not be prepared as a safety backup. No data was changed.',
    );
  }

  if (new TextEncoder().encode(raw).byteLength > MAX_BACKUP_BYTES) {
    throw new LocalMigrationError(
      'INVALID_LOCAL_BACKUP',
      'The local backup exceeds the 5 MiB migration limit. Download a backup and reduce its size before migrating.',
    );
  }

  const parsed = parseBackupJson(raw);
  if (!parsed.ok) {
    throw new LocalMigrationError(
      'INVALID_LOCAL_BACKUP',
      parsed.error.message,
    );
  }

  if (parsed.backup.invalidRecords > 0 || parsed.backup.duplicateRecords > 0) {
    throw new LocalMigrationError(
      'INVALID_LOCAL_BACKUP',
      'Some local records could not be safely normalized. Nothing was migrated; review the local recovery notice and create a clean backup first.',
    );
  }

  let envelope: unknown;
  try {
    envelope = JSON.parse(raw);
  } catch {
    throw new LocalMigrationError(
      'INVALID_LOCAL_BACKUP',
      'The local backup could not be read. No data was changed.',
    );
  }
  if (typeof envelope !== 'object' || envelope === null || Array.isArray(envelope)) {
    throw new LocalMigrationError(
      'INVALID_LOCAL_BACKUP',
      'The local backup envelope is invalid. No data was changed.',
    );
  }

  const base = envelope as Record<string, unknown>;
  return {
    format: BACKUP_FORMAT,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: typeof base.exportedAt === 'string' ? base.exportedAt : new Date().toISOString(),
    opportunities: parsed.backup.records,
  };
}

/**
 * Previews migration without writes. Replace previews are guarded by the
 * collection revision read immediately before the dry-run.
 */
export async function previewLocalMigration(
  userId: string,
  localItems: Opportunity[],
  mode: 'merge' | 'replace',
  repository: MigrationRepository = httpOpportunityRepository,
): Promise<LocalMigrationPreview> {
  if (!userId.trim()) {
    throw new LocalMigrationError('INVALID_LOCAL_BACKUP', 'A signed-in account is required.');
  }

  const backup = createNormalizedBackup(localItems);
  const server = await repository.load('all');
  const result = await repository.importBackup({
    mode,
    backup,
    dryRun: true,
    ...(mode === 'replace'
      ? { confirmReplace: true, expectedRevision: server.revision }
      : {}),
  });
  if (result.dryRun !== true || result.mode !== mode) {
    throw new LocalMigrationError(
      'DRY_RUN_NOT_CONFIRMED',
      'The server did not confirm a non-mutating preview. No migration was started; try again after checking the server.',
    );
  }

  return {
    userId,
    mode,
    backup,
    expectedRevision: server.revision,
    localRecordCount: backup.opportunities.length,
    serverRecordCount: server.items.length,
    result,
  };
}

/**
 * Reloads the authoritative server collection after a confirmed import and
 * writes the account-scoped marker only after that reload succeeds.
 *
 * This exported finalization step lets the UI retry a failed reload or marker
 * write without re-running a destructive replace request.
 */
export async function finalizeLocalMigration(
  preview: LocalMigrationPreview,
  importResult: BackupImportResult,
  repository: MigrationRepository = httpOpportunityRepository,
): Promise<LocalMigrationCompletion> {
  if (importResult.dryRun !== false || importResult.mode !== preview.mode) {
    throw new LocalMigrationError(
      'IMPORT_NOT_APPLIED',
      'The server did not confirm that the migration was applied.',
      importResult,
    );
  }

  let collection: OpportunityCollection;
  try {
    collection = await repository.load('all');
  } catch {
    throw new LocalMigrationError(
      'IMPORT_SUCCEEDED_RELOAD_FAILED',
      preview.mode === 'merge'
        ? 'The server accepted the import, but Launchboard could not reload the server records. Your local data is still preserved. Retry the server reload before treating migration as complete.'
        : 'The server accepted the replacement, but Launchboard could not reload the server records. Your local data is still preserved. Retry the server reload and review it before another replacement.',
      importResult,
    );
  }

  const marker: LocalMigrationMarker = {
    schemaVersion: 1,
    userId: preview.userId,
    completedAt: new Date().toISOString(),
    mode: preview.mode,
    localRecordCount: preview.localRecordCount,
    serverRecordCount: collection.items.length,
    serverRevision: collection.revision,
  };

  if (!saveMigrationMarker(marker)) {
    throw new LocalMigrationError(
      'MIGRATION_MARKER_FAILED',
      'The server records were reloaded successfully, but this browser could not save the migration-complete marker. Your local data remains untouched; retry marking completion.',
      importResult,
      collection,
    );
  }

  return { importResult, collection, marker };
}

/**
 * Applies an explicitly previewed migration and delegates to the separate
 * reload/marker step. Local opportunity and raw recovery keys are never changed.
 */
export async function completeLocalMigration(
  preview: LocalMigrationPreview,
  repository: MigrationRepository = httpOpportunityRepository,
): Promise<LocalMigrationCompletion> {
  if (
    preview.result.dryRun !== true ||
    preview.result.mode !== preview.mode ||
    (preview.expectedRevision !== preview.result.revision && preview.mode === 'replace')
  ) {
    throw new LocalMigrationError(
      'STALE_PREVIEW',
      'This migration preview is incomplete or no longer valid. Run a new preview before importing.',
    );
  }

  const input = {
    mode: preview.mode,
    backup: preview.backup,
    ...(preview.mode === 'replace'
      ? { confirmReplace: true, expectedRevision: preview.expectedRevision }
      : {}),
  } as const;

  const importResult = await repository.importBackup(input);
  return finalizeLocalMigration(preview, importResult, repository);
}
