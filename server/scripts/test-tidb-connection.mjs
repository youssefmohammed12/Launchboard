import mysql from 'mysql2/promise';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const envFile = resolve(scriptDirectory, '..', '.env.tidb.local');

try {
  process.loadEnvFile(envFile);
} catch {
  console.error('Could not load server/.env.tidb.local. Check that the file exists.');
  process.exit(1);
}

const required = ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'];
const missing = required.filter((key) => !process.env[key]);
if (missing.length > 0) {
  console.error(`Missing required settings in server/.env.tidb.local: ${missing.join(', ')}`);
  process.exit(1);
}

let connection;
try {
  connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: {
      minVersion: 'TLSv1.2',
      rejectUnauthorized: true,
    },
    connectTimeout: 10000,
    multipleStatements: false,
  });

  const [rows] = await connection.execute(
    'SELECT DATABASE() AS selected_database, VERSION() AS server_version',
  );
  const result = rows[0];

  if (result?.selected_database !== 'launchboard') {
    throw new Error('Connected, but the selected database was not launchboard.');
  }

  console.log('TiDB connection successful.');
  console.log(`Database: ${result.selected_database}`);
  console.log(`Server version: ${result.server_version}`);
  console.log('TLS certificate verification: enabled');
} catch (error) {
  const code =
    error && typeof error === 'object' && 'code' in error
      ? String(error.code)
      : 'UNKNOWN';
  console.error(`TiDB connection failed. Error code: ${code}`);
  console.error('No credentials or connection details were printed.');
  process.exitCode = 1;
} finally {
  if (connection) {
    try {
      await connection.end();
    } catch {
      // Ignore close errors after the diagnostic result.
    }
  }
}
