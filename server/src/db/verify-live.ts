import { randomUUID } from 'node:crypto';
import type {
  Pool,
  PoolConnection,
  ResultSetHeader,
  RowDataPacket,
} from 'mysql2/promise';
import { LAUNCHBOARD_DATABASE } from '../config/env.js';
import { DEFAULT_MIGRATIONS_DIRECTORY, loadMigrations } from './migrate.js';
import { acquireUtcConnection } from './pool.js';

/** Every table expected in the current Launchboard schema. */
export const REQUIRED_TABLES = [
  'users',
  'sessions',
  'auth_pre_sessions',
  'opportunity_deletions',
  'opportunities',
  'opportunity_locations',
  'opportunity_tags',
  'contacts',
  'interviews',
  'materials',
  'activities',
  'tasks',
  'schema_migrations',
] as const;

/** Raised when a live verification check fails. Messages never contain secrets. */
export class LiveVerificationError extends Error {
  readonly check: string;

  constructor(check: string, message: string) {
    super(message);
    this.name = 'LiveVerificationError';
    this.check = check;
  }
}

export interface TableInfo {
  name: string;
  engine: string | null;
  collation: string | null;
  rowFormat: string | null;
}

export interface ColumnInfo {
  table: string;
  name: string;
  dataType: string;
  collation: string | null;
  nullable: boolean;
  extra: string;
  charLength: number | null;
  precision: number | null;
  unsigned: boolean;
}

export interface IndexInfo {
  table: string;
  name: string;
  unique: boolean;
  columns: string[];
}

export interface ForeignKeyInfo {
  name: string;
  table: string;
  columns: string[];
  refTable: string;
  refColumns: string[];
  deleteRule: string;
}

export interface SchemaSnapshot {
  tables: TableInfo[];
  columns: ColumnInfo[];
  indexes: IndexInfo[];
  foreignKeys: ForeignKeyInfo[];
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === 'number') return value;
  // INFORMATION_SCHEMA exposes these as BIGINT, and the pool uses
  // `bigNumberStrings`, so numeric metadata can arrive as a string.
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/**
 * Reads metadata only for the `launchboard` schema. No other database is
 * queried, and no statement here modifies anything.
 */
export async function inspectSchema(
  connection: PoolConnection,
): Promise<SchemaSnapshot> {
  const [tableRows] = await connection.query<RowDataPacket[]>(
    `SELECT TABLE_NAME, ENGINE, TABLE_COLLATION, ROW_FORMAT
       FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA = ?
      ORDER BY TABLE_NAME`,
    [LAUNCHBOARD_DATABASE],
  );
  const [columnRows] = await connection.query<RowDataPacket[]>(
    `SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, COLLATION_NAME, IS_NULLABLE,
            EXTRA, CHARACTER_MAXIMUM_LENGTH, DATETIME_PRECISION, COLUMN_TYPE
       FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = ?
      ORDER BY TABLE_NAME, ORDINAL_POSITION`,
    [LAUNCHBOARD_DATABASE],
  );
  const [indexRows] = await connection.query<RowDataPacket[]>(
    `SELECT TABLE_NAME, INDEX_NAME, NON_UNIQUE, SEQ_IN_INDEX, COLUMN_NAME
       FROM INFORMATION_SCHEMA.STATISTICS
      WHERE TABLE_SCHEMA = ?
      ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX`,
    [LAUNCHBOARD_DATABASE],
  );
  const [foreignKeyRows] = await connection.query<RowDataPacket[]>(
    `SELECT k.CONSTRAINT_NAME, k.TABLE_NAME, k.COLUMN_NAME,
            k.REFERENCED_TABLE_NAME, k.REFERENCED_COLUMN_NAME,
            r.DELETE_RULE, k.ORDINAL_POSITION
       FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE k
       JOIN INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS r
         ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA
        AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME
      WHERE k.TABLE_SCHEMA = ? AND k.REFERENCED_TABLE_NAME IS NOT NULL
      ORDER BY k.TABLE_NAME, k.CONSTRAINT_NAME, k.ORDINAL_POSITION`,
    [LAUNCHBOARD_DATABASE],
  );

  const tables: TableInfo[] = tableRows.map((row) => ({
    name: String(row.TABLE_NAME),
    engine: typeof row.ENGINE === 'string' ? row.ENGINE : null,
    collation: typeof row.TABLE_COLLATION === 'string' ? row.TABLE_COLLATION : null,
    rowFormat: typeof row.ROW_FORMAT === 'string' ? row.ROW_FORMAT : null,
  }));

  const columns: ColumnInfo[] = columnRows.map((row) => ({
    table: String(row.TABLE_NAME),
    name: String(row.COLUMN_NAME),
    dataType: String(row.DATA_TYPE).toLowerCase(),
    collation:
      typeof row.COLLATION_NAME === 'string' ? row.COLLATION_NAME : null,
    nullable: String(row.IS_NULLABLE).toUpperCase() === 'YES',
    extra: String(row.EXTRA ?? '').toLowerCase(),
    charLength: numberOrNull(row.CHARACTER_MAXIMUM_LENGTH),
    precision: numberOrNull(row.DATETIME_PRECISION),
    unsigned: String(row.COLUMN_TYPE ?? '').includes('unsigned'),
  }));

  const indexMap = new Map<string, IndexInfo>();
  for (const row of indexRows) {
    const key = `${String(row.TABLE_NAME)}.${String(row.INDEX_NAME)}`;
    let index = indexMap.get(key);
    if (index === undefined) {
      index = {
        table: String(row.TABLE_NAME),
        name: String(row.INDEX_NAME),
        unique: Number(row.NON_UNIQUE) === 0,
        columns: [],
      };
      indexMap.set(key, index);
    }
    index.columns.push(String(row.COLUMN_NAME));
  }

  const foreignKeyMap = new Map<string, ForeignKeyInfo>();
  for (const row of foreignKeyRows) {
    const key = `${String(row.TABLE_NAME)}.${String(row.CONSTRAINT_NAME)}`;
    let foreignKey = foreignKeyMap.get(key);
    if (foreignKey === undefined) {
      foreignKey = {
        name: String(row.CONSTRAINT_NAME),
        table: String(row.TABLE_NAME),
        columns: [],
        refTable: String(row.REFERENCED_TABLE_NAME),
        refColumns: [],
        deleteRule: String(row.DELETE_RULE).toUpperCase(),
      };
      foreignKeyMap.set(key, foreignKey);
    }
    foreignKey.columns.push(String(row.COLUMN_NAME));
    foreignKey.refColumns.push(String(row.REFERENCED_COLUMN_NAME));
  }

  return {
    tables,
    columns,
    indexes: [...indexMap.values()],
    foreignKeys: [...foreignKeyMap.values()],
  };
}

/** Returns a list of human-readable failures; an empty list means success. */
export function evaluateSchema(snapshot: SchemaSnapshot): string[] {
  const failures: string[] = [];
  const tables = new Map(snapshot.tables.map((table) => [table.name, table]));
  const columns = new Map(
    snapshot.columns.map((column) => [`${column.table}.${column.name}`, column]),
  );
  const indexes = new Map(
    snapshot.indexes.map((index) => [`${index.table}.${index.name}`, index]),
  );
  const foreignKeys = new Map(
    snapshot.foreignKeys.map((foreignKey) => [
      `${foreignKey.table}.${foreignKey.name}`,
      foreignKey,
    ]),
  );

  for (const name of REQUIRED_TABLES) {
    const table = tables.get(name);
    if (table === undefined) {
      failures.push(`missing table ${name}`);
      continue;
    }
    if (table.engine !== 'InnoDB') {
      failures.push(`${name} engine is ${table.engine ?? 'unknown'}, expected InnoDB`);
    }
    if (table.collation !== 'utf8mb4_unicode_ci') {
      failures.push(
        `${name} collation is ${table.collation ?? 'unknown'}, expected utf8mb4_unicode_ci`,
      );
    }
  }

  const expectColumn = (
    table: string,
    name: string,
    expected: {
      dataType: string;
      charLength?: number;
      precision?: number;
      collation?: string | null;
      nullable?: boolean;
      unsigned?: boolean;
      autoIncrement?: boolean;
    },
  ): void => {
    const column = columns.get(`${table}.${name}`);
    if (column === undefined) {
      failures.push(`missing column ${table}.${name}`);
      return;
    }
    if (column.dataType !== expected.dataType) {
      failures.push(`${table}.${name} type is ${column.dataType}`);
    }
    if (expected.charLength !== undefined && column.charLength !== expected.charLength) {
      failures.push(`${table}.${name} length is ${column.charLength}`);
    }
    if (expected.precision !== undefined && column.precision !== expected.precision) {
      failures.push(`${table}.${name} precision is ${column.precision}`);
    }
    if (expected.collation !== undefined && column.collation !== expected.collation) {
      failures.push(`${table}.${name} collation is ${column.collation}`);
    }
    if (expected.nullable !== undefined && column.nullable !== expected.nullable) {
      failures.push(`${table}.${name} nullability is wrong`);
    }
    if (expected.unsigned !== undefined && column.unsigned !== expected.unsigned) {
      failures.push(`${table}.${name} unsigned flag is wrong`);
    }
    if (
      expected.autoIncrement !== undefined &&
      column.extra.includes('auto_increment') !== expected.autoIncrement
    ) {
      failures.push(`${table}.${name} auto_increment flag is wrong`);
    }
  };

  const expectIndex = (
    table: string,
    name: string,
    unique: boolean,
    expectedColumns: string[],
  ): void => {
    const index = indexes.get(`${table}.${name}`);
    if (index === undefined) {
      failures.push(`missing index ${table}.${name}`);
      return;
    }
    if (index.unique !== unique) {
      failures.push(`${table}.${name} uniqueness is wrong`);
    }
    if (index.columns.join(',') !== expectedColumns.join(',')) {
      failures.push(`${table}.${name} columns are ${index.columns.join(',')}`);
    }
  };

  const expectForeignKey = (
    table: string,
    name: string,
    expectedColumns: string[],
    refTable: string,
    refColumns: string[],
    deleteRule: string,
  ): void => {
    const foreignKey = foreignKeys.get(`${table}.${name}`);
    if (foreignKey === undefined) {
      failures.push(`missing foreign key ${table}.${name}`);
      return;
    }
    if (foreignKey.columns.join(',') !== expectedColumns.join(',')) {
      failures.push(`${table}.${name} columns are ${foreignKey.columns.join(',')}`);
    }
    if (foreignKey.refTable !== refTable) {
      failures.push(`${table}.${name} references ${foreignKey.refTable}`);
    }
    if (foreignKey.refColumns.join(',') !== refColumns.join(',')) {
      failures.push(`${table}.${name} references ${foreignKey.refColumns.join(',')}`);
    }
    if (foreignKey.deleteRule !== deleteRule) {
      failures.push(`${table}.${name} delete rule is ${foreignKey.deleteRule}`);
    }
  };

  // Identifier and audit columns.
  expectColumn('users', 'id', {
    dataType: 'char',
    charLength: 36,
    collation: 'ascii_bin',
    nullable: false,
  });
  expectColumn('users', 'email', {
    dataType: 'varchar',
    charLength: 254,
    collation: 'utf8mb4_unicode_ci',
    nullable: false,
  });
  expectColumn('users', 'created_at', {
    dataType: 'datetime',
    precision: 3,
    nullable: false,
  });
  expectColumn('users', 'updated_at', {
    dataType: 'datetime',
    precision: 3,
    nullable: false,
  });
  expectColumn('sessions', 'created_at', { dataType: 'datetime', precision: 3 });
  expectColumn('sessions', 'last_seen_at', { dataType: 'datetime', precision: 3 });
  expectColumn('auth_pre_sessions', 'id', {
    dataType: 'char',
    charLength: 36,
    collation: 'ascii_bin',
    nullable: false,
  });
  expectColumn('auth_pre_sessions', 'token_hash', {
    dataType: 'char',
    charLength: 64,
    collation: 'ascii_bin',
    nullable: false,
  });
  expectColumn('auth_pre_sessions', 'created_at', {
    dataType: 'datetime',
    precision: 3,
    nullable: false,
  });
  expectColumn('auth_pre_sessions', 'expires_at', {
    dataType: 'datetime',
    precision: 3,
    nullable: false,
  });
  expectColumn('auth_pre_sessions', 'consumed_at', {
    dataType: 'datetime',
    precision: 3,
    nullable: true,
  });
  expectColumn('auth_pre_sessions', 'revoked_at', {
    dataType: 'datetime',
    precision: 3,
    nullable: true,
  });
  expectColumn('sessions', 'expires_at', { dataType: 'datetime', precision: 3 });
  expectColumn('sessions', 'revoked_at', {
    dataType: 'datetime',
    precision: 3,
    nullable: true,
  });
  expectColumn('opportunity_deletions', 'created_at', {
    dataType: 'datetime',
    precision: 3,
  });
  expectColumn('opportunity_deletions', 'expires_at', {
    dataType: 'datetime',
    precision: 3,
  });
  expectColumn('opportunity_deletions', 'restored_at', {
    dataType: 'datetime',
    precision: 3,
    nullable: true,
  });
  expectColumn('opportunities', 'id', {
    dataType: 'bigint',
    unsigned: true,
    autoIncrement: true,
  });
  expectColumn('opportunities', 'department', {
    dataType: 'varchar', charLength: 160, nullable: false,
  });
  expectColumn('opportunities', 'team', {
    dataType: 'varchar', charLength: 160, nullable: false,
  });
  expectColumn('opportunities', 'workplace_type', {
    dataType: 'varchar', charLength: 8, collation: 'ascii_bin', nullable: false,
  });
  expectColumn('opportunities', 'employment_type', {
    dataType: 'varchar', charLength: 80, nullable: false,
  });
  expectColumn('opportunities', 'posted_date', {
    dataType: 'date', nullable: true,
  });
  expectColumn('opportunities', 'compensation_min', {
    dataType: 'decimal', nullable: true,
  });
  expectColumn('opportunities', 'compensation_max', {
    dataType: 'decimal', nullable: true,
  });
  expectColumn('opportunities', 'compensation_currency', {
    dataType: 'char', charLength: 3, collation: 'ascii_bin', nullable: true,
  });
  expectColumn('opportunities', 'compensation_interval', {
    dataType: 'varchar', charLength: 10, collation: 'ascii_bin', nullable: true,
  });
  expectColumn('opportunity_locations', 'id', {
    dataType: 'bigint', unsigned: true, autoIncrement: true, nullable: false,
  });
  expectColumn('opportunity_locations', 'opportunity_id', {
    dataType: 'bigint', unsigned: true, nullable: false,
  });
  expectColumn('opportunity_locations', 'position', {
    dataType: 'tinyint', unsigned: true, nullable: false,
  });
  expectColumn('opportunity_locations', 'location', {
    dataType: 'varchar', charLength: 160, nullable: false,
  });
  expectColumn('opportunities', 'deadline', {
    dataType: 'date',
    nullable: true,
  });
  expectColumn('opportunities', 'follow_up_date', {
    dataType: 'date',
    nullable: true,
  });
  expectColumn('opportunities', 'archived_at', {
    dataType: 'datetime',
    precision: 3,
    nullable: true,
  });
  expectColumn('opportunities', 'created_at', {
    dataType: 'datetime',
    precision: 3,
  });
  expectColumn('opportunities', 'updated_at', {
    dataType: 'datetime',
    precision: 3,
  });
  expectColumn('opportunities', 'deleted_at', {
    dataType: 'datetime',
    precision: 3,
    nullable: true,
  });
  expectColumn('interviews', 'date', { dataType: 'date', nullable: false });
  expectColumn('interviews', 'time', { dataType: 'time', nullable: true });
  expectColumn('interviews', 'contact_public_id', {
    dataType: 'varchar',
    charLength: 128,
    nullable: true,
  });
  expectColumn('activities', 'date', { dataType: 'date', nullable: false });
  expectColumn('tasks', 'id', {
    dataType: 'bigint',
    unsigned: true,
    autoIncrement: true,
    nullable: false,
  });
  expectColumn('tasks', 'opportunity_id', {
    dataType: 'bigint',
    unsigned: true,
    nullable: false,
  });
  expectColumn('tasks', 'public_id', {
    dataType: 'varchar',
    charLength: 128,
    collation: 'utf8mb4_bin',
    nullable: false,
  });
  expectColumn('tasks', 'position', {
    dataType: 'tinyint',
    unsigned: true,
    nullable: false,
  });
  expectColumn('tasks', 'title', {
    dataType: 'varchar',
    charLength: 160,
    nullable: false,
  });
  expectColumn('tasks', 'notes', { dataType: 'text', nullable: false });
  expectColumn('tasks', 'priority', {
    dataType: 'varchar',
    charLength: 8,
    collation: 'ascii_bin',
    nullable: false,
  });
  expectColumn('tasks', 'due_date', { dataType: 'date', nullable: true });
  expectColumn('tasks', 'completed', {
    dataType: 'tinyint',
    nullable: false,
  });
  expectColumn('tasks', 'completed_on', { dataType: 'date', nullable: true });
  expectColumn('schema_migrations', 'version', {
    dataType: 'varchar',
    charLength: 50,
    collation: 'ascii_bin',
  });
  expectColumn('schema_migrations', 'checksum', {
    dataType: 'char',
    charLength: 64,
    collation: 'ascii_bin',
  });
  expectColumn('schema_migrations', 'applied_at', {
    dataType: 'datetime',
    precision: 3,
  });

  // Primary keys and unique constraints.
  expectIndex('users', 'PRIMARY', true, ['id']);
  expectIndex('users', 'uq_users_email', true, ['email']);
  expectIndex('sessions', 'PRIMARY', true, ['id']);
  expectIndex('auth_pre_sessions', 'PRIMARY', true, ['id']);
  expectIndex('auth_pre_sessions', 'uq_auth_pre_sessions_token_hash', true, ['token_hash']);
  expectIndex('auth_pre_sessions', 'idx_auth_pre_sessions_expires_at', false, ['expires_at']);
  expectIndex('opportunity_deletions', 'PRIMARY', true, ['id']);
  expectIndex('opportunities', 'PRIMARY', true, ['id']);
  expectIndex('opportunities', 'uq_opportunities_user_public_id', true, [
    'user_id',
    'public_id',
  ]);
  expectIndex('opportunity_locations', 'PRIMARY', true, ['id']);
  expectIndex('opportunity_locations', 'uq_opportunity_locations_position', true, [
    'opportunity_id', 'position',
  ]);
  expectIndex('opportunity_locations', 'idx_opportunity_locations_parent', false, [
    'opportunity_id',
  ]);
  expectIndex('opportunity_tags', 'PRIMARY', true, ['opportunity_id', 'tag_key']);
  expectIndex('contacts', 'PRIMARY', true, ['id']);
  expectIndex('contacts', 'uq_contacts_opportunity_public_id', true, [
    'opportunity_id',
    'public_id',
  ]);
  expectIndex('interviews', 'PRIMARY', true, ['id']);
  expectIndex('interviews', 'uq_interviews_opportunity_public_id', true, [
    'opportunity_id',
    'public_id',
  ]);
  expectIndex('interviews', 'idx_interviews_contact', false, [
    'opportunity_id',
    'contact_public_id',
  ]);
  expectIndex('materials', 'PRIMARY', true, ['id']);
  expectIndex('materials', 'uq_materials_opportunity_public_id', true, [
    'opportunity_id',
    'public_id',
  ]);
  expectIndex('activities', 'PRIMARY', true, ['id']);
  expectIndex('activities', 'uq_activities_opportunity_public_id', true, [
    'opportunity_id',
    'public_id',
  ]);
  expectIndex('tasks', 'PRIMARY', true, ['id']);
  expectIndex('tasks', 'uq_tasks_opportunity_public_id', true, [
    'opportunity_id',
    'public_id',
  ]);
  expectIndex('tasks', 'uq_tasks_opportunity_position', true, [
    'opportunity_id',
    'position',
  ]);
  expectIndex('tasks', 'idx_tasks_opportunity_due', false, [
    'opportunity_id',
    'completed',
    'due_date',
    'position',
  ]);
  expectIndex('schema_migrations', 'PRIMARY', true, ['version']);

  // Foreign keys and their delete rules.
  expectForeignKey('sessions', 'fk_sessions_user', ['user_id'], 'users', ['id'], 'CASCADE');
  expectForeignKey(
    'opportunity_deletions',
    'fk_opportunity_deletions_user',
    ['user_id'],
    'users',
    ['id'],
    'CASCADE',
  );
  expectForeignKey(
    'opportunities',
    'fk_opportunities_user',
    ['user_id'],
    'users',
    ['id'],
    'CASCADE',
  );
  expectForeignKey(
    'opportunities',
    'fk_opportunities_deleted_batch',
    ['deleted_batch_id'],
    'opportunity_deletions',
    ['id'],
    'SET NULL',
  );
  expectForeignKey(
    'opportunity_locations',
    'fk_opportunity_locations_opportunity',
    ['opportunity_id'],
    'opportunities',
    ['id'],
    'CASCADE',
  );
  expectForeignKey(
    'opportunity_tags',
    'fk_opportunity_tags_opportunity',
    ['opportunity_id'],
    'opportunities',
    ['id'],
    'CASCADE',
  );
  expectForeignKey(
    'contacts',
    'fk_contacts_opportunity',
    ['opportunity_id'],
    'opportunities',
    ['id'],
    'CASCADE',
  );
  expectForeignKey(
    'interviews',
    'fk_interviews_opportunity',
    ['opportunity_id'],
    'opportunities',
    ['id'],
    'CASCADE',
  );
  expectForeignKey(
    'interviews',
    'fk_interviews_contact',
    ['opportunity_id', 'contact_public_id'],
    'contacts',
    ['opportunity_id', 'public_id'],
    'RESTRICT',
  );
  expectForeignKey(
    'materials',
    'fk_materials_opportunity',
    ['opportunity_id'],
    'opportunities',
    ['id'],
    'CASCADE',
  );
  expectForeignKey(
    'activities',
    'fk_activities_opportunity',
    ['opportunity_id'],
    'opportunities',
    ['id'],
    'CASCADE',
  );
  expectForeignKey(
    'tasks',
    'fk_tasks_opportunity',
    ['opportunity_id'],
    'opportunities',
    ['id'],
    'CASCADE',
  );

  return failures;
}

/**
 * Checks `SHOW GRANTS` output for the runtime account. The expected privileges
 * are data-only; any DDL, global or `GRANT OPTION` grant is a failure.
 */
export function evaluateGrants(grants: string[]): string[] {
  const failures: string[] = [];
  const allowed = new Set(['SELECT', 'INSERT', 'UPDATE', 'DELETE']);
  const granted = new Set<string>();
  let sawScopedGrant = false;

  for (const grant of grants) {
    const upper = grant.toUpperCase();
    if (upper.includes('WITH GRANT OPTION')) {
      failures.push('runtime account has GRANT OPTION');
    }

    const onIndex = upper.indexOf(' ON ');
    const toIndex = upper.indexOf(' TO ');
    if (onIndex < 0 || toIndex < 0) continue;

    const privileges = grant
      .slice(grant.indexOf('GRANT') + 'GRANT'.length, onIndex)
      .split(',')
      .map((privilege) => privilege.trim().toUpperCase())
      .filter((privilege) => privilege.length > 0);
    const scope = grant
      .slice(onIndex + ' ON '.length, toIndex)
      .replace(/`/g, '')
      .trim();

    if (scope === '*.*') {
      if (!(privileges.length === 1 && privileges[0] === 'USAGE')) {
        failures.push('runtime account has a global privilege');
      }
      continue;
    }

    if (scope !== `${LAUNCHBOARD_DATABASE}.*`) {
      failures.push(`runtime account has a privilege on ${scope}`);
      continue;
    }

    sawScopedGrant = true;
    for (const privilege of privileges) {
      if (allowed.has(privilege)) granted.add(privilege);
      else failures.push(`runtime account has unexpected privilege ${privilege}`);
    }
  }

  if (!sawScopedGrant) {
    failures.push(`runtime account has no privilege on ${LAUNCHBOARD_DATABASE}.*`);
  }
  for (const privilege of allowed) {
    if (!granted.has(privilege)) {
      failures.push(`runtime account is missing ${privilege}`);
    }
  }

  return failures;
}

/**
 * Removes password hashes from `SHOW GRANTS` output. MariaDB appends
 * `IDENTIFIED BY PASSWORD '<hash>'` to the USAGE grant; the hash is a
 * credential and must never be printed or stored.
 */
export function sanitizeGrant(grant: string): string {
  return grant
    .replace(/IDENTIFIED BY PASSWORD '[^']*'/gi, "IDENTIFIED BY PASSWORD '<redacted>'")
    .replace(/IDENTIFIED BY '[^']*'/gi, "IDENTIFIED BY '<redacted>'");
}

/** Returns the latest migration from the version-ordered history query. */
export function latestRecordedMigration(
  applied: readonly { version: string; checksum: string }[],
): { version: string; checksum: string } | null {
  return applied.length > 0 ? applied[applied.length - 1] ?? null : null;
}

export interface CascadeReport {
  /** Whether a single opportunity DELETE succeeded around the RESTRICT key. */
  rawDeleteSucceeded: boolean;
  /** The restrict error when the raw delete was blocked, otherwise null. */
  rawDeleteError: string | null;
  /** Result of the documented application-level deletion sequence. */
  safeSequenceDeleted: number;
  remainingInterviews: number;
  remainingContacts: number;
  remainingTags: number;
  remainingMaterials: number;
  remainingActivities: number;
  remainingLocations: number;
  userStillPresent: number;
}

interface ChildCounts {
  interviews: number;
  contacts: number;
  tags: number;
  materials: number;
  activities: number;
  locations: number;
}

const CHILD_COUNT_SQL = `
SELECT
  (SELECT COUNT(*) FROM interviews WHERE opportunity_id = ?) AS interviews,
  (SELECT COUNT(*) FROM contacts WHERE opportunity_id = ?) AS contacts,
  (SELECT COUNT(*) FROM opportunity_tags WHERE opportunity_id = ?) AS tags,
  (SELECT COUNT(*) FROM materials WHERE opportunity_id = ?) AS materials,
  (SELECT COUNT(*) FROM activities WHERE opportunity_id = ?) AS activities,
  (SELECT COUNT(*) FROM opportunity_locations WHERE opportunity_id = ?) AS locations
`;

function readCounts(row: RowDataPacket | undefined): ChildCounts {
  return {
    interviews: Number(row?.interviews ?? 0),
    contacts: Number(row?.contacts ?? 0),
    tags: Number(row?.tags ?? 0),
    materials: Number(row?.materials ?? 0),
    activities: Number(row?.activities ?? 0),
    locations: Number(row?.locations ?? 0),
  };
}

async function countChildren(
  connection: PoolConnection,
  opportunityId: number,
): Promise<ChildCounts> {
  const [rows] = await connection.execute<RowDataPacket[]>(CHILD_COUNT_SQL, [
    opportunityId,
    opportunityId,
    opportunityId,
    opportunityId,
    opportunityId,
    opportunityId,
  ]);
  return readCounts(rows[0]);
}

function isForeignKeyRestrictError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { errno?: unknown }).errno === 1451
  );
}

function describeRestrictError(error: unknown): string {
  const message =
    error instanceof Error ? error.message : 'foreign key restrict error';
  return message.replace(/\s+/g, ' ').slice(0, 400);
}

/**
 * Runs `run` inside a transaction and always rolls it back. Residue is checked
 * after rollback, and a failed rollback is reported prominently.
 */
async function withRollback<T>(
  connection: PoolConnection,
  userId: string,
  run: () => Promise<T>,
): Promise<T> {
  await connection.beginTransaction();

  let result: T | undefined;
  let failure: unknown;

  try {
    result = await run();
  } catch (error) {
    failure = error;
  }

  try {
    await connection.rollback();
  } catch {
    throw new LiveVerificationError(
      'ROLLBACK_FAILED',
      'Rollback failed; synthetic verification rows may remain and must be inspected.',
    );
  }

  const [rows] = await connection.execute<RowDataPacket[]>(
    'SELECT COUNT(*) AS present FROM users WHERE id = ?',
    [userId],
  );
  if (Number(rows[0]?.present ?? 0) !== 0) {
    throw new LiveVerificationError(
      'RESIDUE_DETECTED',
      'Synthetic verification rows remain after rollback and must be inspected.',
    );
  }

  if (failure !== undefined) throw failure;
  return result as T;
}

/** Inserts the synthetic fixture for one user and returns its opportunity id. */
async function insertFixture(
  connection: PoolConnection,
  userId: string,
): Promise<number> {
  const suffix = randomUUID();
  const publicId = `verify-${suffix}`;
  const contactPublicId = `verify-contact-${suffix}`;
  const email = `verify-${suffix}@example.invalid`;

  await connection.execute<ResultSetHeader>(
    `INSERT INTO users (id, email, password_hash, created_at, updated_at)
     VALUES (?, ?, 'verify-live-no-login', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
    [userId, email],
  );

  const [opportunityResult] = await connection.execute<ResultSetHeader>(
    `INSERT INTO opportunities
       (user_id, public_id, \`position\`, title, company, \`type\`, \`status\`,
        \`url\`, compensation, description, notes, created_at, updated_at)
     VALUES (?, ?, 0, 'Verify live', 'Verify live', 'Full-time', 'Saved',
             '', '', '', '', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
    [userId, publicId],
  );
  const opportunityId = opportunityResult.insertId;
  if (!Number.isInteger(opportunityId) || opportunityId <= 0) {
    throw new LiveVerificationError(
      'FIXTURE_FAILED',
      'Could not read the synthetic opportunity id.',
    );
  }

  await connection.execute(
    `INSERT INTO contacts (opportunity_id, public_id, \`position\`, \`name\`, notes)
     VALUES (?, ?, 0, 'Verify live', '')`,
    [opportunityId, contactPublicId],
  );
  await connection.execute(
    `INSERT INTO interviews
       (opportunity_id, public_id, \`position\`, \`round\`, \`date\`, \`time\`,
        \`mode\`, \`status\`, preparation_notes, notes, contact_public_id)
     VALUES (?, ?, 0, 'Technical', '2026-01-01', '10:00:00', 'Video',
             'Scheduled', '', '', ?)`,
    [opportunityId, `verify-interview-${suffix}`, contactPublicId],
  );
  await connection.execute(
    `INSERT INTO opportunity_locations (opportunity_id, \`position\`, location)
     VALUES (?, 0, ?)`,
    [opportunityId, `launchboard-live-verification-${suffix}`],
  );
  await connection.execute(
    `INSERT INTO opportunity_tags (opportunity_id, tag, tag_key, \`position\`)
     VALUES (?, 'Verify', 'verify', 0)`,
    [opportunityId],
  );
  await connection.execute(
    `INSERT INTO materials
       (opportunity_id, public_id, \`position\`, label, \`kind\`, \`status\`, notes)
     VALUES (?, ?, 0, 'Verify live', 'Resume', 'Draft', '')`,
    [opportunityId, `verify-material-${suffix}`],
  );
  await connection.execute(
    `INSERT INTO activities
       (opportunity_id, public_id, \`position\`, \`type\`, \`date\`, note)
     VALUES (?, ?, 0, 'Other', '2026-01-01', '')`,
    [opportunityId, `verify-activity-${suffix}`],
  );

  const before = await countChildren(connection, opportunityId);
  if (
    before.interviews !== 1 ||
    before.contacts !== 1 ||
    before.tags !== 1 ||
    before.materials !== 1 ||
    before.activities !== 1 ||
    before.locations !== 1
  ) {
    throw new LiveVerificationError(
      'FIXTURE_FAILED',
      'Synthetic fixtures were not all visible before deletion.',
    );
  }

  return opportunityId;
}

function assertChildrenRemoved(counts: ChildCounts): void {
  if (
    counts.interviews !== 0 ||
    counts.contacts !== 0 ||
    counts.tags !== 0 ||
    counts.materials !== 0 ||
    counts.activities !== 0 ||
    counts.locations !== 0
  ) {
    throw new LiveVerificationError(
      'CASCADE_FAILED',
      'Child rows remained after deleting the synthetic opportunity.',
    );
  }
}

/**
 * Independent safety net: confirms no synthetic fixture from any run remains.
 * This is a read-only query scoped to the launchboard schema.
 */
async function assertNoSyntheticResidue(
  connection: PoolConnection,
): Promise<void> {
  const [rows] = await connection.query<RowDataPacket[]>(
    `SELECT
       (SELECT COUNT(*) FROM users
         WHERE email LIKE 'verify-%@example.invalid') AS users,
       (SELECT COUNT(*) FROM opportunities
         WHERE public_id LIKE 'verify-%') AS opportunities,
       (SELECT COUNT(*) FROM opportunity_locations
         WHERE location LIKE 'launchboard-live-verification-%') AS locations`,
  );
  const users = Number(rows[0]?.users ?? 0);
  const opportunities = Number(rows[0]?.opportunities ?? 0);
  const locations = Number(rows[0]?.locations ?? 0);
  if (users > 0 || opportunities > 0 || locations > 0) {
    throw new LiveVerificationError(
      'RESIDUE_DETECTED',
      `Synthetic verification rows remain (users=${users}, opportunities=${opportunities}, locations=${locations}).`,
    );
  }
}

/**
 * Phase 1 records whether a single opportunity DELETE works when an interview
 * references a contact (RESTRICT). Phase 2 proves the documented application
 * sequence: delete interviews first, then the opportunity. Both transactions
 * are always rolled back; neither is ever committed.
 */
export async function runCascadeCheck(
  connection: PoolConnection,
): Promise<CascadeReport> {
  let rawDeleteSucceeded = false;
  let rawDeleteError: string | null = null;

  const rawUserId = randomUUID();
  try {
    await withRollback(connection, rawUserId, async () => {
      const opportunityId = await insertFixture(connection, rawUserId);
      const [result] = await connection.execute<ResultSetHeader>(
        'DELETE FROM opportunities WHERE id = ? AND user_id = ?',
        [opportunityId, rawUserId],
      );
      if (result.affectedRows !== 1) {
        throw new LiveVerificationError(
          'CASCADE_FAILED',
          `Expected to delete exactly one synthetic opportunity, deleted ${result.affectedRows}.`,
        );
      }
      assertChildrenRemoved(await countChildren(connection, opportunityId));
    });
    rawDeleteSucceeded = true;
  } catch (error) {
    if (!isForeignKeyRestrictError(error)) throw error;
    rawDeleteError = describeRestrictError(error);
  }

  const safeUserId = randomUUID();
  const safe = await withRollback(connection, safeUserId, async () => {
    const opportunityId = await insertFixture(connection, safeUserId);

    await connection.execute(
      'DELETE FROM interviews WHERE opportunity_id = ?',
      [opportunityId],
    );
    const [result] = await connection.execute<ResultSetHeader>(
      'DELETE FROM opportunities WHERE id = ? AND user_id = ?',
      [opportunityId, safeUserId],
    );
    if (result.affectedRows !== 1) {
      throw new LiveVerificationError(
        'CASCADE_FAILED',
        `Expected to delete exactly one synthetic opportunity, deleted ${result.affectedRows}.`,
      );
    }

    const counts = await countChildren(connection, opportunityId);
    assertChildrenRemoved(counts);

    const [userRows] = await connection.execute<RowDataPacket[]>(
      'SELECT COUNT(*) AS present FROM users WHERE id = ?',
      [safeUserId],
    );
    const userStillPresent = Number(userRows[0]?.present ?? 0);
    if (userStillPresent !== 1) {
      throw new LiveVerificationError(
        'CASCADE_FAILED',
        'Deleting the synthetic opportunity removed or changed its user.',
      );
    }

    return { deleted: result.affectedRows, counts, userStillPresent };
  });

  return {
    rawDeleteSucceeded,
    rawDeleteError,
    safeSequenceDeleted: safe.deleted,
    remainingInterviews: safe.counts.interviews,
    remainingContacts: safe.counts.contacts,
    remainingTags: safe.counts.tags,
    remainingMaterials: safe.counts.materials,
    remainingActivities: safe.counts.activities,
    remainingLocations: safe.counts.locations,
    userStillPresent: safe.userStillPresent,
  };
}

export interface LiveVerificationReport {
  database: string;
  version: string;
  sqlMode: string;
  defaultRowFormat: string | null;
  tables: TableInfo[];
  runtimeUser: string;
  grants: string[];
  migration: { version: string; checksum: string };
  cascade: CascadeReport;
}

export interface LiveVerificationOptions {
  expectedUser?: string;
  log?: (message: string) => void;
}

async function selectedDatabase(connection: PoolConnection): Promise<string | null> {
  const [rows] = await connection.query<RowDataPacket[]>(
    'SELECT DATABASE() AS db',
  );
  const value = rows[0]?.db;
  return typeof value === 'string' ? value : null;
}

/**
 * Full live check using runtime credentials: target guard, schema metadata,
 * migration history, runtime grants, and the transactional cascade test.
 */
export async function runLiveVerification(
  pool: Pool,
  options: LiveVerificationOptions = {},
): Promise<LiveVerificationReport> {
  const log = options.log ?? (() => {});
  const connection = await acquireUtcConnection(pool);

  try {
    const database = await selectedDatabase(connection);
    if (database !== LAUNCHBOARD_DATABASE) {
      throw new LiveVerificationError(
        'TARGET_MISMATCH',
        `Refusing to verify: selected database is not ${LAUNCHBOARD_DATABASE}.`,
      );
    }
    log(`Target verified: ${LAUNCHBOARD_DATABASE}`);

    const [factRows] = await connection.query<RowDataPacket[]>(
      'SELECT VERSION() AS version, @@SESSION.sql_mode AS sql_mode',
    );
    const version = String(factRows[0]?.version ?? 'unknown');
    const sqlMode = String(factRows[0]?.sql_mode ?? '');

    // TiDB does not expose every MySQL/InnoDB compatibility variable. Read
    // this optional diagnostic through SHOW VARIABLES so an absent variable
    // is reported as unknown instead of preventing schema verification.
    const [rowFormatRows] = await connection.query<RowDataPacket[]>(
      "SHOW VARIABLES LIKE 'innodb_default_row_format'",
    );
    const rowFormatValue = rowFormatRows[0]?.Value ?? rowFormatRows[0]?.value;
    const defaultRowFormat =
      typeof rowFormatValue === 'string' ? rowFormatValue : null;

    const snapshot = await inspectSchema(connection);
    const schemaFailures = evaluateSchema(snapshot);
    if (schemaFailures.length > 0) {
      throw new LiveVerificationError(
        'SCHEMA_MISMATCH',
        `Schema verification failed: ${schemaFailures.join('; ')}`,
      );
    }
    log(
      `Schema verified: ${snapshot.tables.length} tables, ` +
        `${snapshot.indexes.length} indexes, ` +
        `${snapshot.foreignKeys.length} foreign keys`,
    );

    const expected = await loadMigrations(DEFAULT_MIGRATIONS_DIRECTORY);
    const [appliedRows] = await connection.query<RowDataPacket[]>(
      'SELECT version, checksum FROM schema_migrations ORDER BY version',
    );
    const applied = appliedRows.map((row) => ({
      version: String(row.version),
      checksum: String(row.checksum),
    }));
    const historyFailures: string[] = [];
    for (const migration of expected) {
      const row = applied.find((entry) => entry.version === migration.version);
      if (row === undefined) {
        historyFailures.push(`migration ${migration.version} is not recorded`);
      } else if (row.checksum !== migration.checksum) {
        historyFailures.push(`migration ${migration.version} checksum does not match`);
      }
    }
    for (const row of applied) {
      if (!expected.some((migration) => migration.version === row.version)) {
        historyFailures.push(`unexpected migration ${row.version} is recorded`);
      }
    }
    if (historyFailures.length > 0) {
      throw new LiveVerificationError(
        'MIGRATION_HISTORY_MISMATCH',
        `Migration history verification failed: ${historyFailures.join('; ')}`,
      );
    }
    if (applied.length === 0) {
      throw new LiveVerificationError(
        'MIGRATION_HISTORY_MISMATCH',
        'No migration history was recorded.',
      );
    }
    const appliedMigration = latestRecordedMigration(applied)!;
    log(`Migration history verified: ${applied.map((migration) => migration.version).join(', ')}`);

    const [identityRows] = await connection.query<RowDataPacket[]>(
      'SELECT CURRENT_USER() AS account',
    );
    const runtimeUser = String(identityRows[0]?.account ?? '');
    if (
      options.expectedUser !== undefined &&
      !runtimeUser.startsWith(`${options.expectedUser}@`)
    ) {
      throw new LiveVerificationError(
        'RUNTIME_IDENTITY_MISMATCH',
        'The connection is not using the configured runtime account.',
      );
    }

    const [grantRows] = await connection.query<RowDataPacket[]>(
      'SHOW GRANTS FOR CURRENT_USER()',
    );
    const grants = grantRows.map((row) =>
      sanitizeGrant(String(Object.values(row)[0] ?? '')),
    );
    const grantFailures = evaluateGrants(grants);
    if (grantFailures.length > 0) {
      throw new LiveVerificationError(
        'RUNTIME_PRIVILEGES_MISMATCH',
        `Runtime privilege verification failed: ${grantFailures.join('; ')}`,
      );
    }
    log(`Runtime account verified: ${runtimeUser}`);

    const cascade = await runCascadeCheck(connection);
    await assertNoSyntheticResidue(connection);
    log(
      'Cascade verified: synthetic opportunity deleted, ' +
        'interview/contact/tag/material/activity cascaded, transaction rolled back, ' +
        'no synthetic residue found',
    );

    return {
      database,
      version,
      sqlMode,
      defaultRowFormat,
      tables: snapshot.tables,
      runtimeUser,
      grants,
      migration: appliedMigration,
      cascade,
    };
  } finally {
    connection.release();
  }
}
