import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseMigrationDatabaseEnv } from '../src/config/env.js';
import { acquireUtcConnection, createDatabasePool } from '../src/db/pool.js';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const envFile = resolve(scriptDirectory, '..', '.env.tidb.local');

try {
  process.loadEnvFile(envFile);
} catch {
  console.error('Could not load server/.env.tidb.local.');
  process.exit(1);
}

process.env.NODE_ENV = 'production';

let pool;
let connection;
try {
  const config = parseMigrationDatabaseEnv(process.env);
  if (!config) throw new Error('Migration database configuration is missing.');

  pool = createDatabasePool(config);
  connection = await acquireUtcConnection(pool);

  const [rows] = await connection.execute(
    'SELECT DATABASE() AS selected_database, VERSION() AS server_version',
  );
  const result = rows[0];

  if (result?.selected_database !== 'launchboard') {
    throw new Error('Connected to an unexpected database.');
  }

  const [grantRows] = await connection.query('SHOW GRANTS FOR CURRENT_USER()');
  console.log('Launchboard migration account connected successfully.');
  console.log(`Database: ${result.selected_database}`);
  console.log(`Server version: ${result.server_version}`);
  console.log('TLS: required; certificate verification enabled');
  console.log(`Permission rows returned: ${grantRows.length}`);
} catch (error) {
  const code =
    error && typeof error === 'object' && 'code' in error
      ? String(error.code)
      : 'CONFIG_OR_UNKNOWN';
  console.error(`Migration account connection failed. Error code: ${code}`);
  console.error('No credentials or connection details were printed.');
  process.exitCode = 1;
} finally {
  connection?.release();
  if (pool) {
    try {
      await pool.end();
    } catch {
      // Ignore cleanup errors after the diagnostic result.
    }
  }
}
