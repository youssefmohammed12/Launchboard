import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseMigrationDatabaseEnv } from '../src/config/env.js';
import { acquireUtcConnection, createDatabasePool } from '../src/db/pool.js';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
process.loadEnvFile(resolve(scriptDirectory, '..', '.env.tidb.local'));
process.env.NODE_ENV = 'production';

let pool;
let connection;
try {
  const config = parseMigrationDatabaseEnv(process.env);
  if (!config) throw new Error('Missing migration database configuration.');
  pool = createDatabasePool(config);
  connection = await acquireUtcConnection(pool);
  const [rows] = await connection.query('SHOW TABLES');
  const names = rows.map((row) => Object.values(row)[0]).filter((name) => typeof name === 'string');
  console.log(`Tables currently in launchboard: ${names.length}`);
  for (const name of names) console.log(`- ${name}`);
  if (names.length === 0) console.log('Database is empty and ready for schema setup.');
  else console.log('Database is not empty. No changes were made.');
} catch (error) {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : 'UNKNOWN';
  console.error(`Read-only database inspection failed. Error code: ${code}`);
  process.exitCode = 1;
} finally {
  connection?.release();
  if (pool) await pool.end().catch(() => {});
}
