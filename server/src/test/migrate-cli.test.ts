import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDatabasePool } from '../db/pool.js';
import { main } from '../db/migrate-cli.js';

vi.mock('../db/pool.js', () => ({
  createDatabasePool: vi.fn(),
}));

const mockCreatePool = createDatabasePool as unknown as ReturnType<typeof vi.fn>;

const DB_ENV_NAMES = [
  'DB_HOST',
  'DB_PORT',
  'DB_NAME',
  'DB_USER',
  'DB_PASSWORD',
  'DB_MIGRATION_USER',
  'DB_MIGRATION_PASSWORD',
];

function clearDbEnv(): void {
  for (const name of DB_ENV_NAMES) delete process.env[name];
}

function captureConsole(): { errors: string[]; logs: string[] } {
  const errors: string[] = [];
  const logs: string[] = [];
  vi.spyOn(console, 'error').mockImplementation((message: unknown) => {
    errors.push(String(message));
  });
  vi.spyOn(console, 'log').mockImplementation((message: unknown) => {
    logs.push(String(message));
  });
  return { errors, logs };
}

async function runCli(env: Record<string, string>): Promise<void> {
  clearDbEnv();
  Object.assign(process.env, env);
  process.exitCode = 0;
  await main();
}

afterEach(() => {
  clearDbEnv();
  mockCreatePool.mockReset();
  vi.restoreAllMocks();
});

describe('migrate-cli credential separation', () => {
  it('fails safely when no migration database configuration is present', async () => {
    const { errors } = captureConsole();

    await runCli({});

    expect(process.exitCode).toBe(1);
    expect(errors.join(' ')).toContain(
      'Migration database configuration is missing',
    );
    expect(mockCreatePool).not.toHaveBeenCalled();
    expect(errors.join(' ')).not.toContain('launchboard_app');
    expect(errors.join(' ')).not.toContain('launchboard_migrator');
  });

  it('fails safely when migration credentials are incomplete', async () => {
    const { errors } = captureConsole();

    await runCli({
      DB_NAME: 'launchboard',
      DB_MIGRATION_USER: 'launchboard_migrator',
    });

    expect(process.exitCode).toBe(1);
    expect(errors.join(' ')).toContain('DB_MIGRATION_PASSWORD');
    expect(mockCreatePool).not.toHaveBeenCalled();
  });

  it('never falls back to runtime DB_USER and DB_PASSWORD', async () => {
    const { errors } = captureConsole();

    await runCli({
      DB_NAME: 'launchboard',
      DB_USER: 'launchboard_app',
      DB_PASSWORD: 'runtime-secret',
    });

    expect(process.exitCode).toBe(1);
    const output = errors.join(' ');
    expect(output).toContain('DB_MIGRATION_USER');
    expect(output).toContain('DB_MIGRATION_PASSWORD');
    expect(output).not.toContain('runtime-secret');
    expect(output).not.toContain('launchboard_app');
    expect(mockCreatePool).not.toHaveBeenCalled();
  });

  it('rejects a non-launchboard database name before any connection', async () => {
    const { errors } = captureConsole();

    await runCli({
      DB_NAME: 'nova_home',
      DB_MIGRATION_USER: 'launchboard_migrator',
      DB_MIGRATION_PASSWORD: 'migration-secret',
    });

    expect(process.exitCode).toBe(1);
    const output = errors.join(' ');
    expect(output).toContain('DB_NAME');
    expect(output).toContain('launchboard');
    expect(output).not.toContain('nova_home');
    expect(mockCreatePool).not.toHaveBeenCalled();
  });

  it('never echoes migration credentials in CLI output', async () => {
    const { errors } = captureConsole();

    await runCli({
      DB_NAME: 'launchboard',
      DB_MIGRATION_PASSWORD: 'super-secret-migration-password',
    });

    expect(process.exitCode).toBe(1);
    expect(errors.join(' ')).toContain('DB_MIGRATION_USER');
    expect(errors.join(' ')).not.toContain('super-secret-migration-password');
    expect(mockCreatePool).not.toHaveBeenCalled();
  });

  it('builds the pool from migration credentials only and reaches the runner', async () => {
    const { errors } = captureConsole();
    mockCreatePool.mockReturnValue({
      end: vi.fn(async () => {
        /* no-op */
      }),
      getConnection: async () => {
        throw new Error('connect failed');
      },
    });

    await runCli({
      DB_NAME: 'launchboard',
      DB_MIGRATION_USER: 'launchboard_migrator',
      DB_MIGRATION_PASSWORD: 'migration-secret',
    });

    expect(process.exitCode).toBe(1);
    expect(mockCreatePool).toHaveBeenCalledTimes(1);

    const config = mockCreatePool.mock.calls[0]![0];
    expect(config).toMatchObject({
      host: '127.0.0.1',
      port: 3306,
      database: 'launchboard',
      user: 'launchboard_migrator',
      password: 'migration-secret',
    });
    expect(errors.join(' ')).toContain('Could not connect to the configured database');
    expect(errors.join(' ')).not.toContain('migration-secret');
  });
});

describe('import side effects and pool lifecycle', () => {
  const DB_ENV_NAMES = [
    'DB_HOST',
    'DB_PORT',
    'DB_NAME',
    'DB_USER',
    'DB_PASSWORD',
    'DB_MIGRATION_USER',
    'DB_MIGRATION_PASSWORD',
  ];

  function clearDbEnv(): void {
    for (const name of DB_ENV_NAMES) delete process.env[name];
  }

  beforeEach(() => {
    vi.resetModules();
    mockCreatePool.mockReset();
    clearDbEnv();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    clearDbEnv();
    vi.resetModules();
  });

  function captureConsole(): { errors: string[]; logs: string[] } {
    const errors: string[] = [];
    const logs: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((message: unknown) => {
      errors.push(String(message));
    });
    vi.spyOn(console, 'log').mockImplementation((message: unknown) => {
      logs.push(String(message));
    });
    return { errors, logs };
  }

  async function runCliWithFreshModule(
    env: Record<string, string>,
    runMigrationsImpl: () => Promise<{ applied: string[]; skipped: string[] }>,
  ) {
    Object.assign(process.env, env);
    process.exitCode = 0;
    const { errors, logs } = captureConsole();
    const mockRunMigrations = vi.fn(runMigrationsImpl);
    vi.doMock('../db/migrate.js', () => ({
      runMigrations: mockRunMigrations,
      MigrationError: class MigrationError extends Error {
        readonly code: string;
        readonly version?: string;
        constructor(code: string, message: string, version?: string) {
          super(message);
          this.name = 'MigrationError';
          this.code = code;
          this.version = version;
        }
      },
    }));
    const { main } = await import('../db/migrate-cli.js');
    await main();
    return { errors, logs, exitCode: process.exitCode ?? 0, mockRunMigrations };
  }

  it('does not call createDatabasePool when the module is imported', async () => {
    await import('../db/migrate-cli.js');
    expect(mockCreatePool).not.toHaveBeenCalled();
  });

  it('does not call runMigrations when the module is imported', async () => {
    const mockRunMigrations = vi.fn();
    vi.doMock('../db/migrate.js', () => ({
      runMigrations: mockRunMigrations,
      MigrationError: class MigrationError extends Error {
        readonly code: string;
        constructor(code: string, message: string) {
          super(message);
          this.name = 'MigrationError';
          this.code = code;
        }
      },
    }));
    await import('../db/migrate-cli.js');
    expect(mockRunMigrations).not.toHaveBeenCalled();
  });

  it('invokes the runner when main is called explicitly with valid migration config', async () => {
    const { exitCode, errors, logs, mockRunMigrations } = await runCliWithFreshModule(
      {
        DB_NAME: 'launchboard',
        DB_MIGRATION_USER: 'launchboard_migrator',
        DB_MIGRATION_PASSWORD: 'migration-secret',
      },
      async () => ({ applied: ['001_first'], skipped: [] }),
    );

    expect(exitCode).toBe(0);
    expect(mockRunMigrations).toHaveBeenCalledTimes(1);
    expect(logs.join(' ')).toContain('Database is up to date');
    expect(errors.join(' ')).not.toContain('migration-secret');
    expect(logs.join(' ')).not.toContain('migration-secret');
  });

  it('closes the pool after migration success', async () => {
    const poolEnd = vi.fn(async () => {
      /* no-op */
    });
    mockCreatePool.mockReturnValue({ end: poolEnd });

    const { exitCode } = await runCliWithFreshModule(
      {
        DB_NAME: 'launchboard',
        DB_MIGRATION_USER: 'launchboard_migrator',
        DB_MIGRATION_PASSWORD: 'migration-secret',
      },
      async () => ({ applied: [], skipped: [] }),
    );

    expect(exitCode).toBe(0);
    expect(poolEnd).toHaveBeenCalledTimes(1);
  });

  it('closes the pool after migration failure', async () => {
    const poolEnd = vi.fn(async () => {
      /* no-op */
    });
    mockCreatePool.mockReturnValue({ end: poolEnd });

    const { exitCode } = await runCliWithFreshModule(
      {
        DB_NAME: 'launchboard',
        DB_MIGRATION_USER: 'launchboard_migrator',
        DB_MIGRATION_PASSWORD: 'migration-secret',
      },
      async () => {
        throw new Error('boom');
      },
    );

    expect(exitCode).toBe(1);
    expect(poolEnd).toHaveBeenCalledTimes(1);
  });

  it('handles a pool-construction error safely without leaking secrets', async () => {
    const secret = 'super-secret-migration-password';
    Object.assign(process.env, {
      DB_NAME: 'launchboard',
      DB_MIGRATION_USER: 'launchboard_migrator',
      DB_MIGRATION_PASSWORD: secret,
    });
    process.exitCode = 0;
    mockCreatePool.mockImplementation(() => {
      throw new Error('pool construction failed');
    });

    const errs: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((message: unknown) => {
      errs.push(String(message));
    });
    vi.doMock('../db/migrate.js', () => ({
      runMigrations: vi.fn(),
      MigrationError: class MigrationError extends Error {
        readonly code: string;
        constructor(code: string, message: string) {
          super(message);
          this.name = 'MigrationError';
          this.code = code;
        }
      },
    }));
    const { main } = await import('../db/migrate-cli.js');
    await main();

    expect(process.exitCode).toBe(1);
    expect(errs.join(' ')).toContain('Could not initialize the database pool');
    expect(errs.join(' ')).not.toContain(secret);
    expect(mockCreatePool).toHaveBeenCalled();
  });
});

