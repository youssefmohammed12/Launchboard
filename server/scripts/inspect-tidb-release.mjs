import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDatabaseEnv } from '../src/config/env.js';
import { createDatabasePool } from '../src/db/pool.js';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
process.loadEnvFile(resolve(scriptDirectory, '..', '.env.tidb.local'));
process.env.NODE_ENV = 'production';

const config = parseDatabaseEnv();
if (!config) throw new Error('TiDB runtime configuration is missing.');

const pool = createDatabasePool(config);
try {
  const [identityRows] = await pool.execute(
    'SELECT DATABASE() AS database_name, VERSION() AS server_version',
  );
  const [migrationRows] = await pool.execute(
    'SELECT version FROM schema_migrations ORDER BY version',
  );
  const [userRows] = await pool.execute(
    'SELECT COUNT(*) AS total_users FROM users',
  );
  const [sessionRows] = await pool.execute(
    'SELECT COUNT(*) AS active_sessions FROM sessions WHERE revoked_at IS NULL',
  );
  const [verificationColumnRows] = await pool.execute(
    `SELECT COUNT(*) AS present
     FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name = 'users'
       AND column_name = 'email_verified_at'`,
  );
  const [actionTokenTableRows] = await pool.execute(
    `SELECT COUNT(*) AS present
     FROM information_schema.tables
     WHERE table_schema = DATABASE()
       AND table_name = 'auth_action_tokens'`,
  );

  const identity = identityRows[0];
  console.log(JSON.stringify({
    database: identity.database_name,
    serverVersion: identity.server_version,
    matchesVercelProductionHost: config.host === 'gateway01.eu-central-1.prod.aws.tidbcloud.com',
    migrationVersions: migrationRows.map((row) => row.version),
    totalUsers: Number(userRows[0].total_users),
    activeSessions: Number(sessionRows[0].active_sessions),
    emailVerificationColumnPresent: Number(verificationColumnRows[0].present) === 1,
    accountActionTokenTablePresent: Number(actionTokenTableRows[0].present) === 1,
  }, null, 2));
} finally {
  await pool.end();
}
