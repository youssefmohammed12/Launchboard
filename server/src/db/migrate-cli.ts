import {
  EnvValidationError,
  loadEnvFile,
  parseMigrationDatabaseEnv,
} from '../config/env.js';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MigrationError,
  runMigrations,
  type MigrationPool,
} from './migrate.js';
import { createDatabasePool } from './pool.js';

const PREFIX = '[launchboard-db]';

export async function main(): Promise<void> {
  try {
    loadEnvFile();
  } catch (error) {
    if (error instanceof EnvValidationError) {
      console.error(`${PREFIX} ${error.message}`);
    } else {
      console.error(`${PREFIX} Could not load the .env file.`);
    }
    process.exitCode = 1;
    return;
  }

  let config;
  try {
    config = parseMigrationDatabaseEnv(process.env);
  } catch (error) {
    if (error instanceof EnvValidationError) {
      console.error(`${PREFIX} ${error.message}`);
    } else {
      console.error(`${PREFIX} Invalid migration database configuration.`);
    }
    process.exitCode = 1;
    return;
  }

  if (config === null) {
    console.error(
      `${PREFIX} Migration database configuration is missing. Set DB_NAME, DB_MIGRATION_USER and DB_MIGRATION_PASSWORD (DB_HOST and DB_PORT are optional). Runtime DB_USER and DB_PASSWORD are not used for migrations.`,
    );
    process.exitCode = 1;
    return;
  }

  let pool: ReturnType<typeof createDatabasePool>;
  try {
    pool = createDatabasePool(config);
  } catch {
    console.error(`${PREFIX} Could not initialize the database pool.`);
    process.exitCode = 1;
    return;
  }

  try {
    const result = await runMigrations(pool as unknown as MigrationPool, {
      log: (message) => console.log(`${PREFIX} ${message}`),
    });
    console.log(
      `${PREFIX} Database is up to date. Applied ${result.applied.length}, skipped ${result.skipped.length}.`,
    );
  } catch (error) {
    if (error instanceof MigrationError) {
      console.error(`${PREFIX} ${error.message}`);
    } else {
      console.error(`${PREFIX} Migration failed unexpectedly.`);
    }
    process.exitCode = 1;
  } finally {
    try {
      await pool.end();
    } catch {
      // A close failure must not hide the migration result or error.
    }
  }
}

const isDirectExecution =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectExecution) {
  void main();
}
