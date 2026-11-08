import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  checksumSql,
  DEFAULT_MIGRATIONS_DIRECTORY,
  loadMigrations,
  MigrationError,
  runMigrations,
  splitSqlStatements,
  type MigrationConnection,
  type MigrationPool,
} from '../db/migrate.js';

interface FakeState {
  db: string | null;
  applied: Array<{ version: string; checksum: string }>;
  queries: string[];
  schemaStatements: string[];
  inserts: Array<{ version: string; checksum: string }>;
  failConnect?: boolean;
  failAppliedRead?: boolean;
  failStatement?: number;
  failInsert?: boolean;
  released?: boolean;
}

function createState(overrides: Partial<FakeState> = {}): FakeState {
  return {
    db: 'launchboard',
    applied: [],
    queries: [],
    schemaStatements: [],
    inserts: [],
    ...overrides,
  };
}

function createFakePool(state: FakeState): MigrationPool {
  const connection: MigrationConnection = {
    query: async (sql) => {
      state.queries.push(sql);
      if (sql.startsWith('SET time_zone')) return [[], []];
      if (sql.includes('SELECT DATABASE()')) return [[{ db: state.db }], []];
      if (sql.startsWith('CREATE TABLE IF NOT EXISTS schema_migrations')) {
        return [[], []];
      }
      if (sql.startsWith('SELECT version, checksum')) {
        if (state.failAppliedRead) throw new Error('read failed');
        return [state.applied.map((row) => ({ ...row })), []];
      }

      state.schemaStatements.push(sql);
      if (
        state.failStatement !== undefined &&
        state.schemaStatements.length === state.failStatement
      ) {
        throw new Error('statement failed');
      }
      return [[], []];
    },
    execute: async (_sql, values) => {
      if (state.failInsert) throw new Error('insert failed');
      const [version, checksum] = values as [string, string];
      state.inserts.push({ version, checksum });
      state.applied.push({ version, checksum });
      return [[], []];
    },
    release: () => {
      state.released = true;
    },
  };

  return {
    getConnection: async () => {
      if (state.failConnect) throw new Error('connect failed');
      return connection;
    },
  };
}

async function withMigrations(
  files: Record<string, string>,
  run: (directory: string) => Promise<void>,
): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), 'launchboard-migrations-'));
  try {
    for (const [name, sql] of Object.entries(files)) {
      writeFileSync(join(directory, name), sql);
    }
    await run(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe('SQL statement splitting', () => {
  it('keeps semicolons inside quoted values and splits statements', () => {
    expect(
      splitSqlStatements(
        "CREATE TABLE a (id INT);\n-- a comment with ;\nCREATE TABLE b (note TEXT DEFAULT 'a;b');",
      ),
    ).toEqual([
      'CREATE TABLE a (id INT)',
      "CREATE TABLE b (note TEXT DEFAULT 'a;b')",
    ]);
  });

  it('handles doubled quotes, backticks and block comments', () => {
    expect(
      splitSqlStatements(
        "INSERT INTO t VALUES ('it''s; fine'); /* ; */ SELECT `a;b` FROM t;",
      ),
    ).toEqual([
      "INSERT INTO t VALUES ('it''s; fine')",
      'SELECT `a;b` FROM t',
    ]);
  });

  it('rejects unterminated quotes', () => {
    expect(() => splitSqlStatements("SELECT 'unterminated;")).toThrow(
      'Unterminated SQL quote',
    );
  });
});

describe('checksum portability', () => {
  const lf = 'CREATE TABLE a (id INT);\nSELECT 1;\n';

  it('produces the same checksum for LF, CRLF and standalone CR', () => {
    expect(checksumSql(lf.replace(/\n/g, '\r\n'))).toBe(checksumSql(lf));
    expect(checksumSql(lf.replace(/\n/g, '\r'))).toBe(checksumSql(lf));
  });

  it('still distinguishes real SQL content changes', () => {
    expect(checksumSql(lf.replace('INT', 'BIGINT'))).not.toBe(checksumSql(lf));
  });
});

describe('migration loading', () => {
  it('loads files in deterministic filename order with normalized checksums', async () => {
    await withMigrations(
      {
        '002_second.sql': 'SELECT 2;\r\n',
        '001_first.sql': 'SELECT 1;\n',
      },
      async (directory) => {
        const migrations = await loadMigrations(directory);
        expect(migrations.map((migration) => migration.version)).toEqual([
          '001_first',
          '002_second',
        ]);
        expect(migrations[0]?.checksum).toBe(checksumSql('SELECT 1;\n'));
        expect(migrations[1]?.checksum).toBe(checksumSql('SELECT 2;\n'));
      },
    );
  });

  it('loads the additive structured Opportunity migration without changing prior migrations', async () => {
    const migrations = await loadMigrations(DEFAULT_MIGRATIONS_DIRECTORY);
    const migration = migrations.find((entry) => entry.version === '005_opportunity_job_details');
    expect(migration).toBeDefined();
    expect(migration?.fileName).toBe('005_opportunity_job_details.sql');

    const statements = splitSqlStatements(migration?.sql ?? '');
    expect(statements).toHaveLength(2);
    expect(statements[0]).toContain('ALTER TABLE opportunities');
    expect(statements[0]).toContain('ADD COLUMN department');
    expect(statements[0]).toContain('ADD COLUMN compensation_min');
    expect(statements[1]).toContain('CREATE TABLE opportunity_locations');
    expect(statements[1]).toContain('ON DELETE CASCADE');

    const prior = migrations.filter((entry) => ['001_initial_schema', '002_auth_pre_sessions', '003_email_verification_password_reset', '004_opportunity_tasks'].includes(entry.version));
    expect(prior).toHaveLength(4);
  });

  it('rejects unsupported filenames, duplicate numbers and an empty directory', async () => {
    await withMigrations({ 'initial.sql': 'SELECT 1;' }, async (directory) => {
      await expect(loadMigrations(directory)).rejects.toMatchObject({
        code: 'LOAD_FAILED',
      });
    });

    await withMigrations(
      { '001_a.sql': 'SELECT 1;', '001_b.sql': 'SELECT 2;' },
      async (directory) => {
        await expect(loadMigrations(directory)).rejects.toMatchObject({
          code: 'LOAD_FAILED',
        });
      },
    );

    await withMigrations({}, async (directory) => {
      await expect(loadMigrations(directory)).rejects.toMatchObject({
        code: 'LOAD_FAILED',
      });
    });
  });
});

describe('migration runner', () => {
  it('applies pending migrations in order and records checksums', async () => {
    await withMigrations(
      {
        '001_first.sql': 'CREATE TABLE first (id INT);\nCREATE TABLE first_child (id INT);',
        '002_second.sql': 'CREATE TABLE second (id INT);',
      },
      async (directory) => {
        const state = createState();
        const result = await runMigrations(createFakePool(state), {
          migrationsDirectory: directory,
        });

        expect(result).toEqual({
          applied: ['001_first', '002_second'],
          skipped: [],
        });
        expect(state.schemaStatements).toEqual([
          'CREATE TABLE first (id INT)',
          'CREATE TABLE first_child (id INT)',
          'CREATE TABLE second (id INT)',
        ]);
        expect(state.inserts.map((insert) => insert.version)).toEqual([
          '001_first',
          '002_second',
        ]);
        expect(state.inserts[0]?.checksum).toBe(
          checksumSql(
            'CREATE TABLE first (id INT);\nCREATE TABLE first_child (id INT);',
          ),
        );
        expect(state.released).toBe(true);
      },
    );
  });

  it('verifies the selected database before any DDL', async () => {
    await withMigrations(
      { '001_first.sql': 'CREATE TABLE first (id INT);' },
      async (directory) => {
        const state = createState({ db: 'healthbridge' });
        await expect(
          runMigrations(createFakePool(state), {
            migrationsDirectory: directory,
          }),
        ).rejects.toMatchObject({ code: 'TARGET_MISMATCH' });

        const targetCheck = state.queries.indexOf('SELECT DATABASE() AS db');
        const schemaTable = state.queries.findIndex((sql) =>
          sql.startsWith('CREATE TABLE IF NOT EXISTS schema_migrations'),
        );
        expect(targetCheck).toBeGreaterThanOrEqual(0);
        expect(schemaTable).toBe(-1);
        expect(state.schemaStatements).toEqual([]);
        expect(state.inserts).toEqual([]);
        expect(state.released).toBe(true);
      },
    );
  });

  it('skips an already applied migration with a matching checksum', async () => {
    const sql = 'CREATE TABLE first (id INT);';
    await withMigrations({ '001_first.sql': sql }, async (directory) => {
      const state = createState({
        applied: [{ version: '001_first', checksum: checksumSql(sql) }],
      });
      const result = await runMigrations(createFakePool(state), {
        migrationsDirectory: directory,
      });

      expect(result).toEqual({ applied: [], skipped: ['001_first'] });
      expect(state.schemaStatements).toEqual([]);
      expect(state.inserts).toEqual([]);
    });
  });

  it('refuses to run when an applied checksum has drifted', async () => {
    await withMigrations(
      { '001_first.sql': 'CREATE TABLE first (id INT);' },
      async (directory) => {
        const state = createState({
          applied: [{ version: '001_first', checksum: '0'.repeat(64) }],
        });
        await expect(
          runMigrations(createFakePool(state), {
            migrationsDirectory: directory,
          }),
        ).rejects.toMatchObject({
          code: 'CHECKSUM_MISMATCH',
          version: '001_first',
        });
        expect(state.schemaStatements).toEqual([]);
        expect(state.inserts).toEqual([]);
      },
    );
  });

  it('refuses when an applied migration has no matching file', async () => {
    await withMigrations(
      { '001_first.sql': 'CREATE TABLE first (id INT);' },
      async (directory) => {
        const state = createState({
          applied: [{ version: '999_missing', checksum: 'a'.repeat(64) }],
        });
        await expect(
          runMigrations(createFakePool(state), {
            migrationsDirectory: directory,
          }),
        ).rejects.toMatchObject({
          code: 'MISSING_APPLIED_MIGRATION',
          version: '999_missing',
        });
      },
    );
  });

  it('does not record a migration that fails partway through', async () => {
    await withMigrations(
      {
        '001_first.sql':
          'CREATE TABLE first (id INT);\nCREATE TABLE broken (id INT);',
      },
      async (directory) => {
        const state = createState({ failStatement: 2 });
        await expect(
          runMigrations(createFakePool(state), {
            migrationsDirectory: directory,
          }),
        ).rejects.toMatchObject({
          code: 'APPLY_FAILED',
          version: '001_first',
        });

        expect(state.schemaStatements).toHaveLength(2);
        expect(state.inserts).toEqual([]);
        expect(state.applied).toEqual([]);
        expect(state.released).toBe(true);
      },
    );
  });

  it('reports connection and schema-table failures safely', async () => {
    await withMigrations(
      { '001_first.sql': 'CREATE TABLE first (id INT);' },
      async (directory) => {
        await expect(
          runMigrations(createFakePool(createState({ failConnect: true })), {
            migrationsDirectory: directory,
          }),
        ).rejects.toMatchObject({ code: 'CONNECTION_FAILED' });

        await expect(
          runMigrations(createFakePool(createState({ failAppliedRead: true })), {
            migrationsDirectory: directory,
          }),
        ).rejects.toMatchObject({ code: 'SCHEMA_TABLE_INVALID' });
      },
    );
  });

  it('does not run migrations during application startup', () => {
    const serverSource = readFileSync(
      fileURLToPath(new URL('../server.ts', import.meta.url)),
      'utf8',
    );
    const appSource = readFileSync(
      fileURLToPath(new URL('../app.ts', import.meta.url)),
      'utf8',
    );
    expect(serverSource).not.toMatch(/runMigrations|migrate-cli|db:migrate/);
    expect(appSource).not.toMatch(/createDatabasePool|mysql2|runMigrations/);
  });

  it('keeps runtime and migration credentials on separate paths', () => {
    const serverSource = readFileSync(
      fileURLToPath(new URL('../server.ts', import.meta.url)),
      'utf8',
    );
    const cliSource = readFileSync(
      fileURLToPath(new URL('../db/migrate-cli.ts', import.meta.url)),
      'utf8',
    );

    expect(serverSource).toContain('parseDatabaseEnv');
    expect(serverSource).not.toContain('parseMigrationDatabaseEnv');
    expect(cliSource).toContain('parseMigrationDatabaseEnv');
    expect(cliSource).not.toContain('parseDatabaseEnv');
  });
});

describe('initial schema and bootstrap invariants', () => {
  const schemaPath = fileURLToPath(
    new URL('../../database/migrations/001_initial_schema.sql', import.meta.url),
  );
  const bootstrapPath = fileURLToPath(
    new URL('../../database/create-database.sql', import.meta.url),
  );
  const provisioningPath = fileURLToPath(
    new URL('../../database/provision-accounts.sql', import.meta.url),
  );

  it('creates every documented table', () => {
    const schema = readFileSync(schemaPath, 'utf8');
    for (const table of [
      'users',
      'sessions',
      'opportunity_deletions',
      'opportunities',
      'opportunity_tags',
      'contacts',
      'interviews',
      'materials',
      'activities',
    ]) {
      expect(schema).toMatch(new RegExp(`CREATE TABLE ${table} \\(`));
    }
  });

  it('preserves the documented keys, relationships and date storage', () => {
    const schema = readFileSync(schemaPath, 'utf8');
    expect(schema).toContain(
      'UNIQUE KEY uq_opportunities_user_public_id (user_id, public_id)',
    );
    expect(schema).toContain(
      'FOREIGN KEY (opportunity_id, contact_public_id)',
    );
    expect(schema).toContain('ON DELETE RESTRICT');
    expect(schema).toContain('`date` DATE NOT NULL');
    expect(schema).toContain('`time` TIME NULL');
    expect(schema).toContain('archived_at DATETIME(3) NULL');
    expect(schema).toContain('utf8mb4_unicode_ci');
    expect(schema).toContain('CHECK');
  });

  it('never targets another database and contains no destructive commands', () => {
    const schema = readFileSync(schemaPath, 'utf8');
    const bootstrap = readFileSync(bootstrapPath, 'utf8');
    for (const sql of [schema, bootstrap]) {
      expect(sql).not.toMatch(/healthbridge|nova_home|DROP DATABASE|DROP TABLE/i);
    }
    expect(bootstrap).toContain('CREATE DATABASE IF NOT EXISTS launchboard');
    expect(bootstrap).not.toMatch(/CREATE USER|GRANT/i);
  });

  it('provisions two launchboard-only accounts on the configured host', () => {
    const provisioning = readFileSync(provisioningPath, 'utf8');

    expect(provisioning).toContain("'launchboard_app'@'127.0.0.1'");
    expect(provisioning).toContain("'launchboard_migrator'@'127.0.0.1'");
    expect(provisioning).toMatch(
      /GRANT SELECT, INSERT, UPDATE, DELETE\s+ON launchboard\.\*/,
    );
    expect(provisioning).toMatch(
      /GRANT CREATE, ALTER, INDEX, REFERENCES, SELECT, INSERT\s+ON launchboard\.\*/,
    );
    expect(provisioning).toContain('<REPLACE_WITH_RUNTIME_PASSWORD>');
    expect(provisioning).toContain('<REPLACE_WITH_MIGRATION_PASSWORD>');

    expect(provisioning).not.toMatch(/healthbridge|nova_home/i);
    expect(provisioning).not.toMatch(/\bWITH\s+GRANT\s+OPTION\b/i);
    expect(provisioning).not.toMatch(/ON\s+\*\.\*/i);
    expect(provisioning).not.toMatch(/\bDROP\s+(TABLE|DATABASE|USER)\b/i);
    expect(provisioning).not.toMatch(/\bCREATE\s+DATABASE\b/i);
  });
});

describe('opportunity migrations 004-005', () => {
  const migration004Path = fileURLToPath(
    new URL('../../database/migrations/004_opportunity_tasks.sql', import.meta.url),
  );
  const migration005Path = fileURLToPath(
    new URL('../../database/migrations/005_opportunity_job_details.sql', import.meta.url),
  );

  it('discovers additive migration 005 after the existing migrations without connecting to a database', async () => {
    const migrations = await loadMigrations(DEFAULT_MIGRATIONS_DIRECTORY);
    expect(migrations.map((migration) => migration.version)).toEqual([
      '001_initial_schema',
      '002_auth_pre_sessions',
      '003_email_verification_password_reset',
      '004_opportunity_tasks',
      '005_opportunity_job_details',
    ]);
    expect(migrations[3]?.sql).toContain('CREATE TABLE tasks');
    expect(migrations[4]?.sql).toContain('CREATE TABLE opportunity_locations');
  });

  it('adds optional structured fields and an ordered location table without destructive SQL', () => {
    const sql = readFileSync(migration005Path, 'utf8');
    const statements = splitSqlStatements(sql);
    expect(statements).toHaveLength(2);
    expect(sql).toContain('department VARCHAR(160) NOT NULL DEFAULT');
    expect(sql).toContain('team VARCHAR(160) NOT NULL DEFAULT');
    expect(sql).toContain('posted_date DATE NULL');
    expect(sql).toContain('compensation_min DECIMAL(18,4) NULL');
    expect(sql).toContain('compensation_max DECIMAL(18,4) NULL');
    expect(sql).toContain('UNIQUE KEY uq_opportunity_locations_position');
    expect(sql).toContain('position` TINYINT UNSIGNED NOT NULL');
    expect(sql).not.toMatch(/\bCHECK\b/i);
    expect(sql).toContain('domain normalizer and strict API schemas enforce');
    expect(sql).toContain('FOREIGN KEY (opportunity_id) REFERENCES opportunities (id) ON DELETE CASCADE');
    expect(sql).not.toMatch(/DROP\s+(TABLE|DATABASE)|TRUNCATE|DELETE\s+FROM|healthbridge|nova_home/i);
  });

  it('creates an opportunity-owned table with bounded ordering and completion invariants', () => {
    const sql = readFileSync(migration004Path, 'utf8');
    const statements = splitSqlStatements(sql);
    expect(statements).toHaveLength(1);
    expect(sql).toContain('UNIQUE KEY uq_tasks_opportunity_public_id (opportunity_id, public_id)');
    expect(sql).toContain('UNIQUE KEY uq_tasks_opportunity_position (opportunity_id, `position`)');
    expect(sql).toContain('FOREIGN KEY (opportunity_id) REFERENCES opportunities (id) ON DELETE CASCADE');
    expect(sql).toContain('CHECK (`position` BETWEEN 0 AND 99)');
    expect(sql).toContain("CHECK (priority IN ('Low', 'Medium', 'High'))");
    expect(sql).toContain('(completed = 1 AND completed_on IS NOT NULL)');
    expect(sql).toContain('(completed = 0 AND completed_on IS NULL)');
    expect(sql).not.toMatch(/DROP\s+(TABLE|DATABASE)|healthbridge|nova_home/i);
  });
});

describe('MigrationError', () => {
  it('carries a safe code and optional version', () => {
    const error = new MigrationError(
      'CHECKSUM_MISMATCH',
      'Applied migration 001 no longer matches.',
      '001',
    );
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe('CHECKSUM_MISMATCH');
    expect(error.version).toBe('001');
  });
});
