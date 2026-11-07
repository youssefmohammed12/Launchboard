import {
  BACKUP_SUPPORTED_SCHEMA_VERSIONS,
  MAX_BACKUP_RECORDS,
  normalizeBackupOpportunityRecord,
  type BackupRecordFailure,
  type LaunchboardBackup,
} from '@launchboard/domain';
import type { Opportunity } from '../types/opportunity';
import { BACKUP_FORMAT } from './exports';
import { parseOpportunityCsv } from './csvImport';

export { MAX_BACKUP_BYTES, MAX_BACKUP_RECORDS } from '@launchboard/domain';

export type BackupParseErrorCode =
  | 'invalid-json'
  | 'invalid-envelope'
  | 'unsupported-schema'
  | 'too-many-records'
  | 'invalid-csv'
  | 'invalid-csv-header'
  | 'invalid-csv-row';

export interface BackupParseError {
  code: BackupParseErrorCode;
  message: string;
}

export interface BackupSkip {
  /** Zero-based position in the backup's opportunities array. */
  index: number;
  id: string | null;
  reason: string;
}

export interface ParsedBackup {
  /** Optional metadata from the exporter; missing or malformed values are ignored. */
  exportedAt: string | null;
  records: Opportunity[];
  totalRecords: number;
  validRecords: number;
  repairedRecords: number;
  invalidRecords: number;
  duplicateRecords: number;
  skipped: BackupSkip[];
}

export type BackupParseResult =
  | { ok: true; backup: ParsedBackup }
  | { ok: false; error: BackupParseError };

export interface ParsedImportFile {
  backup: ParsedBackup;
  /** Original JSON envelope, or a generated version-1 envelope for CSV. */
  envelope: LaunchboardBackup;
  fileType: 'json' | 'csv';
}

export type ImportFileParseResult =
  | ({ ok: true } & ParsedImportFile)
  | { ok: false; error: BackupParseError };

export type ImportMode = 'merge' | 'replace';

export interface ImportPlan {
  mode: ImportMode;
  /** A new collection; neither input array is mutated. */
  candidate: Opportunity[];
  /** Merge only: records added from the backup. */
  added: number;
  /** Merge only: valid backup records skipped because their ID already exists. */
  skippedExisting: number;
  /** Replace only: current records removed by the operation. */
  replaced: number;
  finalCount: number;
}

export type BackupCommitResult =
  | { ok: true; plan: ImportPlan }
  | { ok: false; message: string };

/** The outcome the restore dialog needs; React state is committed by the caller. */
export type RestoreOutcome =
  | { ok: true }
  | { ok: false; message: string };

const REJECTION_MESSAGES: Record<BackupRecordFailure, string> = {
  'not-an-object': 'Record is not an object.',
  'missing-id': 'Missing a usable ID.',
  'invalid-id': 'The record ID exceeds the supported length.',
  'missing-title': 'Missing a title.',
  'missing-company': 'Missing a company or client.',
  'invalid-type': 'Invalid opportunity type.',
  'invalid-status': 'Invalid opportunity status.',
};

export const IMPORT_SAVE_ERROR =
  'The import could not be saved to this browser. Your current records were not changed. Check available storage and browser settings, then try again.';

function parseError(code: BackupParseErrorCode, message: string): BackupParseResult {
  return { ok: false, error: { code, message } };
}

function recordId(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return null;
  const id = (value as Record<string, unknown>).id;
  return typeof id === 'string' && id ? id : null;
}

/**
 * Validates a JSON backup envelope, then normalizes every record through the
 * canonical storage normalizer. Envelope errors fail the whole import; record
 * errors are counted and skipped without discarding valid siblings.
 */
export function parseBackupJson(text: string): BackupParseResult {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return parseError('invalid-json', 'The selected file is not valid JSON.');
  }

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return parseError('invalid-envelope', 'This is not a valid Launchboard backup.');
  }

  const envelope = value as Record<string, unknown>;
  if (envelope.format !== BACKUP_FORMAT) {
    return parseError(
      'invalid-envelope',
      'This file is not a Launchboard backup (the expected format marker is missing).',
    );
  }

  const schemaVersion = envelope.schemaVersion;
  if (typeof schemaVersion !== 'number' || !Number.isInteger(schemaVersion)) {
    return parseError('invalid-envelope', 'The backup is missing a valid schema version.');
  }

  if (!(BACKUP_SUPPORTED_SCHEMA_VERSIONS as readonly number[]).includes(schemaVersion)) {
    return parseError(
      'unsupported-schema',
      `This backup uses schema version ${schemaVersion}; supported versions are ${BACKUP_SUPPORTED_SCHEMA_VERSIONS.join(' and ')}.`,
    );
  }

  if (!Array.isArray(envelope.opportunities)) {
    return parseError('invalid-envelope', 'The backup does not contain an opportunities list.');
  }

  if (envelope.opportunities.length > MAX_BACKUP_RECORDS) {
    return parseError(
      'too-many-records',
      `This backup contains ${envelope.opportunities.length} records; the maximum is ${MAX_BACKUP_RECORDS}.`,
    );
  }

  const exportedAt =
    typeof envelope.exportedAt === 'string' && envelope.exportedAt.trim()
      ? envelope.exportedAt
      : null;
  const records: Opportunity[] = [];
  const skipped: BackupSkip[] = [];
  const seenIds = new Set<string>();
  let repairedRecords = 0;
  let invalidRecords = 0;
  let duplicateRecords = 0;

  envelope.opportunities.forEach((raw, index) => {
    const normalized = normalizeBackupOpportunityRecord(raw, schemaVersion);
    if (!normalized.opportunity) {
      invalidRecords += 1;
      skipped.push({
        index,
        id: recordId(raw),
        reason: normalized.failure
          ? REJECTION_MESSAGES[normalized.failure]
          : 'Record could not be normalized.',
      });
      return;
    }

    if (seenIds.has(normalized.opportunity.id)) {
      duplicateRecords += 1;
      skipped.push({
        index,
        id: normalized.opportunity.id,
        reason: 'Duplicate ID in this backup; the first valid record was kept.',
      });
      return;
    }

    seenIds.add(normalized.opportunity.id);
    if (normalized.repaired) repairedRecords += 1;
    records.push(normalized.opportunity);
  });

  return {
    ok: true,
    backup: {
      exportedAt,
      records,
      totalRecords: envelope.opportunities.length,
      validRecords: records.length,
      repairedRecords,
      invalidRecords,
      duplicateRecords,
      skipped,
    },
  };
}

/**
 * Parses either the native full-fidelity JSON backup or a tabular CSV file.
 * CSV is converted to the same version-1 envelope and passed through the
 * canonical backup normalizer so local and server imports share validation.
 */
export function parseImportFile(text: string, fileName: string): ImportFileParseResult {
  if (fileName.toLowerCase().endsWith('.csv')) {
    const csv = parseOpportunityCsv(text);
    if (!csv.ok) {
      return { ok: false, error: csv.error };
    }
    const normalized = parseBackupJson(JSON.stringify(csv.backup));
    if (!normalized.ok) return normalized;
    return {
      ok: true,
      backup: normalized.backup,
      envelope: csv.backup,
      fileType: 'csv',
    };
  }

  const parsed = parseBackupJson(text);
  if (!parsed.ok) return parsed;
  return {
    ok: true,
    backup: parsed.backup,
    envelope: JSON.parse(text) as LaunchboardBackup,
    fileType: 'json',
  };
}

/**
 * Merge keeps current records and appends valid incoming records whose IDs do
 * not exist. Replace uses only the valid, unique incoming records. Incoming
 * duplicates have already been deduplicated by parseBackupJson.
 */
export function planImport(
  current: Opportunity[],
  backup: ParsedBackup,
  mode: ImportMode,
): ImportPlan {
  if (mode === 'replace') {
    return {
      mode,
      candidate: [...backup.records],
      added: backup.records.length,
      skippedExisting: 0,
      replaced: current.length,
      finalCount: backup.records.length,
    };
  }

  const existingIds = new Set(current.map((item) => item.id));
  const additions = backup.records.filter((item) => !existingIds.has(item.id));
  return {
    mode,
    candidate: [...current, ...additions],
    added: additions.length,
    skippedExisting: backup.records.length - additions.length,
    replaced: 0,
    finalCount: current.length + additions.length,
  };
}

/**
 * Persists the planned candidate before returning it for a React state update.
 * A failed write leaves the current collection untouched and reports an error.
 */
export function commitBackupImport(
  current: Opportunity[],
  backup: ParsedBackup,
  mode: ImportMode,
  save: (items: Opportunity[]) => boolean,
): BackupCommitResult {
  const plan = planImport(current, backup, mode);
  if (!save(plan.candidate)) {
    return { ok: false, message: IMPORT_SAVE_ERROR };
  }
  return { ok: true, plan };
}
