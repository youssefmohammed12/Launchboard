import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseMigrationDatabaseEnv } from '../src/config/env.js';
import { runMigrations } from '../src/db/migrate.js';
import { createDatabasePool } from '../src/db/pool.js';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const envFile = resolve(scriptDirectory, '..', '.env.tidb.local');

try {
  process.loadEnvFile(envFile);
} catch {
  console.error('Could not load TiDB migration settings.');
  process.exit(1);
}

process.env.NODE_ENV = 'production';

let pool;
try {
  const config = parseMigrationDatabaseEnv(process.env);
  if (!config) throw new Error('Migration configuration is missing.');

  pool = createDatabasePool(config);
  const result = await runMigrations(pool, {
    log: (message) => console.log(`[launchboard-tidb] ${message}`),
  });

  console.log(
    `[launchboard-tidb] Migration run complete. Applied: ${result.applied.length}; already applied: ${result.skipped.length}.`,
  );
  if (result.applied.length) {
    console.log(`[launchboard-tidb] Applied versions: ${result.applied.join(', ')}`);
  }
  if (result.skipped.length) {
    console.log(`[launchboard-tidb] Existing versions: ${result.skipped.join(', ')}`);
  }
} catch (error) {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : 'UNKNOWN';
  console.error(`[launchboard-tidb] Migration failed. Error code: ${code}`);
  console.error(error instanceof Error ? error.message : 'Unexpected migration error.');
  process.exitCode = 1;
} finally {
  if (pool) await pool.end().catch(() => {});
}
