import { createApp } from './app.js';
import {
  EnvValidationError,
  parseAuthEnv,
  parseDatabaseEnv,
  parseEnv,
} from './config/env.js';
import { checkDatabaseReadiness, createDatabasePool } from './db/pool.js';

// Vercel supplies secrets through project environment variables. Unlike the
// local server entry point, this module never reads a local .env file.
const runtime = parseEnv(process.env);
if (runtime.nodeEnv !== 'production') {
  throw new EnvValidationError([
    { name: 'NODE_ENV', message: 'must be production for the Vercel API handler' },
  ]);
}

if (!parseAuthEnv(process.env)) {
  throw new EnvValidationError([
    { name: 'CSRF_SECRET', message: 'and TRUSTED_ORIGINS must be configured' },
  ]);
}

const databaseConfig = parseDatabaseEnv(process.env);
if (!databaseConfig) {
  throw new EnvValidationError([
    { name: 'DB_HOST', message: 'database environment variables must be configured' },
  ]);
}

// Reuse one small pool for warm function invocations. A single Vercel function
// instance should not open the default ten-connection local-development pool.
const pool = createDatabasePool({
  ...databaseConfig,
  ssl: true,
  serverless: true,
});

export const vercelApp = createApp({
  database: {
    check: () => checkDatabaseReadiness(pool),
  },
  dbPool: pool,
});

// Vercel terminates HTTPS and forwards the original client address through one
// trusted proxy hop. Do not enable blanket proxy trust.
vercelApp.set('trust proxy', 1);
