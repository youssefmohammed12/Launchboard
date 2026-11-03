import type { Pool } from 'mysql2/promise';
import { describe, expect, it } from 'vitest';
import {
  LAUNCHBOARD_DATABASE,
  type DatabaseConfig,
} from '../config/env.js';
import {
  acquireUtcConnection,
  assertLaunchboardDatabaseName,
  buildPoolOptions,
  checkDatabaseReadiness,
  createDatabasePool,
  DatabaseTargetError,
} from '../db/pool.js';

const validConfig: DatabaseConfig = {
  host: '127.0.0.1',
  port: 3306,
  database: LAUNCHBOARD_DATABASE,
  user: 'launchboard_app',
  password: 'secret',
};

function connectionWith(
  execute: (sql: string) => Promise<[unknown, unknown]>,
) {
  let released = false;
  const connection = {
    query: async () => [[], []],
    execute,
    release: () => {
      released = true;
    },
  };
  return {
    connection,
    wasReleased: () => released,
  };
}

function poolWith(connection: unknown): Pool {
  return {
    getConnection: async () => connection,
  } as unknown as Pool;
}

describe('database target guard', () => {
  it('accepts only the exact launchboard database name', () => {
    expect(() => assertLaunchboardDatabaseName('launchboard')).not.toThrow();
    for (const name of ['healthbridge', 'nova_home', 'Launchboard', '']) {
      expect(() => assertLaunchboardDatabaseName(name)).toThrow(
        DatabaseTargetError,
      );
    }
  });

  it('refuses to build pool options for another database', () => {
    const config = {
      ...validConfig,
      database: 'healthbridge' as typeof LAUNCHBOARD_DATABASE,
    };
    expect(() => buildPoolOptions(config)).toThrow(DatabaseTargetError);
    expect(() => createDatabasePool(config)).toThrow(DatabaseTargetError);
  });
});

describe('pool configuration', () => {
  it('uses utf8mb4, UTC string handling and bounded waiting', () => {
    const options = buildPoolOptions(validConfig);
    expect(options).not.toHaveProperty('ssl');
    expect(options).toMatchObject({
      database: 'launchboard',
      charset: 'utf8mb4',
      dateStrings: true,
      timezone: 'Z',
      multipleStatements: false,
      connectionLimit: 10,
      maxIdle: 10,
      idleTimeout: 60_000,
      queueLimit: 20,
      connectTimeout: 10_000,
      waitForConnections: true,
    });
  });

  it('enables CA and hostname verification when a database CA is configured', () => {
    const sslCa = "-----BEGIN CERTIFICATE-----\nY2VydGlmaWNhdGUtcGFyc2VyLXRlc3Q=\n-----END CERTIFICATE-----";
    const options = buildPoolOptions({ ...validConfig, sslCa });
    expect(options.ssl).toEqual({
      minVersion: 'TLSv1.2',
      ca: sslCa,
      rejectUnauthorized: true,
      verifyIdentity: true,
    });
  });

  it('uses a small bounded pool for serverless function instances', () => {
    const options = buildPoolOptions({ ...validConfig, serverless: true });
    expect(options).toMatchObject({
      connectionLimit: 2,
      maxIdle: 1,
      idleTimeout: 60_000,
      queueLimit: 20,
    });
  });

  it('enables TLS 1.2+ and system CA verification for TiDB Serverless', () => {
    const options = buildPoolOptions({ ...validConfig, ssl: true });
    expect(options.ssl).toEqual({
      minVersion: 'TLSv1.2',
      rejectUnauthorized: true,
      verifyIdentity: true,
    });
  });

  it('uses exactly the supplied credentials with no fallback', () => {
    const runtime = buildPoolOptions(validConfig);
    expect(runtime.user).toBe('launchboard_app');
    expect(runtime.password).toBe('secret');

    const migration = buildPoolOptions({
      ...validConfig,
      user: 'launchboard_migrator',
      password: 'migration-secret',
    });
    expect(migration.user).toBe('launchboard_migrator');
    expect(migration.password).toBe('migration-secret');
  });
});

describe('acquireUtcConnection', () => {
  it('sets the session time zone and releases on failure', async () => {
    let released = false;
    const connection = {
      query: async () => {
        throw new Error('session setup failed');
      },
      release: () => {
        released = true;
      },
    };
    const pool = poolWith(connection);

    await expect(acquireUtcConnection(pool)).rejects.toThrow(
      'session setup failed',
    );
    expect(released).toBe(true);
  });
});

describe('checkDatabaseReadiness', () => {
  it('reports not configured without a pool', async () => {
    await expect(checkDatabaseReadiness(null)).resolves.toEqual({
      ready: false,
      reason: 'not_configured',
    });
  });

  it('verifies the selected database and SELECT 1 before reporting ready', async () => {
    const queries: string[] = [];
    const { connection, wasReleased } = connectionWith(async (sql) => {
      queries.push(sql);
      if (sql === 'SELECT DATABASE() AS db') {
        return [[{ db: 'launchboard' }], []];
      }
      return [[], []];
    });
    const pool = poolWith(connection);

    await expect(checkDatabaseReadiness(pool)).resolves.toEqual({ ready: true });
    expect(queries).toEqual(['SELECT DATABASE() AS db', 'SELECT 1']);
    expect(wasReleased()).toBe(true);
  });

  it('rejects a connection that selected another database', async () => {
    const queries: string[] = [];
    const { connection, wasReleased } = connectionWith(async (sql) => {
      queries.push(sql);
      if (sql === 'SELECT DATABASE() AS db') {
        return [[{ db: 'healthbridge' }], []];
      }
      return [[], []];
    });
    const pool = poolWith(connection);

    await expect(checkDatabaseReadiness(pool)).resolves.toEqual({
      ready: false,
      reason: 'target_mismatch',
    });
    expect(queries).not.toContain('SELECT 1');
    expect(wasReleased()).toBe(true);
  });

  it('reports an unreachable database without leaking driver details', async () => {
    const secret = 'do-not-leak-password';
    const { connection, wasReleased } = connectionWith(async (sql) => {
      if (sql === 'SELECT DATABASE() AS db') {
        throw new Error(`connection failed for ${secret}`);
      }
      return [[], []];
    });
    const pool = poolWith(connection);

    const result = await checkDatabaseReadiness(pool);
    expect(result).toEqual({ ready: false, reason: 'unreachable' });
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(wasReleased()).toBe(true);
  });

  it('reports an unreachable database when the pool cannot connect', async () => {
    const pool = {
      getConnection: async () => {
        throw new Error('connect failed');
      },
    } as unknown as Pool;

    await expect(checkDatabaseReadiness(pool)).resolves.toEqual({
      ready: false,
      reason: 'unreachable',
    });
  });
});
