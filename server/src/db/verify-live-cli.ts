import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EnvValidationError,
  loadEnvFile,
  parseDatabaseEnv,
} from '../config/env.js';
import { createDatabasePool } from './pool.js';
import { LiveVerificationError, runLiveVerification } from './verify-live.js';

const PREFIX = '[launchboard-verify]';

/**
 * Explicitly invoked live verification. It uses runtime credentials only, never
 * runs during application startup, never commits its transaction, and prints
 * no credentials.
 */
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
    config = parseDatabaseEnv(process.env);
  } catch (error) {
    if (error instanceof EnvValidationError) {
      console.error(`${PREFIX} ${error.message}`);
    } else {
      console.error(`${PREFIX} Invalid runtime database configuration.`);
    }
    process.exitCode = 1;
    return;
  }

  if (config === null) {
    console.error(
      `${PREFIX} Runtime database configuration is missing. Set DB_NAME, DB_USER and DB_PASSWORD (DB_HOST and DB_PORT are optional). Migration credentials are not used.`,
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
    const report = await runLiveVerification(pool, {
      expectedUser: config.user,
      log: (message) => console.log(`${PREFIX} ${message}`),
    });

    console.log(
      `${PREFIX} MariaDB ${report.version}; sql_mode=${report.sqlMode || 'unknown'}; ` +
        `default row format=${report.defaultRowFormat ?? 'unknown'}`,
    );
    for (const table of report.tables) {
      console.log(`${PREFIX} Table ${table.name}: ${table.rowFormat ?? 'unknown'} row format`);
    }
    for (const grant of report.grants) {
      console.log(`${PREFIX} Grant: ${grant}`);
    }
    console.log(
      `${PREFIX} Migration ${report.migration.version} checksum ${report.migration.checksum}`,
    );
    console.log(
      `${PREFIX} Raw opportunity DELETE with interview→contact reference: ` +
        `${report.cascade.rawDeleteSucceeded ? 'succeeded' : 'blocked by RESTRICT'}`,
    );
    if (!report.cascade.rawDeleteSucceeded) {
      console.log(
        `${PREFIX} Restrict detail: ${report.cascade.rawDeleteError ?? 'foreign key restrict error'}`,
      );
    }
    console.log(
      `${PREFIX} Safe sequence (delete interviews, then opportunity): ` +
        `deleted ${report.cascade.safeSequenceDeleted} opportunity, ` +
        `remaining interviews=${report.cascade.remainingInterviews}, ` +
        `contacts=${report.cascade.remainingContacts}, ` +
        `tags=${report.cascade.remainingTags}, ` +
        `materials=${report.cascade.remainingMaterials}, ` +
        `activities=${report.cascade.remainingActivities}; ` +
        `user present=${report.cascade.userStillPresent}`,
    );
    console.log(`${PREFIX} Live verification passed.`);
  } catch (error) {
    if (error instanceof LiveVerificationError) {
      console.error(`${PREFIX} ${error.message}`);
    } else if (error instanceof Error) {
      console.error(`${PREFIX} Verification failed: ${error.message}`);
    } else {
      console.error(`${PREFIX} Verification failed.`);
    }
    process.exitCode = 1;
  } finally {
    try {
      await pool.end();
    } catch {
      // A close failure must not hide the verification result or error.
    }
  }
}

const isDirectExecution =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectExecution) {
  void main();
}
