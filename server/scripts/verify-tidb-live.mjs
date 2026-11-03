import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDatabaseEnv } from '../src/config/env.js';
import { runLiveVerification } from '../src/db/verify-live.js';
import { createDatabasePool } from '../src/db/pool.js';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const envFile = resolve(scriptDirectory, '..', '.env.tidb.local');

try {
  process.loadEnvFile(envFile);
} catch {
  console.error('Could not load TiDB application settings.');
  process.exit(1);
}

process.env.NODE_ENV = 'production';

let pool;
try {
  const config = parseDatabaseEnv(process.env);
  if (!config) throw new Error('Application database configuration is missing.');

  pool = createDatabasePool(config);
  const report = await runLiveVerification(pool, {
    expectedUser: config.user,
    log: (message) => console.log(`[launchboard-tidb-verify] ${message}`),
  });

  console.log('[launchboard-tidb-verify] Verification passed.');
  console.log(`[launchboard-tidb-verify] Database: ${report.database}`);
  console.log(`[launchboard-tidb-verify] Version: ${report.version}`);
  console.log(`[launchboard-tidb-verify] Tables: ${report.tables.length}`);
  console.log(`[launchboard-tidb-verify] Runtime account: ${report.runtimeUser}`);
  console.log(`[launchboard-tidb-verify] Runtime grants: ${report.grants.length} grant rows checked`);
  console.log(`[launchboard-tidb-verify] Migration history: ${report.migration.version}`);
  console.log(`[launchboard-tidb-verify] Cascade rollback: ${report.cascade.safeSequenceDeleted === 1 ? 'passed' : 'unexpected result'}`);
} catch (error) {
  const code = error && typeof error === 'object' && 'check' in error
    ? String(error.check)
    : error && typeof error === 'object' && 'code' in error
      ? String(error.code)
      : 'UNKNOWN';
  console.error(`[launchboard-tidb-verify] Verification failed. Check: ${code}`);
  console.error(error instanceof Error ? error.message : 'Unexpected verification error.');
  process.exitCode = 1;
} finally {
  if (pool) await pool.end().catch(() => {});
}
