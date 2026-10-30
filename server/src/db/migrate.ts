import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LAUNCHBOARD_DATABASE } from '../config/env.js';

export const DEFAULT_MIGRATIONS_DIRECTORY = fileURLToPath(
  new URL('../../database/migrations', import.meta.url),
);

const MIGRATION_FILE_PATTERN = /^(\d{3,})_([a-z0-9_]+)\.sql$/;
const MAX_VERSION_LENGTH = 50;

export type MigrationErrorCode =
  | 'LOAD_FAILED'
  | 'CONNECTION_FAILED'
  | 'TARGET_MISMATCH'
  | 'SCHEMA_TABLE_INVALID'
  | 'CHECKSUM_MISMATCH'
  | 'MISSING_APPLIED_MIGRATION'
  | 'APPLY_FAILED';

/** A safe migration failure. Messages never contain credentials or driver text. */
export class MigrationError extends Error {
  readonly code: MigrationErrorCode;
  readonly version?: string;

  constructor(code: MigrationErrorCode, message: string, version?: string) {
    super(message);
    this.name = 'MigrationError';
    this.code = code;
    this.version = version;
  }
}

export interface MigrationFile {
  version: string;
  fileName: string;
  sql: string;
  checksum: string;
}

export interface MigrationConnection {
  query(sql: string, values?: unknown[]): Promise<[unknown, unknown]>;
  execute(sql: string, values?: unknown[]): Promise<[unknown, unknown]>;
  release(): void;
}

export interface MigrationPool {
  getConnection(): Promise<MigrationConnection>;
}

export interface MigrationOptions {
  migrationsDirectory?: string;
  log?: (message: string) => void;
}

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

const CREATE_SCHEMA_MIGRATIONS_SQL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version VARCHAR(50) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  checksum CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  applied_at DATETIME(3) NOT NULL,
  PRIMARY KEY (version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`.trim();

/** Normalizes line endings before hashing so CRLF and LF checkouts agree. */
export function checksumSql(sql: string): string {
  return createHash('sha256')
    .update(sql.replace(/\r\n/g, '\n'))
    .digest('hex');
}

/**
 * Splits a migration file into individual statements without enabling
 * `multipleStatements` on any connection. Quotes, doubled quotes, backslash
 * escapes, line comments and block comments are respected.
 */
export function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let quote: "'" | '"' | '`' | null = null;
  let inLineComment = false;
  let inBlockComment = false;

  for (let index = 0; index < sql.length; index += 1) {
    const character = sql[index]!;
    const next = sql[index + 1];

    if (inLineComment) {
      if (character === '\n') {
        inLineComment = false;
        current += ' ';
      }
      continue;
    }

    if (inBlockComment) {
      if (character === '*' && next === '/') {
        inBlockComment = false;
        current += ' ';
        index += 1;
      }
      continue;
    }

    if (quote !== null) {
      current += character;
      if (character === '\\' && quote !== '`' && next !== undefined) {
        current += next;
        index += 1;
        continue;
      }
      if (character === quote) {
        if (next === quote) {
          current += next;
          index += 1;
          continue;
        }
        quote = null;
      }
      continue;
    }

    if (character === "'" || character === '"' || character === '`') {
      quote = character;
      current += character;
      continue;
    }
    if (character === '-' && next === '-') {
      inLineComment = true;
      index += 1;
      continue;
    }
    if (character === '#') {
      inLineComment = true;
      continue;
    }
    if (character === '/' && next === '*') {
      inBlockComment = true;
      index += 1;
      continue;
    }
    if (character === ';') {
      const statement = current.trim();
      if (statement.length > 0) statements.push(statement);
      current = '';
      continue;
    }

    current += character;
  }

  if (quote !== null || inBlockComment) {
    throw new Error('Unterminated SQL quote or block comment.');
  }

  const finalStatement = current.trim();
  if (finalStatement.length > 0) statements.push(finalStatement);
  return statements;
}

/**
 * Loads `.sql` files in filename order. A `.sql` file whose name does not match
 * the numeric-prefix convention is an error rather than being skipped silently.
 */
export async function loadMigrations(
  directory: string = DEFAULT_MIGRATIONS_DIRECTORY,
): Promise<MigrationFile[]> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    throw new MigrationError(
      'LOAD_FAILED',
      'Could not read the migrations directory.',
    );
  }

  const fileNames = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .map((entry) => entry.name);

  const migrations: MigrationFile[] = [];
  for (const fileName of fileNames) {
    const match = MIGRATION_FILE_PATTERN.exec(fileName);
    if (!match) {
      throw new MigrationError(
        'LOAD_FAILED',
        `Migration file name is not supported: ${fileName}.`,
      );
    }

    const version = fileName.slice(0, -'.sql'.length);
    if (version.length > MAX_VERSION_LENGTH) {
      throw new MigrationError(
        'LOAD_FAILED',
        `Migration version is longer than ${MAX_VERSION_LENGTH} characters: ${fileName}.`,
      );
    }

    let sql: string;
    try {
      sql = await readFile(join(directory, fileName), 'utf8');
    } catch {
      throw new MigrationError(
        'LOAD_FAILED',
        `Could not read migration file ${fileName}.`,
      );
    }

    migrations.push({
      version,
      fileName,
      sql,
      checksum: checksumSql(sql),
    });
  }

  if (migrations.length === 0) {
    throw new MigrationError(
      'LOAD_FAILED',
      'No migration files were found.',
    );
  }

  migrations.sort((left, right) =>
    left.fileName < right.fileName ? -1 : left.fileName > right.fileName ? 1 : 0,
  );

  const versions = new Set<string>();
  const numericPrefixes = new Set<string>();
  for (const migration of migrations) {
    if (versions.has(migration.version)) {
      throw new MigrationError(
        'LOAD_FAILED',
        `Duplicate migration version: ${migration.version}.`,
      );
    }
    versions.add(migration.version);

    const prefix = migration.fileName.split('_')[0]!;
    if (numericPrefixes.has(prefix)) {
      throw new MigrationError(
        'LOAD_FAILED',
        `Duplicate migration number: ${prefix}.`,
      );
    }
    numericPrefixes.add(prefix);
  }

  return migrations;
}

function selectedDatabase(rows: unknown): string | null {
  if (!Array.isArray(rows)) return null;
  const first: unknown = rows[0];
  if (typeof first !== 'object' || first === null) return null;
  const value = (first as { db?: unknown }).db;
  return typeof value === 'string' ? value : null;
}

function appliedRows(rows: unknown): Array<{ version: string; checksum: string }> {
  if (!Array.isArray(rows)) {
    throw new MigrationError(
      'SCHEMA_TABLE_INVALID',
      'The schema_migrations table did not return rows.',
    );
  }

  const result: Array<{ version: string; checksum: string }> = [];
  for (const row of rows) {
    if (typeof row !== 'object' || row === null) {
      throw new MigrationError(
        'SCHEMA_TABLE_INVALID',
        'The schema_migrations table has an unexpected row shape.',
      );
    }
    const version = (row as { version?: unknown }).version;
    const checksum = (row as { checksum?: unknown }).checksum;
    if (typeof version !== 'string' || typeof checksum !== 'string') {
      throw new MigrationError(
        'SCHEMA_TABLE_INVALID',
        'The schema_migrations table must contain version and checksum columns. Restore the expected table before retrying.',
      );
    }
    result.push({ version, checksum });
  }
  return result;
}

/**
 * Applies pending migrations in deterministic filename order and records each
 * one only after all of its statements succeed. MySQL/MariaDB DDL implicitly
 * commits, so a failed migration can leave completed objects behind; the error
 * message says so and the migration is never falsely recorded as applied.
 */
export async function runMigrations(
  pool: MigrationPool,
  options: MigrationOptions = {},
): Promise<MigrationResult> {
  const migrations = await loadMigrations(options.migrationsDirectory);
  const log = options.log ?? (() => undefined);

  let connection: MigrationConnection;
  try {
    connection = await pool.getConnection();
  } catch {
    throw new MigrationError(
      'CONNECTION_FAILED',
      'Could not connect to the configured database.',
    );
  }

  try {
    try {
      await connection.query("SET time_zone = '+00:00'");
    } catch {
      throw new MigrationError(
        'CONNECTION_FAILED',
        'Could not initialize the database session.',
      );
    }

    let databaseName: string | null;
    try {
      const [rows] = await connection.query('SELECT DATABASE() AS db');
      databaseName = selectedDatabase(rows);
    } catch {
      throw new MigrationError(
        'TARGET_MISMATCH',
        'Could not verify the selected database.',
      );
    }

    if (databaseName !== LAUNCHBOARD_DATABASE) {
      throw new MigrationError(
        'TARGET_MISMATCH',
        `Refusing to migrate: the selected database is not ${LAUNCHBOARD_DATABASE}.`,
      );
    }
    log(`Target verified: ${LAUNCHBOARD_DATABASE}`);

    try {
      await connection.query(CREATE_SCHEMA_MIGRATIONS_SQL);
    } catch {
      throw new MigrationError(
        'SCHEMA_TABLE_INVALID',
        'Could not create or verify the schema_migrations table.',
      );
    }

    let recorded: Array<{ version: string; checksum: string }>;
    try {
      const [rows] = await connection.query(
        'SELECT version, checksum FROM schema_migrations ORDER BY version',
      );
      recorded = appliedRows(rows);
    } catch (error) {
      if (error instanceof MigrationError) throw error;
      throw new MigrationError(
        'SCHEMA_TABLE_INVALID',
        'The schema_migrations table must contain version and checksum columns. Restore the expected table before retrying.',
      );
    }

    const recordedByVersion = new Map(
      recorded.map((row) => [row.version, row.checksum]),
    );
    const filesByVersion = new Map(
      migrations.map((migration) => [migration.version, migration]),
    );

    for (const [version, checksum] of recordedByVersion) {
      const file = filesByVersion.get(version);
      if (file === undefined) {
        throw new MigrationError(
          'MISSING_APPLIED_MIGRATION',
          `Applied migration ${version} has no matching file. Restore the file or resolve the database state manually.`,
          version,
        );
      }
      if (file.checksum !== checksum) {
        throw new MigrationError(
          'CHECKSUM_MISMATCH',
          `Applied migration ${version} no longer matches its recorded checksum. Refusing to run.`,
          version,
        );
      }
    }

    const pending = migrations.filter(
      (migration) => !recordedByVersion.has(migration.version),
    );
    const skipped = migrations
      .filter((migration) => recordedByVersion.has(migration.version))
      .map((migration) => migration.version);
    const applied: string[] = [];

    for (const migration of pending) {
      let statements: string[];
      try {
        statements = splitSqlStatements(migration.sql);
      } catch {
        throw new MigrationError(
          'LOAD_FAILED',
          `Migration ${migration.version} contains an unterminated quote or block comment.`,
          migration.version,
        );
      }

      if (statements.length === 0) {
        throw new MigrationError(
          'APPLY_FAILED',
          `Migration ${migration.version} contains no executable statements.`,
          migration.version,
        );
      }

      for (let index = 0; index < statements.length; index += 1) {
        try {
          await connection.query(statements[index]!);
        } catch {
          throw new MigrationError(
            'APPLY_FAILED',
            `Migration ${migration.version} failed at statement ${index + 1} of ${statements.length}. It was not recorded. Review the database state, fix the cause, then re-run; do not drop tables unless you have confirmed the partial state.`,
            migration.version,
          );
        }
      }

      try {
        await connection.execute(
          'INSERT INTO schema_migrations (version, checksum, applied_at) VALUES (?, ?, UTC_TIMESTAMP(3))',
          [migration.version, migration.checksum],
        );
      } catch {
        throw new MigrationError(
          'APPLY_FAILED',
          `Migration ${migration.version} applied its schema statements but could not be recorded. Re-run after verifying the schema state.`,
          migration.version,
        );
      }

      applied.push(migration.version);
      log(`Applied ${migration.version}`);
    }

    return { applied, skipped };
  } finally {
    connection.release();
  }
}
