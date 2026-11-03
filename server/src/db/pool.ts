import mysql from 'mysql2/promise';
import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
import {
  LAUNCHBOARD_DATABASE,
  type DatabaseConfig,
} from '../config/env.js';
import type {
  ReadinessProbe,
  ReadinessResult,
} from './readiness.js';

/** Raised when a pool would target a database other than `launchboard`. */
export class DatabaseTargetError extends Error {
  constructor() {
    super(`Database target must be exactly ${LAUNCHBOARD_DATABASE}.`);
    this.name = 'DatabaseTargetError';
  }
}

/**
 * Pool settings are deliberately small and bounded. `queueLimit` prevents an
 * unbounded queue of waiters when the database is slow or unavailable.
 */
export const DB_POOL_SETTINGS = {
  connectionLimit: 10,
  maxIdle: 10,
  idleTimeout: 60_000,
  queueLimit: 20,
  connectTimeout: 10_000,
  waitForConnections: true,
} as const;

export function assertLaunchboardDatabaseName(name: string): void {
  if (name !== LAUNCHBOARD_DATABASE) throw new DatabaseTargetError();
}

export function buildPoolOptions(config: DatabaseConfig) {
  assertLaunchboardDatabaseName(config.database);
  return {
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    ...(config.ssl === true || config.sslCa !== undefined
      ? {
          ssl: {
            minVersion: 'TLSv1.2',
            ...(config.sslCa === undefined ? {} : { ca: config.sslCa }),
            rejectUnauthorized: true,
            verifyIdentity: true,
          },
        }
      : {}),
    charset: 'utf8mb4',
    // `dateStrings` keeps DATE/TIME values as strings so calendar dates never
    // pass through a JavaScript Date in the server's local timezone.
    dateStrings: true,
    timezone: 'Z',
    supportBigNumbers: true,
    bigNumberStrings: true,
    multipleStatements: false,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
    ...(config.serverless
      ? {
          connectionLimit: 2,
          maxIdle: 1,
          idleTimeout: 60_000,
          queueLimit: 20,
        }
      : DB_POOL_SETTINGS),
  };
}

export function createDatabasePool(config: DatabaseConfig): Pool {
  return mysql.createPool(buildPoolOptions(config));
}

/**
 * Acquires a connection and sets its session time zone to UTC. Every database
 * operation, including readiness and migrations, must use this helper so
 * `CURRENT_TIMESTAMP`/`UTC_TIMESTAMP` behavior stays consistent with the
 * backend contract.
 */
export async function acquireUtcConnection(pool: Pool): Promise<PoolConnection> {
  const connection = await pool.getConnection();
  try {
    await connection.query("SET time_zone = '+00:00'");
    return connection;
  } catch (error) {
    connection.release();
    throw error;
  }
}

function selectedDatabase(rows: RowDataPacket[]): string | null {
  const value = rows[0]?.db;
  return typeof value === 'string' ? value : null;
}

/**
 * Verifies that a connection is usable, that the server selected exactly the
 * `launchboard` database, and that `SELECT 1` succeeds. Failures are reduced to
 * a safe reason; driver errors are never returned to the caller.
 */
export async function checkDatabaseReadiness(
  pool: Pool | null,
): Promise<ReadinessResult> {
  if (pool === null) return { ready: false, reason: 'not_configured' };

  let connection: PoolConnection | null = null;
  try {
    connection = await acquireUtcConnection(pool);
    const [rows] = await connection.execute<RowDataPacket[]>(
      'SELECT DATABASE() AS db',
    );
    if (selectedDatabase(rows) !== LAUNCHBOARD_DATABASE) {
      return { ready: false, reason: 'target_mismatch' };
    }
    await connection.execute('SELECT 1');
    return { ready: true };
  } catch {
    return { ready: false, reason: 'unreachable' };
  } finally {
    connection?.release();
  }
}

export interface DatabaseService extends ReadinessProbe {
  close(): Promise<void>;
  getPool(): Pool;
}

/** Creates one pool per process and reuses it for readiness checks. */
export function createDatabaseService(config: DatabaseConfig): DatabaseService {
  const pool = createDatabasePool(config);

  return {
    check: () => checkDatabaseReadiness(pool),

    close: async () => {
      await pool.end();
    },

    getPool: () => pool,
  };
}



