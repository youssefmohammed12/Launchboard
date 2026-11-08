
import { SYSTEM_ACTIVITY_TYPE, type TaskEntry } from '@launchboard/domain';
import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { randomUUID } from 'node:crypto';
import { parseUtcDateTime } from '../auth/time.js';
import { acquireUtcConnection } from '../db/pool.js';
import { ApiError } from '../errors.js';
import type {
  ActivityInput,
  OpportunityCreateInput,
  OpportunityUpdateInput,
} from '../validation/opportunitySchemas.js';
import type {
  BulkItem,
  BulkStatusBody,
  BulkUndoArchiveBody,
  UndoArchiveItem,
} from '../validation/bulkSchemas.js';

type ArchivedFilter = 'active' | 'archived' | 'all';

interface OpportunityRow extends RowDataPacket {
  id: number | string;
  user_id: string;
  public_id: string;
  title: string;
  company: string;
  type: string;
  status: string;
  priority: string;
  url: string;
  deadline: string | null;
  follow_up_date: string | null;
  department: string | null;
  team: string | null;
  workplace_type: string | null;
  employment_type: string | null;
  posted_date: string | null;
  compensation_min: string | number | null;
  compensation_max: string | number | null;
  compensation_currency: string | null;
  compensation_interval: string | null;
  compensation: string;
  description: string;
  notes: string;
  archived_at: string | Date | null;
  is_demo: number | string | boolean;
  version: number | string;
  created_at: string | Date;
  updated_at: string | Date;
}

interface ActivityRow extends RowDataPacket {
  opportunity_id: number | string;
  public_id: string;
  type: string;
  date: string;
  note: string;
  position: number | string;
}

interface TagRow extends RowDataPacket {
  opportunity_id?: number | string;
  tag: string;
}

interface OpportunityLocationRow extends RowDataPacket {
  opportunity_id?: number | string;
  location: string;
}

interface ContactRow extends RowDataPacket {
  opportunity_id?: number | string;
  public_id: string;
  name: string;
  role: string;
  email: string;
  phone: string;
  website: string;
  notes: string;
}

interface InterviewRow extends RowDataPacket {
  opportunity_id?: number | string;
  public_id: string;
  round: string;
  date: string;
  time: string | null;
  mode: string;
  status: string;
  outcome: string | null;
  meeting_url: string;
  location: string;
  preparation_notes: string;
  notes: string;
  contact_public_id: string | null;
}

interface MaterialRow extends RowDataPacket {
  opportunity_id?: number | string;
  public_id: string;
  label: string;
  kind: string;
  url: string;
  version: string;
  status: string;
  notes: string;
}

interface TaskRow extends RowDataPacket {
  opportunity_id?: number | string;
  public_id: string;
  title: string;
  notes: string;
  priority: string;
  due_date: string | null;
  completed: number | string | boolean;
  completed_on: string | null;
  position: number | string;
}

interface RevisionRow extends RowDataPacket {
  opportunity_revision: number | string;
}

interface PositionRow extends RowDataPacket {
  next_position: number | string;
}

interface DeletionRow extends RowDataPacket {
  expires_at: string | Date;
}

interface DeletionBatchRow extends RowDataPacket {
  expires_at: string | Date;
  restored_at: string | Date | null;
}

interface UtcNowRow extends RowDataPacket {
  now_utc: string | Date;
}

export interface OpportunityResource {
  opportunity: {
    id: string;
    title: string;
    company: string;
    type: string;
    status: string;
    priority: string;
    tags: string[];
    url: string;
    deadline: string;
    followUpDate: string;
    activities: Array<{ id: string; type: string; date: string; note: string }>;
    interviews: Array<{
      id: string; round: string; date: string; time: string;
      mode: string; status: string; outcome: string; meetingUrl: string;
      location: string; preparationNotes: string; notes: string; contactId: string;
    }>;
    contacts: Array<{
      id: string; name: string; role: string; email: string;
      phone: string; website: string; notes: string;
    }>;
    materials: Array<{
      id: string; label: string; kind: string; url: string;
      version: string; status: string; notes: string;
    }>;
    tasks: TaskEntry[];
    locations: string[];
    department: string;
    team: string;
    workplaceType: '' | 'Remote' | 'Hybrid' | 'On-site';
    employmentType: string;
    postedDate: string;
    compensationDetails: {
      minAmount: string;
      maxAmount: string;
      currency: string;
      interval: '' | 'hour' | 'day' | 'week' | 'month' | 'year' | 'one-time';
    } | null;
    compensation: string;
    description: string;
    notes: string;
    archivedAt?: string;
    isDemo?: true;
  };
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface OpportunityCollection {
  revision: number;
  items: OpportunityResource[];
}

function canonicalDecimal(value: string | number): string {
  return String(value).replace(/(\.\d*?)0+$/u, '$1').replace(/\.$/u, '');
}

function safeInteger(value: number | string, field: string): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`Invalid database value for ${field}.`);
  }
  return parsed;
}

function isoTimestamp(value: string | Date, field: string): string {
  const parsed = parseUtcDateTime(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid database timestamp for ${field}.`);
  }
  return parsed.toISOString();
}

function dbDate(value: string): string | null {
  return value === '' ? null : value;
}

function mapActivity(row: ActivityRow) {
  return {
    id: row.public_id,
    type: row.type,
    date: row.date,
    note: row.note,
  };
}

interface OpportunityChildren {
  tags: readonly TagRow[];
  locations: readonly OpportunityLocationRow[];
  activities: readonly ActivityRow[];
  interviews: readonly InterviewRow[];
  contacts: readonly ContactRow[];
  materials: readonly MaterialRow[];
  tasks: readonly TaskRow[];
}

function mapOpportunity(
  row: OpportunityRow,
  children: OpportunityChildren,
): OpportunityResource {
  const demo = row.is_demo === true || row.is_demo === 1 || row.is_demo === '1';
  const archivedAt = row.archived_at
    ? isoTimestamp(row.archived_at, 'archived_at')
    : undefined;

  return {
    opportunity: {
      id: row.public_id,
      title: row.title,
      company: row.company,
      type: row.type,
      status: row.status,
      priority: row.priority,
      tags: children.tags.map((tag) => tag.tag),
      url: row.url,
      deadline: row.deadline ?? '',
      followUpDate: row.follow_up_date ?? '',
      activities: children.activities.map(mapActivity),
      interviews: children.interviews.map((interview) => ({
        id: interview.public_id,
        round: interview.round,
        date: interview.date,
        time: interview.time?.slice(0, 5) ?? '',
        mode: interview.mode,
        status: interview.status,
        outcome: interview.outcome ?? '',
        meetingUrl: interview.meeting_url,
        location: interview.location,
        preparationNotes: interview.preparation_notes,
        notes: interview.notes,
        contactId: interview.contact_public_id ?? '',
      })),
      contacts: children.contacts.map((contact) => ({
        id: contact.public_id,
        name: contact.name,
        role: contact.role,
        email: contact.email,
        phone: contact.phone,
        website: contact.website,
        notes: contact.notes,
      })),
      materials: children.materials.map((material) => ({
        id: material.public_id,
        label: material.label,
        kind: material.kind,
        url: material.url,
        version: material.version,
        status: material.status,
        notes: material.notes,
      })),
      tasks: children.tasks.map((task) => ({
        id: task.public_id,
        title: task.title,
        notes: task.notes,
        priority: task.priority as TaskEntry['priority'],
        dueDate: task.due_date ?? '',
        completed: task.completed === true || task.completed === 1 || task.completed === '1',
        completedOn: task.completed_on ?? '',
      })),
      locations: children.locations.map((location) => location.location),
      department: row.department ?? '',
      team: row.team ?? '',
      workplaceType: (row.workplace_type ?? '') as '' | 'Remote' | 'Hybrid' | 'On-site',
      employmentType: row.employment_type ?? '',
      postedDate: row.posted_date ?? '',
      compensationDetails: row.compensation_min === null && row.compensation_max === null
        ? null
        : {
            minAmount: row.compensation_min === null ? '' : canonicalDecimal(row.compensation_min),
            maxAmount: row.compensation_max === null ? '' : canonicalDecimal(row.compensation_max),
            currency: row.compensation_currency ?? '',
            interval: (row.compensation_interval ?? '') as '' | 'hour' | 'day' | 'week' | 'month' | 'year' | 'one-time',
          },
      compensation: row.compensation,
      description: row.description,
      notes: row.notes,
      ...(archivedAt ? { archivedAt } : {}),
      ...(demo ? { isDemo: true as const } : {}),
    },
    version: safeInteger(row.version, 'version'),
    createdAt: isoTimestamp(row.created_at, 'created_at'),
    updatedAt: isoTimestamp(row.updated_at, 'updated_at'),
  };
}

function validationError(path: string, message: string): ApiError {
  return new ApiError(422, 'VALIDATION_ERROR', 'The request contains invalid fields.', {
    fields: [{ path, message }],
  });
}

function assertSystemActivitiesPreserved(
  supplied: readonly ActivityInput[],
  stored: readonly ActivityRow[],
): void {
  const existing = stored.filter((activity) => activity.type === SYSTEM_ACTIVITY_TYPE);
  const submitted = supplied.filter((activity) => activity.type === SYSTEM_ACTIVITY_TYPE);
  const unchanged = existing.length === submitted.length && existing.every((activity, index) => {
    const candidate = submitted[index];
    return candidate !== undefined &&
      candidate.id === activity.public_id &&
      candidate.type === activity.type &&
      candidate.date === activity.date &&
      candidate.note === activity.note;
  });
  if (!unchanged || submitted.some((candidate) =>
    !existing.some((activity) => activity.public_id === candidate.id),
  )) {
    throw new ApiError(
      422,
      'SYSTEM_ACTIVITY_IMMUTABLE',
      'Server-generated status-change activities cannot be added, edited or removed.',
    );
  }
}

type AggregateInput = OpportunityCreateInput | OpportunityUpdateInput;

async function replaceNestedCollections(
  connection: PoolConnection,
  opportunityId: number | string,
  input: AggregateInput,
): Promise<void> {
  // Delete dependent records in the contract's safe order. Interviews
  // reference contacts with ON DELETE RESTRICT, so they must go first.
  await connection.execute('DELETE FROM tasks WHERE opportunity_id = ?', [opportunityId]);
  await connection.execute('DELETE FROM activities WHERE opportunity_id = ?', [opportunityId]);
  await connection.execute('DELETE FROM interviews WHERE opportunity_id = ?', [opportunityId]);
  await connection.execute('DELETE FROM materials WHERE opportunity_id = ?', [opportunityId]);
  await connection.execute('DELETE FROM contacts WHERE opportunity_id = ?', [opportunityId]);
  await connection.execute('DELETE FROM opportunity_tags WHERE opportunity_id = ?', [opportunityId]);

  if (input.locations !== undefined) {
    await connection.execute('DELETE FROM opportunity_locations WHERE opportunity_id = ?', [opportunityId]);
    for (const [position, location] of input.locations.entries()) {
      await connection.execute(
        'INSERT INTO opportunity_locations (opportunity_id, `position`, location) VALUES (?, ?, ?)',
        [opportunityId, position, location],
      );
    }
  }
  for (const [position, tag] of input.tags.entries()) {
    await connection.execute(
      'INSERT INTO opportunity_tags (opportunity_id, tag, tag_key, `position`) VALUES (?, ?, ?, ?)',
      [opportunityId, tag, tag.toLowerCase(), position],
    );
  }
  for (const [position, contact] of input.contacts.entries()) {
    await connection.execute(
      'INSERT INTO contacts (opportunity_id, public_id, `position`, `name`, role, email, phone, website, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [opportunityId, contact.id, position, contact.name, contact.role, contact.email, contact.phone, contact.website, contact.notes],
    );
  }
  for (const [position, interview] of input.interviews.entries()) {
    await connection.execute(
      'INSERT INTO interviews (opportunity_id, public_id, `position`, `round`, `date`, `time`, mode, status, outcome, meeting_url, location, preparation_notes, notes, contact_public_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [opportunityId, interview.id, position, interview.round, interview.date,
        interview.time || null, interview.mode, interview.status, interview.outcome || null,
        interview.meetingUrl, interview.location, interview.preparationNotes,
        interview.notes, interview.contactId || null],
    );
  }
  for (const [position, material] of input.materials.entries()) {
    await connection.execute(
      'INSERT INTO materials (opportunity_id, public_id, `position`, label, `kind`, `url`, `version`, status, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [opportunityId, material.id, position, material.label, material.kind, material.url, material.version, material.status, material.notes],
    );
  }
  for (const [position, activity] of input.activities.entries()) {
    await connection.execute(
      'INSERT INTO activities (opportunity_id, public_id, `position`, `type`, `date`, note) VALUES (?, ?, ?, ?, ?, ?)',
      [opportunityId, activity.id, position, activity.type, activity.date, activity.note],
    );
  }
  for (const [position, task] of input.tasks.entries()) {
    await connection.execute(
      'INSERT INTO tasks (opportunity_id, public_id, `position`, title, notes, priority, due_date, completed, completed_on) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [opportunityId, task.id, position, task.title, task.notes, task.priority,
        dbDate(task.dueDate), task.completed ? 1 : 0, dbDate(task.completedOn)],
    );
  }
}

async function selectChildren(
  connection: PoolConnection,
  opportunityId: number | string,
): Promise<OpportunityChildren> {
  const [tags] = await connection.execute<TagRow[]>(
    'SELECT tag FROM opportunity_tags WHERE opportunity_id = ? ORDER BY `position`',
    [opportunityId],
  );
  const [locations] = await connection.execute<OpportunityLocationRow[]>(
    'SELECT location FROM opportunity_locations WHERE opportunity_id = ? ORDER BY `position`',
    [opportunityId],
  );
  const activities = await selectActivities(connection, opportunityId);
  const [interviews] = await connection.execute<InterviewRow[]>(
    'SELECT public_id, `round`, `date`, `time`, mode, status, outcome, meeting_url, location, preparation_notes, notes, contact_public_id FROM interviews WHERE opportunity_id = ? ORDER BY `position`',
    [opportunityId],
  );
  const [contacts] = await connection.execute<ContactRow[]>(
    'SELECT public_id, `name`, role, email, phone, website, notes FROM contacts WHERE opportunity_id = ? ORDER BY `position`',
    [opportunityId],
  );
  const [materials] = await connection.execute<MaterialRow[]>(
    'SELECT public_id, label, `kind`, `url`, `version`, status, notes FROM materials WHERE opportunity_id = ? ORDER BY `position`',
    [opportunityId],
  );
  const [tasks] = await connection.execute<TaskRow[]>(
    'SELECT public_id, title, notes, priority, due_date, completed, completed_on, `position` FROM tasks WHERE opportunity_id = ? ORDER BY `position`',
    [opportunityId],
  );
  return { tags, locations, activities, interviews, contacts, materials, tasks };
}

async function selectChildrenForCollection(
  connection: PoolConnection,
  opportunities: readonly OpportunityRow[],
): Promise<Map<string, OpportunityChildren>> {
  const grouped = new Map<string, OpportunityChildren>();
  if (opportunities.length === 0) return grouped;
  const ids = opportunities.map((opportunity) => opportunity.id);
  const placeholders = ids.map(() => '?').join(', ');
  const [tags] = await connection.execute<TagRow[]>(
    'SELECT opportunity_id, tag FROM opportunity_tags WHERE opportunity_id IN (' + placeholders + ') ORDER BY opportunity_id, `position`',
    ids,
  );
  const [locations] = await connection.execute<OpportunityLocationRow[]>(
    'SELECT opportunity_id, location FROM opportunity_locations WHERE opportunity_id IN (' + placeholders + ') ORDER BY opportunity_id, `position`',
    ids,
  );
  const [activities] = await connection.execute<ActivityRow[]>(
    'SELECT opportunity_id, public_id, `type`, `date`, note, `position` FROM activities WHERE opportunity_id IN (' + placeholders + ') ORDER BY opportunity_id, `position`',
    ids,
  );
  const [interviews] = await connection.execute<InterviewRow[]>(
    'SELECT opportunity_id, public_id, `round`, `date`, `time`, mode, status, outcome, meeting_url, location, preparation_notes, notes, contact_public_id FROM interviews WHERE opportunity_id IN (' + placeholders + ') ORDER BY opportunity_id, `position`',
    ids,
  );
  const [contacts] = await connection.execute<ContactRow[]>(
    'SELECT opportunity_id, public_id, `name`, role, email, phone, website, notes FROM contacts WHERE opportunity_id IN (' + placeholders + ') ORDER BY opportunity_id, `position`',
    ids,
  );
  const [materials] = await connection.execute<MaterialRow[]>(
    'SELECT opportunity_id, public_id, label, `kind`, `url`, `version`, status, notes FROM materials WHERE opportunity_id IN (' + placeholders + ') ORDER BY opportunity_id, `position`',
    ids,
  );
  const [tasks] = await connection.execute<TaskRow[]>(
    'SELECT opportunity_id, public_id, title, notes, priority, due_date, completed, completed_on, `position` FROM tasks WHERE opportunity_id IN (' + placeholders + ') ORDER BY opportunity_id, `position`',
    ids,
  );
  for (const opportunity of opportunities) {
    grouped.set(String(opportunity.id), {
      tags: [], locations: [], activities: [], interviews: [], contacts: [], materials: [], tasks: [],
    });
  }
  for (const [rows, key] of [
    [tags, 'tags'],
    [locations, 'locations'],
    [activities, 'activities'],
    [interviews, 'interviews'],
    [contacts, 'contacts'],
    [materials, 'materials'],
    [tasks, 'tasks'],
  ] as const) {
    for (const child of rows) {
      const target = grouped.get(String(child.opportunity_id));
      if (target) (target[key] as unknown[]).push(child);
    }
  }
  return grouped;
}

async function selectOpportunity(
  connection: PoolConnection,
  userId: string,
  publicId: string,
  lock = false,
): Promise<OpportunityRow | null> {
  const [rows] = await connection.execute<OpportunityRow[]>(
    `SELECT *
     FROM opportunities
     WHERE user_id = ? AND public_id = ? AND deleted_at IS NULL
     LIMIT 1${lock ? ' FOR UPDATE' : ''}`,
    [userId, publicId],
  );
  return rows[0] ?? null;
}

async function selectActivities(
  connection: PoolConnection,
  opportunityId: number | string,
): Promise<ActivityRow[]> {
  const [rows] = await connection.execute<ActivityRow[]>(
    'SELECT opportunity_id, public_id, `type`, `date`, note, `position` FROM activities WHERE opportunity_id = ? ORDER BY `position`, public_id',
    [opportunityId],
  );
  return rows;
}

async function incrementRevision(
  connection: PoolConnection,
  userId: string,
): Promise<void> {
  const [result] = await connection.execute<ResultSetHeader>(
    'UPDATE users SET opportunity_revision = opportunity_revision + 1 WHERE id = ?',
    [userId],
  );
  if (result.affectedRows !== 1) {
    throw new ApiError(401, 'UNAUTHORIZED', 'Authentication required.');
  }
}

async function readRevision(
  connection: PoolConnection,
  userId: string,
): Promise<number> {
  const [rows] = await connection.execute<RevisionRow[]>(
    'SELECT opportunity_revision FROM users WHERE id = ? LIMIT 1',
    [userId],
  );
  if (!rows[0]) {
    throw new ApiError(401, 'UNAUTHORIZED', 'Authentication required.');
  }
  return safeInteger(rows[0].opportunity_revision, 'opportunity_revision');
}

async function withReadTransaction<T>(
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
      try {
        await connection.rollback();
      } catch {
        // Preserve the original failure.
      }
    }
    if (error instanceof ApiError) throw error;
    throw new ApiError(503, 'NOT_READY', 'Service unavailable.');
  } finally {
    connection?.release();
  }
}

async function withWriteTransaction<T>(
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
      try {
        await connection.rollback();
      } catch {
        // Preserve the original failure.
      }
    }
    if (error instanceof ApiError) throw error;
    if (
      typeof error === 'object' &&
      error !== null &&
      (error as { code?: unknown }).code === 'ER_DUP_ENTRY'
    ) {
      throw new ApiError(409, 'DUPLICATE_ID', 'An opportunity with this ID already exists.');
    }
    throw new ApiError(503, 'NOT_READY', 'Service unavailable.');
  } finally {
    connection?.release();
  }
}

async function appendStatusActivity(
  connection: PoolConnection,
  opportunityId: number | string,
  previousStatus: string,
  nextStatus: string,
  date: string,
): Promise<void> {
  const [positions] = await connection.execute<PositionRow[]>(
    'SELECT COALESCE(MAX(`position`) + 1, 0) AS next_position FROM activities WHERE opportunity_id = ?',
    [opportunityId],
  );
  const position = safeInteger(positions[0]?.next_position ?? 0, 'activity position');

  await connection.execute<ResultSetHeader>(
    'INSERT INTO activities (opportunity_id, public_id, `position`, `type`, `date`, note) VALUES (?, ?, ?, ?, ?, ?)',
    [
      opportunityId,
      randomUUID(),
      position,
      SYSTEM_ACTIVITY_TYPE,
      date,
      `Status changed from ${previousStatus} to ${nextStatus}.`,
    ],
  );
}

export async function listOpportunities(
  pool: Pool,
  userId: string,
  archived: ArchivedFilter,
): Promise<OpportunityCollection> {
  return withReadTransaction(pool, async (connection) => {
    const revision = await readRevision(connection, userId);
    const archiveClause =
      archived === 'active'
        ? ' AND o.archived_at IS NULL'
        : archived === 'archived'
          ? ' AND o.archived_at IS NOT NULL'
          : '';
    const [rows] = await connection.execute<OpportunityRow[]>(
      `SELECT o.*
       FROM opportunities o
       WHERE o.user_id = ? AND o.deleted_at IS NULL${archiveClause}
       ORDER BY o.\`position\`, o.public_id`,
      [userId],
    );
    const children = await selectChildrenForCollection(connection, rows);
    return {
      revision,
      items: rows.map((row) => {
        const aggregate = children.get(String(row.id));
        if (!aggregate) throw new Error('Opportunity children could not be loaded.');
        return mapOpportunity(row, aggregate);
      }),
    };
  });
}

export async function getOpportunity(
  pool: Pool,
  userId: string,
  publicId: string,
): Promise<OpportunityResource> {
  return withReadTransaction(pool, async (connection) => {
    const row = await selectOpportunity(connection, userId, publicId);
    if (!row) {
      throw new ApiError(404, 'NOT_FOUND', 'The requested resource was not found.');
    }
    return mapOpportunity(row, await selectChildren(connection, row.id));
  });
}

export async function createOpportunity(
  pool: Pool,
  userId: string,
  input: OpportunityCreateInput,
): Promise<OpportunityResource> {
  if (input.activities.some((activity) => activity.type === SYSTEM_ACTIVITY_TYPE)) {
    throw new ApiError(422, 'SYSTEM_ACTIVITY_IMMUTABLE', 'Status-change activities are created by the server.');
  }
  const publicId = input.id ?? randomUUID();

  return withWriteTransaction(pool, async (connection) => {
    // Lock the owning user to serialize append-position allocation for creates.
    const [users] = await connection.execute<RowDataPacket[]>(
      'SELECT id FROM users WHERE id = ? FOR UPDATE',
      [userId],
    );
    if (!users[0]) {
      throw new ApiError(401, 'UNAUTHORIZED', 'Authentication required.');
    }

    const [positions] = await connection.execute<PositionRow[]>(
      'SELECT COALESCE(MAX(`position`) + 1, 0) AS next_position FROM opportunities WHERE user_id = ?',
      [userId],
    );
    const position = safeInteger(positions[0]?.next_position ?? 0, 'opportunity position');

    const compensationDetails = input.compensationDetails ?? null;
    await connection.execute<ResultSetHeader>(
      'INSERT INTO opportunities (user_id, public_id, `position`, title, company, `type`, `status`, `priority`, `url`, deadline, follow_up_date, department, team, workplace_type, employment_type, posted_date, compensation_min, compensation_max, compensation_currency, compensation_interval, compensation, description, notes, is_demo, `version`, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))',
      [
        userId,
        publicId,
        position,
        input.title,
        input.company,
        input.type,
        input.status,
        input.priority,
        input.url,
        dbDate(input.deadline),
        dbDate(input.followUpDate),
        input.department ?? '',
        input.team ?? '',
        input.workplaceType ?? '',
        input.employmentType ?? '',
        dbDate(input.postedDate ?? ''),
        compensationDetails?.minAmount || null,
        compensationDetails?.maxAmount || null,
        compensationDetails?.currency || null,
        compensationDetails?.interval || null,
        input.compensation,
        input.description,
        input.notes,
      ],
    );
    const row = await selectOpportunity(connection, userId, publicId);
    if (!row) throw new Error('Inserted opportunity could not be read.');
    await replaceNestedCollections(connection, row.id, input);
    await incrementRevision(connection, userId);
    return mapOpportunity(row, await selectChildren(connection, row.id));
  });
}

export async function updateOpportunity(
  pool: Pool,
  userId: string,
  publicId: string,
  expectedVersion: number,
  input: OpportunityUpdateInput,
  statusActivityDate?: string,
): Promise<OpportunityResource> {
  if (input.id !== publicId) {
    throw validationError('opportunity.id', 'must match the opportunity ID in the request path');
  }

  return withWriteTransaction(pool, async (connection) => {
    const current = await selectOpportunity(connection, userId, publicId, true);
    if (!current) {
      throw new ApiError(404, 'NOT_FOUND', 'The requested resource was not found.');
    }

    const currentVersion = safeInteger(current.version, 'version');
    if (currentVersion !== expectedVersion) {
      throw new ApiError(
        409,
        'STALE_VERSION',
        'This opportunity changed since you loaded it.',
        { id: publicId, expectedVersion, currentVersion },
      );
    }

    const existingActivities = await selectActivities(connection, current.id);
    assertSystemActivitiesPreserved(input.activities, existingActivities);

    if (input.status !== current.status && !statusActivityDate) {
      throw validationError(
        'statusActivityDate',
        'is required when the opportunity status changes',
      );
    }

    const compensationDetails = input.compensationDetails === undefined
      ? {
          minAmount: current.compensation_min === null ? '' : canonicalDecimal(current.compensation_min),
          maxAmount: current.compensation_max === null ? '' : canonicalDecimal(current.compensation_max),
          currency: current.compensation_currency ?? '',
          interval: current.compensation_interval ?? '',
        }
      : input.compensationDetails;
    await connection.execute<ResultSetHeader>(
      'UPDATE opportunities SET title = ?, company = ?, `type` = ?, `status` = ?, `priority` = ?, `url` = ?, deadline = ?, follow_up_date = ?, department = ?, team = ?, workplace_type = ?, employment_type = ?, posted_date = ?, compensation_min = ?, compensation_max = ?, compensation_currency = ?, compensation_interval = ?, compensation = ?, description = ?, notes = ?, `version` = `version` + 1, updated_at = UTC_TIMESTAMP(3) WHERE id = ? AND user_id = ? AND deleted_at IS NULL',
      [
        input.title,
        input.company,
        input.type,
        input.status,
        input.priority,
        input.url,
        dbDate(input.deadline),
        dbDate(input.followUpDate),
        input.department ?? current.department ?? '',
        input.team ?? current.team ?? '',
        input.workplaceType ?? current.workplace_type ?? '',
        input.employmentType ?? current.employment_type ?? '',
        input.postedDate === undefined ? current.posted_date : dbDate(input.postedDate),
        compensationDetails?.minAmount || null,
        compensationDetails?.maxAmount || null,
        compensationDetails?.currency || null,
        compensationDetails?.interval || null,
        input.compensation,
        input.description,
        input.notes,
        current.id,
        userId,
      ],
    );

    await replaceNestedCollections(connection, current.id, input);

    if (input.status !== current.status) {
      await appendStatusActivity(
        connection,
        current.id,
        current.status,
        input.status,
        statusActivityDate as string,
      );
    }
    await incrementRevision(connection, userId);

    const updated = await selectOpportunity(connection, userId, publicId);
    if (!updated) throw new Error('Updated opportunity could not be read.');
    return mapOpportunity(updated, await selectChildren(connection, updated.id));
  });
}

export async function deleteOpportunity(
  pool: Pool,
  userId: string,
  publicId: string,
  expectedVersion: number,
): Promise<{
  deletionBatchId: string;
  expiresAt: string;
  deleted: Array<{ id: string; version: number }>;
}> {
  return withWriteTransaction(pool, async (connection) => {
    const current = await selectOpportunity(connection, userId, publicId, true);
    if (!current) {
      throw new ApiError(404, 'NOT_FOUND', 'The requested resource was not found.');
    }

    const currentVersion = safeInteger(current.version, 'version');
    if (currentVersion !== expectedVersion) {
      throw new ApiError(
        409,
        'STALE_VERSION',
        'This opportunity changed since you loaded it.',
        { id: publicId, expectedVersion, currentVersion },
      );
    }

    const deletionBatchId = randomUUID();
    await connection.execute<ResultSetHeader>(
      'INSERT INTO opportunity_deletions (id, user_id, created_at, expires_at) VALUES (?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3) + INTERVAL 10 SECOND)',
      [deletionBatchId, userId],
    );
    await connection.execute<ResultSetHeader>(
      'UPDATE opportunities SET deleted_at = UTC_TIMESTAMP(3), deleted_batch_id = ?, `version` = `version` + 1, updated_at = UTC_TIMESTAMP(3) WHERE id = ? AND user_id = ? AND deleted_at IS NULL',
      [deletionBatchId, current.id, userId],
    );

    const [expiryRows] = await connection.execute<DeletionRow[]>(
      'SELECT expires_at FROM opportunity_deletions WHERE id = ? AND user_id = ?',
      [deletionBatchId, userId],
    );
    if (!expiryRows[0]) throw new Error('Deletion batch could not be read.');
    await incrementRevision(connection, userId);

    return {
      deletionBatchId,
      expiresAt: isoTimestamp(expiryRows[0].expires_at, 'deletion batch expires_at'),
      deleted: [{ id: publicId, version: currentVersion + 1 }],
    };
  });
}

export async function setOpportunityArchived(
  pool: Pool,
  userId: string,
  publicId: string,
  expectedVersion: number,
  archived: boolean,
): Promise<OpportunityResource> {
  return withWriteTransaction(pool, async (connection) => {
    const current = await selectOpportunity(connection, userId, publicId, true);
    if (!current) {
      throw new ApiError(404, 'NOT_FOUND', 'The requested resource was not found.');
    }

    const currentVersion = safeInteger(current.version, 'version');
    if (currentVersion !== expectedVersion) {
      throw new ApiError(
        409,
        'STALE_VERSION',
        'This opportunity changed since you loaded it.',
        { id: publicId, expectedVersion, currentVersion },
      );
    }

    const isArchived = current.archived_at !== null;
    if (isArchived === archived) {
      return mapOpportunity(current, await selectChildren(connection, current.id));
    }

    await connection.execute<ResultSetHeader>(
      `UPDATE opportunities
       SET archived_at = ${archived ? 'UTC_TIMESTAMP(3)' : 'NULL'},
           \`version\` = \`version\` + 1,
           updated_at = UTC_TIMESTAMP(3)
       WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
      [current.id, userId],
    );
    await incrementRevision(connection, userId);

    const updated = await selectOpportunity(connection, userId, publicId);
    if (!updated) throw new Error('Updated opportunity could not be read.');
    return mapOpportunity(updated, await selectChildren(connection, updated.id));
  });
}

interface LockedBulkOpportunity { item: BulkItem; row: OpportunityRow }
function bulkConflict(failures: Array<Record<string, unknown>>): never {
  throw new ApiError(409,'BULK_CONFLICT','One or more opportunities changed or no longer match the requested action.',{failures});
}
async function lockBulkOpportunities(c:PoolConnection,u:string,items:readonly BulkItem[]):Promise<LockedBulkOpportunity[]> {
  const locked:LockedBulkOpportunity[]=[]; const failures:Array<Record<string,unknown>>=[];
  for(const item of [...items].sort((a,b)=>a.id.localeCompare(b.id))){
    const row=await selectOpportunity(c,u,item.id,true);
    if(!row){failures.push({id:item.id,reason:'not_found'});continue;}
    const version=safeInteger(row.version,'version');
    if(version!==item.expectedVersion){failures.push({id:item.id,reason:'stale_version',expectedVersion:item.expectedVersion,currentVersion:version});continue;}
    locked.push({item,row});
  }
  if(failures.length)bulkConflict(failures); return locked;
}
async function dbNow(c:PoolConnection):Promise<string>{
  const [rows]=await c.execute<UtcNowRow[]>('SELECT UTC_TIMESTAMP(3) AS now_utc');
  if(!rows[0])throw new Error('Database UTC time unavailable.');
  const date=parseUtcDateTime(rows[0].now_utc);
  if(Number.isNaN(date.getTime()))throw new Error('Invalid database UTC time.');
  return date.toISOString().slice(0,23).replace('T',' ');
}
function dbDateTime(value:string|null):string|null{
  if(value===null)return null;const date=parseUtcDateTime(value);
  if(Number.isNaN(date.getTime()))throw new Error('Invalid archive timestamp.');
  return date.toISOString().slice(0,23).replace('T',' ');
}
function assertBulkState(locked:readonly LockedBulkOpportunity[],test:(r:OpportunityRow)=>boolean,reason:string):void{
  const failures=locked.filter(x=>!test(x.row)).map(x=>({id:x.item.id,reason}));
  if(failures.length)bulkConflict(failures);
}
async function bulkResources(c:PoolConnection,u:string,locked:readonly LockedBulkOpportunity[]):Promise<OpportunityResource[]>{
  const out:OpportunityResource[]=[];
  for(const entry of locked){const row=await selectOpportunity(c,u,entry.item.id);if(!row)throw new Error('Updated opportunity missing.');
    out.push(mapOpportunity(row,await selectChildren(c,row.id)));}
  return out;
}
export async function bulkArchiveOpportunities(pool:Pool,userId:string,items:readonly BulkItem[]):Promise<{revision:number;items:OpportunityResource[]}>{
 return withWriteTransaction(pool,async c=>{const locked=await lockBulkOpportunities(c,userId,items);
  assertBulkState(locked,r=>r.archived_at===null,'already_archived');const now=await dbNow(c);
  for(const {row} of locked)await c.execute('UPDATE opportunities SET archived_at=?, `version`=`version`+1, updated_at=? WHERE id=? AND user_id=? AND deleted_at IS NULL',[now,now,row.id,userId]);
  await incrementRevision(c,userId);return {revision:await readRevision(c,userId),items:await bulkResources(c,userId,locked)};});
}
export async function bulkRestoreOpportunities(pool:Pool,userId:string,items:readonly BulkItem[]):Promise<{revision:number;items:OpportunityResource[]}>{
 return withWriteTransaction(pool,async c=>{const locked=await lockBulkOpportunities(c,userId,items);
  assertBulkState(locked,r=>r.archived_at!==null,'already_active');const now=await dbNow(c);
  for(const {row} of locked)await c.execute('UPDATE opportunities SET archived_at=NULL, `version`=`version`+1, updated_at=? WHERE id=? AND user_id=? AND deleted_at IS NULL',[now,row.id,userId]);
  await incrementRevision(c,userId);return {revision:await readRevision(c,userId),items:await bulkResources(c,userId,locked)};});
}
export async function bulkUpdateOpportunityStatus(pool:Pool,userId:string,input:BulkStatusBody):Promise<{revision:number;items:OpportunityResource[]}>{
 return withWriteTransaction(pool,async c=>{const locked=await lockBulkOpportunities(c,userId,input.items);
  assertBulkState(locked,r=>r.status!==input.status,'status_unchanged');const now=await dbNow(c);
  for(const {row} of locked){await c.execute('UPDATE opportunities SET `status`=?, `version`=`version`+1, updated_at=? WHERE id=? AND user_id=? AND deleted_at IS NULL',[input.status,now,row.id,userId]);
   await appendStatusActivity(c,row.id,row.status,input.status,input.statusActivityDate);}
  await incrementRevision(c,userId);return {revision:await readRevision(c,userId),items:await bulkResources(c,userId,locked)};});
}
export async function bulkDeleteOpportunities(pool:Pool,userId:string,items:readonly BulkItem[],archiveView:'active'|'archived'):Promise<{deletionBatchId:string;expiresAt:string;deleted:Array<{id:string;version:number}>}>{
 return withWriteTransaction(pool,async c=>{const locked=await lockBulkOpportunities(c,userId,items);
  assertBulkState(locked,r=>archiveView==='archived'?r.archived_at!==null:r.archived_at===null,'archive_view_mismatch');
  const deletionBatchId=randomUUID();const now=await dbNow(c);
  await c.execute('INSERT INTO opportunity_deletions (id,user_id,created_at,expires_at) VALUES (?, ?, ?, DATE_ADD(?, INTERVAL 10 SECOND))',[deletionBatchId,userId,now,now]);
  for(const {row} of locked)await c.execute('UPDATE opportunities SET deleted_at=?,deleted_batch_id=?, `version`=`version`+1,updated_at=? WHERE id=? AND user_id=? AND deleted_at IS NULL',[now,deletionBatchId,now,row.id,userId]);
  const [expiry]=await c.execute<DeletionRow[]>('SELECT expires_at FROM opportunity_deletions WHERE id=? AND user_id=?',[deletionBatchId,userId]);
  if(!expiry[0])throw new Error('Deletion batch missing.');await incrementRevision(c,userId);
  return {deletionBatchId,expiresAt:isoTimestamp(expiry[0].expires_at,'expires_at'),deleted:locked.map(x=>({id:x.item.id,version:safeInteger(x.row.version,'version')+1}))};});
}
export async function bulkUndoArchive(pool:Pool,userId:string,input:BulkUndoArchiveBody):Promise<{revision:number;items:OpportunityResource[]}>{
 return withWriteTransaction(pool,async c=>{const locked:Array<{item:UndoArchiveItem;row:OpportunityRow}>=[];const failures:Array<Record<string,unknown>>=[];
  for(const item of [...input.items].sort((a,b)=>a.id.localeCompare(b.id))){const row=await selectOpportunity(c,userId,item.id,true);
   if(!row){failures.push({id:item.id,reason:'not_found'});continue;}
   const current=row.archived_at?isoTimestamp(row.archived_at,'archived_at'):null;
   const expected=item.expectedArchivedAt?new Date(item.expectedArchivedAt).toISOString():null;
   if(current!==expected){failures.push({id:item.id,reason:'archive_state_changed'});continue;}locked.push({item,row});}
  if(failures.length)bulkConflict(failures);const now=await dbNow(c);
  for(const {item,row} of locked)await c.execute('UPDATE opportunities SET archived_at=?, `version`=`version`+1,updated_at=? WHERE id=? AND user_id=? AND deleted_at IS NULL',[dbDateTime(item.previousArchivedAt),now,row.id,userId]);
  await incrementRevision(c,userId);const out:OpportunityResource[]=[];
  for(const {item} of locked){const row=await selectOpportunity(c,userId,item.id);if(!row)throw new Error('Updated opportunity missing.');out.push(mapOpportunity(row,await selectChildren(c,row.id)));}
  return {revision:await readRevision(c,userId),items:out};});
}
export async function restoreDeletionBatch(pool:Pool,userId:string,batchId:string):Promise<{revision:number;items:OpportunityResource[]}>{
 return withWriteTransaction(pool,async c=>{const [batches]=await c.execute<DeletionBatchRow[]>('SELECT expires_at,restored_at FROM opportunity_deletions WHERE id=? AND user_id=? FOR UPDATE',[batchId,userId]);
  const batch=batches[0];if(!batch)throw new ApiError(404,'NOT_FOUND','The requested resource was not found.');
  if(batch.restored_at!==null)throw new ApiError(409,'ALREADY_RESTORED','This deletion batch has already been restored.');
  const now=await dbNow(c);const expiry=parseUtcDateTime(batch.expires_at);const databaseClock=parseUtcDateTime(now);
  if(Number.isNaN(expiry.getTime())||Number.isNaN(databaseClock.getTime())||expiry.getTime()<=databaseClock.getTime())throw new ApiError(410,'DELETION_EXPIRED','The deletion Undo window has expired.');
  const [rows]=await c.execute<OpportunityRow[]>('SELECT * FROM opportunities WHERE user_id=? AND deleted_batch_id=? AND deleted_at IS NOT NULL ORDER BY public_id FOR UPDATE',[userId,batchId]);
  if(!rows.length)throw new ApiError(404,'NOT_FOUND','The requested resource was not found.');
  for(const row of rows)await c.execute('UPDATE opportunities SET deleted_at=NULL,deleted_batch_id=NULL, `version`=`version`+1,updated_at=? WHERE id=? AND user_id=? AND deleted_batch_id=?',[now,row.id,userId,batchId]);
  await c.execute('UPDATE opportunity_deletions SET restored_at=? WHERE id=? AND user_id=? AND restored_at IS NULL',[now,batchId,userId]);
  await incrementRevision(c,userId);const out:OpportunityResource[]=[];
  for(const row of rows){const current=await selectOpportunity(c,userId,row.public_id);if(!current)throw new Error('Restored opportunity missing.');out.push(mapOpportunity(current,await selectChildren(c,current.id)));}
  return {revision:await readRevision(c,userId),items:out};});
}
