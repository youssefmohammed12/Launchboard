import { createApp } from './app.js';
import {
  EnvValidationError,
  loadEnvFile,
  parseDatabaseEnv,
  parseEnv,
} from './config/env.js';
import { createDatabaseService, type DatabaseService } from './db/pool.js';

function displayHost(host: string): string {
  return host.includes(':') ? `[${host}]` : host;
}

function reportConfigError(error: EnvValidationError): void {
  console.error(`[launchboard-api] ${error.message}`);
  process.exitCode = 1;
}

function main(): void {
  try {
    loadEnvFile();
  } catch (error) {
    if (error instanceof EnvValidationError) {
      reportConfigError(error);
      return;
    }
    console.error('[launchboard-api] Could not load the .env file.');
    process.exitCode = 1;
    return;
  }

  let config;
  try {
    config = parseEnv(process.env);
  } catch (error) {
    if (error instanceof EnvValidationError) {
      reportConfigError(error);
      return;
    }
    throw error;
  }

  let database: DatabaseService | null = null;
  try {
    const databaseConfig = parseDatabaseEnv(process.env);
    if (databaseConfig !== null) {
      database = createDatabaseService(databaseConfig);
    }
  } catch (error) {
    if (error instanceof EnvValidationError) {
      reportConfigError(error);
      return;
    }
    console.error('[launchboard-api] Could not initialize the database pool.');
    process.exitCode = 1;
    return;
  }

  const app = createApp({ database });
  const server = app.listen(config.port, config.host, () => {
    console.log(
      `[launchboard-api] Listening on http://${displayHost(config.host)}:${config.port} (${config.nodeEnv}).`,
    );
    console.log(
      `[launchboard-api] Database readiness: ${database === null ? 'not configured' : 'configured'}.`,
    );
  });

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[launchboard-api] ${signal} received; shutting down.`);
    server.close(async () => {
      try {
        await database?.close();
      } finally {
        process.exit(0);
      }
    });
  };
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));

  server.on('error', (error: unknown) => {
    const message = error instanceof Error ? error.message : 'unknown server error';
    console.error(`[launchboard-api] Server failed to start: ${message}`);
    process.exitCode = 1;
    void database?.close();
  });
}

main();
