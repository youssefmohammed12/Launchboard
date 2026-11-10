import { describe, expect, it } from 'vitest';
import type { Pool, PoolConnection } from 'mysql2/promise';
import {
  evaluateGrants,
  evaluateSchema,
  latestRecordedMigration,
  runCascadeCheck,
  runLiveVerification,
  sanitizeGrant,
  type SchemaSnapshot,
} from '../db/verify-live.js';

function snapshot(overrides: Partial<SchemaSnapshot> = {}): SchemaSnapshot {
  return { tables: [], columns: [], indexes: [], foreignKeys: [], ...overrides };
}

interface FakeState {
  queries: string[];
  rolledBack: number;
  committed: number;
  released: number;
}

function createFakeConnection(
  state: FakeState,
  options: {
    selectedDatabase?: string;
    deleteAffectedRows?: number;
    rollbackError?: boolean;
    rawDeleteBlocked?: boolean;
  } = {},
): PoolConnection {
  let fixtureInserted = false;
  let inTransaction = false;
  let opportunityDeletes = 0;

  return {
    beginTransaction: async () => {
      state.queries.push('BEGIN');
      inTransaction = true;
    },
    rollback: async () => {
      state.rolledBack += 1;
      inTransaction = false;
      if (options.rollbackError === true) throw new Error('rollback failed');
    },
    commit: async () => {
      state.committed += 1;
    },
    release: () => {
      state.released += 1;
    },
    query: async (sql: string) => {
      const text = String(sql);
      state.queries.push(text);
      if (text.includes('DATABASE()')) {
        return [[{ db: options.selectedDatabase ?? 'launchboard' }], []];
      }
      return [[], []];
    },
    execute: async (sql: string) => {
      const text = String(sql);
      state.queries.push(text);

      if (text.startsWith('INSERT INTO opportunities')) {
        fixtureInserted = true;
        return [{ insertId: 42, affectedRows: 1 }, []];
      }
      if (text.startsWith('INSERT')) {
        return [{ insertId: 1, affectedRows: 1 }, []];
      }
      if (text.startsWith('DELETE FROM opportunities')) {
        opportunityDeletes += 1;
        if (options.rawDeleteBlocked === true && opportunityDeletes === 1) {
          throw Object.assign(new Error('fk restrict blocked the delete'), {
            errno: 1451,
          });
        }
        fixtureInserted = false;
        return [{ affectedRows: options.deleteAffectedRows ?? 1 }, []];
      }
      if (text.startsWith('DELETE FROM interviews')) {
        return [{ affectedRows: 1 }, []];
      }
      if (text.includes('AS interviews')) {
        const value = fixtureInserted ? 1 : 0;
        return [
          [
            {
              interviews: value,
              contacts: value,
              tags: value,
              materials: value,
              activities: value,
              locations: value,
            },
          ],
          [],
        ];
      }
      if (text.includes('AS present')) {
        return [[{ present: inTransaction ? 1 : 0 }], []];
      }
      return [{ insertId: 0, affectedRows: 0 }, []];
    },
  } as unknown as PoolConnection;
}

function newState(): FakeState {
  return { queries: [], rolledBack: 0, committed: 0, released: 0 };
}

describe('live migration report', () => {
  it('reports the latest verified migration, not the initial migration', () => {
    expect(latestRecordedMigration([
      { version: '001_initial_schema', checksum: 'first' },
      { version: '004_opportunity_tasks', checksum: 'middle' },
      { version: '005_opportunity_job_details', checksum: 'previous' },
      { version: '006_account_profile', checksum: 'latest' },
    ])).toEqual({
      version: '006_account_profile',
      checksum: 'latest',
    });
    expect(latestRecordedMigration([])).toBeNull();
  });
});

describe('live schema evaluation', () => {
  it('reports missing required tables', () => {
    const failures = evaluateSchema(snapshot());
    expect(failures).toContain('missing table users');
    expect(failures).toContain('missing table auth_pre_sessions');
    expect(failures).toContain('missing table schema_migrations');
  });

  it('requires the migrated user display-name column', () => {
    const missing = evaluateSchema(snapshot());
    expect(missing).toContain('missing column users.display_name');

    const present = evaluateSchema(snapshot({
      columns: [{
        table: 'users',
        name: 'display_name',
        dataType: 'varchar',
        collation: 'utf8mb4_unicode_ci',
        nullable: false,
        extra: '',
        charLength: 80,
        precision: null,
        unsigned: false,
      }],
    }));
    expect(present).not.toContain('missing column users.display_name');
  });

  it('reports a table that is not InnoDB', () => {
    const failures = evaluateSchema(
      snapshot({
        tables: [
          {
            name: 'users',
            engine: 'MyISAM',
            collation: 'utf8mb4_unicode_ci',
            rowFormat: 'Dynamic',
          },
        ],
      }),
    );
    expect(failures).toContain('users engine is MyISAM, expected InnoDB');
  });

  it('reports a wrong delete rule on the composite interview contact key', () => {
    const failures = evaluateSchema(
      snapshot({
        foreignKeys: [
          {
            name: 'fk_interviews_contact',
            table: 'interviews',
            columns: ['opportunity_id', 'contact_public_id'],
            refTable: 'contacts',
            refColumns: ['opportunity_id', 'public_id'],
            deleteRule: 'CASCADE',
          },
        ],
      }),
    );
    expect(failures).toContain(
      'interviews.fk_interviews_contact delete rule is CASCADE',
    );
  });
});

describe('v1.2 Action Center schema evaluation', () => {
  it('requires the tasks table, its columns, indexes and opportunity ownership foreign key', () => {
    const failures = evaluateSchema(snapshot({
      tables: [{
        name: 'tasks',
        engine: 'InnoDB',
        collation: 'utf8mb4_unicode_ci',
        rowFormat: 'Dynamic',
      }],
    }));

    expect(failures).not.toContain('missing table tasks');
    expect(failures).toContain('missing column tasks.id');
    expect(failures).toContain('missing column tasks.public_id');
    expect(failures).toContain('missing column tasks.completed_on');
    expect(failures).toContain('missing index tasks.PRIMARY');
    expect(failures).toContain('missing index tasks.uq_tasks_opportunity_public_id');
    expect(failures).toContain('missing index tasks.uq_tasks_opportunity_position');
    expect(failures).toContain('missing foreign key tasks.fk_tasks_opportunity');
  });
});

describe('v1.3 structured Opportunity schema evaluation', () => {
  it('requires the structured columns, ordered location table, indexes and cascade relationship', () => {
    const failures = evaluateSchema(snapshot({
      tables: [{
        name: 'opportunity_locations',
        engine: 'InnoDB',
        collation: 'utf8mb4_unicode_ci',
        rowFormat: 'Dynamic',
      }],
    }));

    expect(failures).not.toContain('missing table opportunity_locations');
    expect(failures).toContain('missing column opportunities.department');
    expect(failures).toContain('missing column opportunities.compensation_min');
    expect(failures).toContain('missing column opportunity_locations.id');
    expect(failures).toContain('missing column opportunity_locations.location');
    expect(failures).toContain('missing index opportunity_locations.PRIMARY');
    expect(failures).toContain('missing index opportunity_locations.uq_opportunity_locations_position');
    expect(failures).toContain('missing foreign key opportunity_locations.fk_opportunity_locations_opportunity');
  });
});

describe('pre-auth schema evaluation', () => {
  it('requires the auth_pre_sessions table definition and all three indexes', () => {
    const failures = evaluateSchema(snapshot({
      tables: [{
        name: 'auth_pre_sessions',
        engine: 'InnoDB',
        collation: 'utf8mb4_unicode_ci',
        rowFormat: 'Dynamic',
      }],
    }));

    expect(failures).toContain('missing column auth_pre_sessions.id');
    expect(failures).toContain('missing column auth_pre_sessions.token_hash');
    expect(failures).toContain('missing index auth_pre_sessions.PRIMARY');
    expect(failures).toContain('missing index auth_pre_sessions.uq_auth_pre_sessions_token_hash');
    expect(failures).toContain('missing index auth_pre_sessions.idx_auth_pre_sessions_expires_at');
  });
});

describe('live runtime grant evaluation', () => {
  const scoped =
    'GRANT SELECT, INSERT, UPDATE, DELETE ON `launchboard`.* TO `launchboard_app`@`127.0.0.1`';
  const usage = 'GRANT USAGE ON *.* TO `launchboard_app`@`127.0.0.1`';

  it('accepts the expected data-only grants', () => {
    expect(evaluateGrants([usage, scoped])).toEqual([]);
  });

  it('rejects DDL, global and other-database grants', () => {
    expect(
      evaluateGrants([
        usage,
        scoped,
        'GRANT CREATE ON `launchboard`.* TO `launchboard_app`@`127.0.0.1`',
      ]),
    ).toContain('runtime account has unexpected privilege CREATE');
    expect(
      evaluateGrants([
        usage,
        scoped,
        'GRANT ALL PRIVILEGES ON *.* TO `launchboard_app`@`127.0.0.1`',
      ]),
    ).toContain('runtime account has a global privilege');
    expect(
      evaluateGrants([
        usage,
        scoped,
        'GRANT SELECT ON `nova_home`.* TO `launchboard_app`@`127.0.0.1`',
      ]),
    ).toContain('runtime account has a privilege on nova_home.*');
  });

  it('rejects GRANT OPTION and missing privileges', () => {
    expect(evaluateGrants([`${scoped} WITH GRANT OPTION`])).toContain(
      'runtime account has GRANT OPTION',
    );
    expect(
      evaluateGrants([
        'GRANT SELECT ON `launchboard`.* TO `launchboard_app`@`127.0.0.1`',
      ]),
    ).toContain('runtime account is missing INSERT');
  });

  it('redacts password hashes from grant output', () => {
    const grant =
      "GRANT USAGE ON *.* TO `launchboard_app`@`127.0.0.1` IDENTIFIED BY PASSWORD '*ABC123'";
    const sanitized = sanitizeGrant(grant);
    expect(sanitized).toContain("IDENTIFIED BY PASSWORD '<redacted>'");
    expect(sanitized).not.toContain('ABC123');
  });
});

describe('live cascade check safety', () => {
  it('rolls back both phases after success and never commits', async () => {
    const state = newState();
    const report = await runCascadeCheck(createFakeConnection(state));

    expect(report.rawDeleteSucceeded).toBe(true);
    expect(report.rawDeleteError).toBeNull();
    expect(report.safeSequenceDeleted).toBe(1);
    expect(report.remainingInterviews).toBe(0);
    expect(report.remainingContacts).toBe(0);
    expect(report.remainingLocations).toBe(0);
    expect(report.userStillPresent).toBe(1);
    expect(state.rolledBack).toBe(2);
    expect(state.committed).toBe(0);
  });

  it('records a RESTRICT block and still proves the safe sequence', async () => {
    const state = newState();
    const report = await runCascadeCheck(
      createFakeConnection(state, { rawDeleteBlocked: true }),
    );

    expect(report.rawDeleteSucceeded).toBe(false);
    expect(report.rawDeleteError).toContain('fk restrict');
    expect(report.safeSequenceDeleted).toBe(1);
    expect(report.remainingInterviews).toBe(0);
    expect(report.remainingLocations).toBe(0);
    expect(state.rolledBack).toBe(2);
    expect(state.committed).toBe(0);
  });

  it('rolls back when the synthetic delete does not affect exactly one row', async () => {
    const state = newState();
    await expect(
      runCascadeCheck(createFakeConnection(state, { deleteAffectedRows: 0 })),
    ).rejects.toMatchObject({ check: 'CASCADE_FAILED' });

    expect(state.rolledBack).toBe(1);
    expect(state.committed).toBe(0);
  });

  it('surfaces a failed rollback prominently and never commits', async () => {
    const state = newState();
    await expect(
      runCascadeCheck(createFakeConnection(state, { rollbackError: true })),
    ).rejects.toMatchObject({ check: 'ROLLBACK_FAILED' });

    expect(state.committed).toBe(0);
  });
});

describe('live verification target guard', () => {
  it('refuses a database other than launchboard before writing anything', async () => {
    const state = newState();
    const connection = createFakeConnection(state, {
      selectedDatabase: 'nova_home',
    });
    const pool = {
      getConnection: async () => connection,
    } as unknown as Pool;

    await expect(runLiveVerification(pool)).rejects.toMatchObject({
      check: 'TARGET_MISMATCH',
    });

    expect(state.released).toBe(1);
    expect(state.queries.some((query) => query.startsWith('INSERT'))).toBe(false);
    expect(state.queries.some((query) => query.startsWith('DELETE'))).toBe(false);
  });
});
