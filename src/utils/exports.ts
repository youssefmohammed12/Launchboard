import type { Opportunity } from '../types/opportunity';
import {
  BACKUP_FORMAT,
  BACKUP_SCHEMA_VERSION,
  type LaunchboardBackup,
} from '@launchboard/domain';
import { toISODate } from './dates';

export { BACKUP_FORMAT, BACKUP_SCHEMA_VERSION } from '@launchboard/domain';
export type { LaunchboardBackup } from '@launchboard/domain';

const CSV_HEADERS = [
  'ID',
  'Title',
  'Company',
  'Type',
  'Status',
  'Priority',
  'Tags',
  'Deadline',
  'Follow-up Date',
  'Compensation',
  'Application URL',
  'Description',
  'Notes',
  'Demo',
  'Activities (JSON)',
] as const;

/**
 * Spreadsheet applications may treat these leading characters as formulas.
 * A leading apostrophe is a common mitigation, but it is not a guarantee for
 * every spreadsheet application or import mode.
 */
const FORMULA_PREFIX = /^[=+\-@\t\r]/;

function neutralizeFormula(value: string): string {
  return FORMULA_PREFIX.test(value) ? `'${value}` : value;
}

/** Quotes every cell and doubles embedded quotes for valid CSV escaping. */
function csvCell(value: string): string {
  return `"${neutralizeFormula(value).replace(/"/g, '""')}"`;
}

function csvRow(values: readonly string[]): string {
  return values.map(csvCell).join(',');
}

function opportunityToCsvRow(item: Opportunity): string[] {
  return [
    item.id,
    item.title,
    item.company,
    item.type,
    item.status,
    item.priority,
    item.tags.join(', '),
    item.deadline,
    item.followUpDate,
    item.compensation,
    item.url,
    item.description,
    item.notes,
    item.isDemo ? 'Yes' : 'No',
    JSON.stringify(item.activities),
  ];
}

/** Builds a UTF-8 CSV with a header row, including when there are no records. */
export function createCsv(items: Opportunity[]): string {
  const rows = [csvRow(CSV_HEADERS), ...items.map((item) => csvRow(opportunityToCsvRow(item)))];
  return `\uFEFF${rows.join('\r\n')}`;
}

/** Builds an inspectable backup of the current in-memory opportunity records. */
export function createJsonBackup(items: Opportunity[]): string {
  const backup: LaunchboardBackup = {
    format: BACKUP_FORMAT,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    opportunities: items,
  };
  return JSON.stringify(backup, null, 2);
}

function triggerDownload(filename: string, content: string, type: string): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.hidden = true;

  try {
    document.body.appendChild(link);
    link.click();
  } finally {
    link.remove();
    // Defer revocation so the browser can start reading the blob URL.
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

/** Downloads all current opportunities as a spreadsheet-friendly CSV. */
export function downloadCsv(items: Opportunity[]): void {
  triggerDownload(
    `launchboard-opportunities-${toISODate(new Date())}.csv`,
    createCsv(items),
    'text/csv;charset=utf-8',
  );
}

/** Downloads an exact versioned backup envelope returned by the authenticated API. */
export function downloadJsonBackupEnvelope(backup: LaunchboardBackup): void {
  triggerDownload(
    `launchboard-backup-${toISODate(new Date())}.json`,
    JSON.stringify(backup, null, 2),
    'application/json;charset=utf-8',
  );
}

/** Downloads a versioned JSON backup of the complete current opportunity data. */
export function downloadJsonBackup(items: Opportunity[]): void {
  const backup: LaunchboardBackup = {
    format: BACKUP_FORMAT,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    opportunities: items,
  };
  downloadJsonBackupEnvelope(backup);
}

/**
 * Downloads the exact raw opportunity payload preserved during recovery.
 * The content is intentionally not wrapped or reformatted: malformed text is
 * still useful evidence, but the file is not necessarily a valid backup.
 */
export function downloadRecoveryPayload(
  raw: string,
  label = 'recovery-raw',
): void {
  triggerDownload(
    `launchboard-${label}-${toISODate(new Date())}.txt`,
    raw,
    'text/plain;charset=utf-8',
  );
}
