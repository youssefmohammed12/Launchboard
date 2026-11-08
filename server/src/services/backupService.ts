import {
  BACKUP_FORMAT,
  BACKUP_SCHEMA_VERSION,
  BACKUP_SUPPORTED_SCHEMA_VERSIONS,
  normalizeBackupOpportunityRecord,
  type LaunchboardBackup,
  type Opportunity,
} from '@launchboard/domain';
import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { parseUtcDateTime } from '../auth/time.js';
import { acquireUtcConnection } from '../db/pool.js';
import { ApiError } from '../errors.js';
import { listOpportunities } from './opportunityService.js';

interface UserRevisionRow extends RowDataPacket {
  opportunity_revision: number | string;
}
interface ExistingOpportunityRow extends RowDataPacket {
  id: number | string;
  public_id: string;
  position: number | string;
  deleted_at: string | Date | null;
}
interface DatabaseClockRow extends RowDataPacket {
  now_utc: string | Date;
}
interface BackupSkip {
  index: number;
  id: string | null;
  reason: string;
}
interface ImportRecordPlan {
  records: Opportunity[];
  sourceIndices: number[];
  totalRecords: number;
  validRecords: number;
  repairedRecords: number;
  invalidRecords: number;
  duplicateRecords: number;
  skipped: BackupSkip[];
}

export interface ImportResult {
  mode: 'merge' | 'replace';
  dryRun: boolean;
  revision: number;
  totalRecords: number;
  validRecords: number;
  repairedRecords: number;
  invalidRecords: number;
  duplicateRecords: number;
  added: number;
  skippedExisting: number;
  replaced: number;
  finalCount: number;
  skipped: BackupSkip[];
}
export interface ImportRequest {
  mode: 'merge' | 'replace';
  backup: {
    format: string;
    schemaVersion: number;
    exportedAt?: unknown;
    opportunities: unknown[];
  };
  dryRun?: boolean;
  confirmReplace?: boolean;
  expectedRevision?: number;
}

function integer(value: number | string, field: string): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error('Invalid database value for ' + field + '.');
  }
  return parsed;
}
function toSqlDateTime(value: string | Date, field: string): string {
  const parsed = parseUtcDateTime(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error('Invalid database timestamp for ' + field + '.');
  }
  return parsed.toISOString().slice(0, 23).replace('T', ' ');
}
function archiveDateTime(value: string | undefined): string | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error('Invalid normalized archive timestamp.');
  return toSqlDateTime(new Date(timestamp), 'archivedAt');
}
function recordId(value: unknown): string | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const id = (value as Record<string, unknown>).id;
  return typeof id === 'string' && id.length > 0 ? id.slice(0, 128) : null;
}
function failureReason(code: string): string {
  const reasons: Record<string, string> = {
    'not-an-object': 'Record is not an object.',
    'missing-id': 'Missing a usable ID.',
    'invalid-id': 'ID exceeds the supported 128-character limit.',
    'missing-title': 'Missing a title.',
    'missing-company': 'Missing a company or client.',
    'invalid-type': 'Invalid opportunity type.',
    'invalid-status': 'Invalid opportunity status.',
  };
  return reasons[code] ?? 'Record could not be normalized.';
}
function planBackupRecords(rawRecords: readonly unknown[], schemaVersion: number): ImportRecordPlan {
  const records: Opportunity[] = [];
  const sourceIndices: number[] = [];
  const skipped: BackupSkip[] = [];
  const seenIds = new Set<string>();
  let repairedRecords = 0;
  let invalidRecords = 0;
  let duplicateRecords = 0;

  rawRecords.forEach((raw, index) => {
    const normalized = normalizeBackupOpportunityRecord(raw, schemaVersion);
    if (!normalized.opportunity) {
      invalidRecords += 1;
      skipped.push({
        index,
        id: recordId(raw),
        reason: failureReason(normalized.failure ?? 'unknown'),
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
    sourceIndices.push(index);
  });

  return {
    records, sourceIndices, totalRecords: rawRecords.length,
    validRecords: records.length, repairedRecords, invalidRecords,
    duplicateRecords, skipped,
  };
}
function invalidBackup(reason: string, message: string): ApiError {
  return new ApiError(422, 'INVALID_BACKUP', message, { reason });
}
async function withTransaction<T>(
  pool: Pool,
  work: (connection: PoolConnection) => Promise<T>,
): Promise<T> {
  let connection: PoolConnection | null = null;
  let transactionStarted = false;
  try {
    connection = await acquireUtcConnection(pool);
    await connection.beginTransaction();
    transactionStarted = true;
    const result = await work(connection);
    await connection.commit();
    transactionStarted = false;
    return result;
  } catch (error) {
    if (transactionStarted && connection) {
      try { await connection.rollback(); } catch { /* preserve original failure */ }
    }
    if (error instanceof ApiError) throw error;
    if (typeof error === 'object' && error !== null &&
      (error as { code?: unknown }).code === 'ER_DUP_ENTRY') {
      throw new ApiError(409, 'DUPLICATE_ID', 'An opportunity with this ID already exists.');
    }
    throw new ApiError(503, 'NOT_READY', 'Service unavailable.');
  } finally {
    connection?.release();
  }
}
async function lockUserAndReadState(
  connection: PoolConnection,
  userId: string,
): Promise<{ revision: number; rows: ExistingOpportunityRow[]; nextPosition: number }> {
  const [users] = await connection.execute<UserRevisionRow[]>(
    'SELECT opportunity_revision FROM users WHERE id = ? FOR UPDATE', [userId],
  );
  if (!users[0]) throw new ApiError(401, 'UNAUTHORIZED', 'Authentication required.');
  const revision = integer(users[0].opportunity_revision, 'opportunity_revision');
  const [rows] = await connection.execute<ExistingOpportunityRow[]>(
    'SELECT id, public_id, `position`, deleted_at FROM opportunities WHERE user_id = ? ORDER BY id FOR UPDATE',
    [userId],
  );
  const activeRows = rows.filter((row) => row.deleted_at === null);
  const maximum = activeRows.reduce(
    (value, row) => Math.max(value, integer(row.position, 'opportunity position')),
    -1,
  );
  return { revision, rows, nextPosition: maximum + 1 };
}
async function databaseNow(connection: PoolConnection): Promise<string> {
  const [rows] = await connection.execute<DatabaseClockRow[]>(
    'SELECT UTC_TIMESTAMP(3) AS now_utc',
  );
  if (!rows[0]) throw new Error('Database UTC time unavailable.');
  return toSqlDateTime(rows[0].now_utc, 'now_utc');
}
async function incrementRevision(connection: PoolConnection, userId: string): Promise<number> {
  const [result] = await connection.execute<ResultSetHeader>(
    'UPDATE users SET opportunity_revision = opportunity_revision + 1 WHERE id = ?', [userId],
  );
  if (result.affectedRows !== 1) throw new ApiError(401, 'UNAUTHORIZED', 'Authentication required.');
  const [rows] = await connection.execute<UserRevisionRow[]>(
    'SELECT opportunity_revision FROM users WHERE id = ?', [userId],
  );
  if (!rows[0]) throw new ApiError(401, 'UNAUTHORIZED', 'Authentication required.');
  return integer(rows[0].opportunity_revision, 'opportunity_revision');
}
async function deleteOwnedOpportunities(connection: PoolConnection, userId: string): Promise<void> {
  const childDelete = (table: string) => connection.execute(
    'DELETE FROM ' + table + ' WHERE opportunity_id IN (SELECT id FROM opportunities WHERE user_id = ?)',
    [userId],
  );
  // Interviews restrict contact deletion until references are removed.
  await childDelete('interviews');
  await childDelete('tasks');
  await childDelete('activities');
  await childDelete('materials');
  await childDelete('contacts');
  await childDelete('opportunity_tags');
  await childDelete('opportunity_locations');
  await connection.execute('DELETE FROM opportunities WHERE user_id = ?', [userId]);
  await connection.execute('DELETE FROM opportunity_deletions WHERE user_id = ?', [userId]);
}
async function insertOpportunity(
  connection: PoolConnection,
  userId: string,
  position: number,
  opportunity: Opportunity,
  now: string,
): Promise<number | string> {
  const [result] = await connection.execute<ResultSetHeader>(
    'INSERT INTO opportunities (user_id, public_id, `position`, title, company, `type`, `status`, `priority`, `url`, deadline, follow_up_date, department, team, workplace_type, employment_type, posted_date, compensation_min, compensation_max, compensation_currency, compensation_interval, compensation, description, notes, archived_at, is_demo, `version`, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)',
    [
      userId, opportunity.id, position, opportunity.title, opportunity.company,
      opportunity.type, opportunity.status, opportunity.priority, opportunity.url,
      opportunity.deadline || null, opportunity.followUpDate || null,
      opportunity.department, opportunity.team, opportunity.workplaceType,
      opportunity.employmentType, opportunity.postedDate || null,
      opportunity.compensationDetails?.minAmount || null,
      opportunity.compensationDetails?.maxAmount || null,
      opportunity.compensationDetails?.currency || null,
      opportunity.compensationDetails?.interval || null,
      opportunity.compensation, opportunity.description, opportunity.notes,
      archiveDateTime(opportunity.archivedAt), opportunity.isDemo ? 1 : 0, now, now,
    ],
  );
  if (!result.insertId) throw new Error('Imported opportunity ID was not returned.');
  return result.insertId;
}
async function insertChildren(
  connection: PoolConnection,
  opportunityId: number | string,
  opportunity: Opportunity,
): Promise<void> {
  for (const [position, location] of opportunity.locations.entries()) {
    await connection.execute(
      'INSERT INTO opportunity_locations (opportunity_id, `position`, location) VALUES (?, ?, ?)',
      [opportunityId, position, location],
    );
  }
  for (const [position, tag] of opportunity.tags.entries()) {
    await connection.execute(
      'INSERT INTO opportunity_tags (opportunity_id, tag, tag_key, `position`) VALUES (?, ?, ?, ?)',
      [opportunityId, tag, tag.toLowerCase(), position],
    );
  }
  for (const [position, contact] of opportunity.contacts.entries()) {
    await connection.execute(
      'INSERT INTO contacts (opportunity_id, public_id, `position`, `name`, role, email, phone, website, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [opportunityId, contact.id, position, contact.name, contact.role, contact.email,
        contact.phone, contact.website, contact.notes],
    );
  }
  for (const [position, interview] of opportunity.interviews.entries()) {
    await connection.execute(
      'INSERT INTO interviews (opportunity_id, public_id, `position`, `round`, `date`, `time`, mode, status, outcome, meeting_url, location, preparation_notes, notes, contact_public_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [opportunityId, interview.id, position, interview.round, interview.date,
        interview.time || null, interview.mode, interview.status, interview.outcome || null,
        interview.meetingUrl, interview.location, interview.preparationNotes,
        interview.notes, interview.contactId || null],
    );
  }
  for (const [position, material] of opportunity.materials.entries()) {
    await connection.execute(
      'INSERT INTO materials (opportunity_id, public_id, `position`, label, `kind`, `url`, `version`, status, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [opportunityId, material.id, position, material.label, material.kind, material.url,
        material.version, material.status, material.notes],
    );
  }
  for (const [position, activity] of opportunity.activities.entries()) {
    await connection.execute(
      'INSERT INTO activities (opportunity_id, public_id, `position`, `type`, `date`, note) VALUES (?, ?, ?, ?, ?, ?)',
      [opportunityId, activity.id, position, activity.type, activity.date, activity.note],
    );
  }
  for (const [position, task] of opportunity.tasks.entries()) {
    await connection.execute(
      'INSERT INTO tasks (opportunity_id, public_id, `position`, title, notes, priority, due_date, completed, completed_on) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [opportunityId, task.id, position, task.title, task.notes, task.priority,
        task.dueDate || null, task.completed ? 1 : 0, task.completedOn || null],
    );
  }
}
function buildImportResult(
  mode: 'merge' | 'replace',
  dryRun: boolean,
  revision: number,
  plan: ImportRecordPlan,
  values: { added: number; skippedExisting: number; replaced: number; finalCount: number },
): ImportResult {
  return {
    mode, dryRun, revision,
    totalRecords: plan.totalRecords,
    validRecords: plan.validRecords,
    repairedRecords: plan.repairedRecords,
    invalidRecords: plan.invalidRecords,
    duplicateRecords: plan.duplicateRecords,
    added: values.added,
    skippedExisting: values.skippedExisting,
    replaced: values.replaced,
    finalCount: values.finalCount,
    skipped: plan.skipped,
  };
}

export async function exportOpportunities(pool: Pool, userId: string): Promise<LaunchboardBackup> {
  const collection = await listOpportunities(pool, userId, 'all');
  return {
    format: BACKUP_FORMAT,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    opportunities: collection.items.map((resource) => resource.opportunity as unknown as Opportunity),
  };
}

export async function importOpportunities(
  pool: Pool,
  userId: string,
  input: ImportRequest,
): Promise<ImportResult> {
  if (input.backup.format !== BACKUP_FORMAT) {
    throw invalidBackup('invalid-envelope', 'This is not a valid Launchboard backup.');
  }
  if (!(BACKUP_SUPPORTED_SCHEMA_VERSIONS as readonly number[]).includes(input.backup.schemaVersion)) {
    throw invalidBackup('unsupported-schema', 'This backup uses an unsupported schema version.');
  }

  const recordPlan = planBackupRecords(input.backup.opportunities, input.backup.schemaVersion);
  const dryRun = input.dryRun === true;

  return withTransaction(pool, async (connection) => {
    const state = await lockUserAndReadState(connection, userId);
    const activeRows = state.rows.filter((row) => row.deleted_at === null);
    const existingIds = new Set(state.rows.map((row) => row.public_id));

    if (input.mode === 'replace' && input.expectedRevision !== state.revision) {
      throw new ApiError(
        409, 'STALE_REVISION',
        'The opportunity collection changed since you last loaded it.',
        { expectedRevision: input.expectedRevision, currentRevision: state.revision },
      );
    }

    if (input.mode === 'replace') {
      const added = recordPlan.records.length;
      const replaced = activeRows.length;
      const finalCount = recordPlan.records.length;
      if (!dryRun) {
        const now = await databaseNow(connection);
        await deleteOwnedOpportunities(connection, userId);
        for (const [position, opportunity] of recordPlan.records.entries()) {
          const opportunityId = await insertOpportunity(connection, userId, position, opportunity, now);
          await insertChildren(connection, opportunityId, opportunity);
        }
        const revision = await incrementRevision(connection, userId);
        return buildImportResult('replace', false, revision, recordPlan, {
          added, skippedExisting: 0, replaced, finalCount,
        });
      }
      return buildImportResult('replace', true, state.revision, recordPlan, {
        added, skippedExisting: 0, replaced, finalCount,
      });
    }

    const additions = recordPlan.records.filter((record) => !existingIds.has(record.id));
    const skippedExisting = recordPlan.records.length - additions.length;
    if (skippedExisting > 0) {
      recordPlan.records.forEach((record, index) => {
        if (existingIds.has(record.id)) {
          recordPlan.skipped.push({
            index: recordPlan.sourceIndices[index] ?? index,
            id: record.id,
            reason: 'An opportunity with this ID already exists for this account.',
          });
        }
      });
      recordPlan.skipped.sort((left, right) => left.index - right.index);
    }
    const finalCount = activeRows.length + additions.length;
    if (dryRun || additions.length === 0) {
      return buildImportResult('merge', dryRun, state.revision, recordPlan, {
        added: additions.length, skippedExisting, replaced: 0, finalCount,
      });
    }

    const now = await databaseNow(connection);
    let position = state.nextPosition;
    for (const opportunity of additions) {
      const opportunityId = await insertOpportunity(connection, userId, position, opportunity, now);
      await insertChildren(connection, opportunityId, opportunity);
      position += 1;
    }
    const revision = await incrementRevision(connection, userId);
    return buildImportResult('merge', false, revision, recordPlan, {
      added: additions.length, skippedExisting, replaced: 0, finalCount,
    });
  });
}
