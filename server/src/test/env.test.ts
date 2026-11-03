import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  EnvValidationError,
  LAUNCHBOARD_DATABASE,
  loadEnvFile,
  parseDatabaseEnv,
  parseEnv,
  parseMigrationDatabaseEnv,
} from '../config/env.js';

const validCaCertificate = "-----BEGIN CERTIFICATE-----\nY2VydGlmaWNhdGUtcGFyc2VyLXRlc3Q=\n-----END CERTIFICATE-----";

const touchedEnvNames: string[] = [];

function trackEnv(name: string): void {
  touchedEnvNames.push(name);
}

afterEach(() => {
  for (const name of touchedEnvNames.splice(0)) delete process.env[name];
});

describe('parseEnv', () => {
  it('uses local-development defaults', () => {
    expect(parseEnv({})).toEqual({
      nodeEnv: 'development',
      host: '127.0.0.1',
      port: 3000,
    });
  });

  it('accepts supported values and trims surrounding whitespace', () => {
    expect(
      parseEnv({ NODE_ENV: ' production ', HOST: ' 0.0.0.0 ', PORT: ' 8080 ' }),
    ).toEqual({ nodeEnv: 'production', host: '0.0.0.0', port: 8080 });
  });

  it('treats empty values as unset', () => {
    expect(parseEnv({ NODE_ENV: '', HOST: '   ', PORT: '' })).toEqual({
      nodeEnv: 'development',
      host: '127.0.0.1',
      port: 3000,
    });
  });

  it('rejects unsupported NODE_ENV values', () => {
    expect(() => parseEnv({ NODE_ENV: 'staging' })).toThrow(EnvValidationError);
    try {
      parseEnv({ NODE_ENV: 'staging' });
    } catch (error) {
      expect(error).toBeInstanceOf(EnvValidationError);
      expect((error as EnvValidationError).issues).toEqual([
        {
          name: 'NODE_ENV',
          message: 'must be one of development, test, production',
        },
      ]);
    }
  });

  it.each(['0', '65536', 'abc', '3000.5', '-1', '1e3', '0x10'])(
    'rejects invalid PORT value %s',
    (port) => {
      expect(() => parseEnv({ PORT: port })).toThrow(EnvValidationError);
    },
  );

  it('accepts the boundary ports 1 and 65535', () => {
    expect(parseEnv({ PORT: '1' }).port).toBe(1);
    expect(parseEnv({ PORT: '65535' }).port).toBe(65535);
  });

  it('rejects a host containing whitespace', () => {
    expect(() => parseEnv({ HOST: 'local host' })).toThrow(EnvValidationError);
  });

  it('reports every invalid setting without echoing values', () => {
    const secretPort = 'super-secret-port-value';
    const secretNodeEnv = 'super-secret-node-env';
    let caught: EnvValidationError | null = null;
    try {
      parseEnv({ PORT: secretPort, NODE_ENV: secretNodeEnv });
    } catch (error) {
      caught = error as EnvValidationError;
    }

    expect(caught).toBeInstanceOf(EnvValidationError);
    expect(caught?.issues.map((issue) => issue.name)).toEqual([
      'NODE_ENV',
      'PORT',
    ]);
    expect(caught?.message).toContain('NODE_ENV');
    expect(caught?.message).toContain('PORT');
    expect(caught?.message).not.toContain(secretPort);
    expect(caught?.message).not.toContain(secretNodeEnv);
  });
});

describe('loadEnvFile', () => {
  it('returns false when the file does not exist', () => {
    const directory = mkdtempSync(join(tmpdir(), 'launchboard-env-'));
    try {
      expect(loadEnvFile(join(directory, 'missing.env'))).toBe(false);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('loads values without overriding existing process variables', () => {
    const directory = mkdtempSync(join(tmpdir(), 'launchboard-env-'));
    const file = join(directory, '.env');
    const existingName = 'LAUNCHBOARD_TEST_EXISTING';
    const newName = 'LAUNCHBOARD_TEST_NEW';
    trackEnv(existingName);
    trackEnv(newName);
    process.env[existingName] = 'from-shell';
    writeFileSync(file, `${existingName}=from-file\n${newName}=from-file\n`);

    try {
      expect(loadEnvFile(file)).toBe(true);
      expect(process.env[existingName]).toBe('from-shell');
      expect(process.env[newName]).toBe('from-file');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('reports an unreadable .env without exposing its path or contents', () => {
    const directory = mkdtempSync(join(tmpdir(), 'launchboard-env-'));
    try {
      expect(() => loadEnvFile(directory)).toThrow(EnvValidationError);
      try {
        loadEnvFile(directory);
      } catch (error) {
        expect((error as EnvValidationError).message).not.toContain(directory);
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe('parseDatabaseEnv', () => {
  it('treats a completely absent database block as unconfigured', () => {
    expect(parseDatabaseEnv({})).toBeNull();
  });

  it('accepts a complete configuration with an intentionally empty password', () => {
    expect(
      parseDatabaseEnv({
        DB_HOST: ' db.local ',
        DB_PORT: ' 3307 ',
        DB_NAME: 'launchboard',
        DB_USER: 'launchboard_app',
        DB_PASSWORD: '',
      }),
    ).toEqual({
      host: 'db.local',
      port: 3307,
      database: LAUNCHBOARD_DATABASE,
      user: 'launchboard_app',
      password: '',
    });
  });

  it('defaults the host and port when only the required settings are present', () => {
    expect(
      parseDatabaseEnv({
        DB_NAME: 'launchboard',
        DB_USER: 'launchboard_app',
        DB_PASSWORD: 'secret',
      }),
    ).toEqual({
      host: '127.0.0.1',
      port: 3306,
      database: LAUNCHBOARD_DATABASE,
      user: 'launchboard_app',
      password: 'secret',
    });
  });

  it('preserves password whitespace rather than trimming a secret', () => {
    expect(
      parseDatabaseEnv({
        DB_NAME: 'launchboard',
        DB_USER: 'launchboard_app',
        DB_PASSWORD: '  secret with spaces  ',
      })?.password,
    ).toBe('  secret with spaces  ');
  });

  it('accepts a PEM CA certificate for a production database connection', () => {
    expect(
      parseDatabaseEnv({
        NODE_ENV: 'production',
        DB_NAME: 'launchboard',
        DB_USER: 'launchboard_app',
        DB_PASSWORD: 'secret',
        DB_SSL_CA: validCaCertificate,
      }),
    ).toMatchObject({ sslCa: validCaCertificate });
  });

  it('enables verified TLS by default for production database connections', () => {
    expect(
      parseDatabaseEnv({
        NODE_ENV: 'production',
        DB_NAME: 'launchboard',
        DB_USER: 'launchboard_app',
        DB_PASSWORD: 'secret',
      }),
    ).toMatchObject({ ssl: true });
  });

  it('allows an explicit TLS setting for TiDB Serverless', () => {
    expect(
      parseDatabaseEnv({
        NODE_ENV: 'production',
        DB_NAME: 'launchboard',
        DB_USER: 'launchboard_app',
        DB_PASSWORD: 'secret',
        DB_SSL: 'true',
      }),
    ).toMatchObject({ ssl: true });
  });

  it('rejects invalid TLS setting values without exposing them', () => {
    expect(() =>
      parseDatabaseEnv({
        DB_NAME: 'launchboard',
        DB_USER: 'launchboard_app',
        DB_PASSWORD: 'secret',
        DB_SSL: 'sometimes-secret',
      }),
    ).toThrow(EnvValidationError);
  });

  it('does not allow TLS to be disabled in production', () => {
    expect(() =>
      parseDatabaseEnv({
        NODE_ENV: 'production',
        DB_NAME: 'launchboard',
        DB_USER: 'launchboard_app',
        DB_PASSWORD: 'secret',
        DB_SSL: 'false',
      }),
    ).toThrow(EnvValidationError);
  });

  it('does not allow a custom CA to be configured while TLS is disabled', () => {
    expect(() =>
      parseDatabaseEnv({
        DB_NAME: 'launchboard',
        DB_USER: 'launchboard_app',
        DB_PASSWORD: 'secret',
        DB_SSL: 'false',
        DB_SSL_CA: validCaCertificate,
      }),
    ).toThrow(EnvValidationError);
  });

  it('rejects malformed database CA certificate contents', () => {
    expect(() =>
      parseDatabaseEnv({
        DB_NAME: 'launchboard',
        DB_USER: 'launchboard_app',
        DB_PASSWORD: 'secret',
        DB_SSL_CA: 'not-a-pem-certificate',
      }),
    ).toThrow(EnvValidationError);
  });

  it('refuses any database name other than launchboard', () => {
    let caught: EnvValidationError | null = null;
    try {
      parseDatabaseEnv({
        DB_NAME: 'healthbridge',
        DB_USER: 'launchboard_app',
        DB_PASSWORD: 'secret',
      });
    } catch (error) {
      caught = error as EnvValidationError;
    }

    expect(caught).toBeInstanceOf(EnvValidationError);
    expect(caught?.issues.map((issue) => issue.name)).toEqual(['DB_NAME']);
    expect(caught?.message).toContain('DB_NAME');
    expect(caught?.message).toContain(LAUNCHBOARD_DATABASE);
    expect(caught?.message).not.toContain('healthbridge');
  });

  it('requires DB_NAME, DB_USER and DB_PASSWORD once any database setting exists', () => {
    let caught: EnvValidationError | null = null;
    try {
      parseDatabaseEnv({ DB_HOST: '127.0.0.1' });
    } catch (error) {
      caught = error as EnvValidationError;
    }

    expect(caught).toBeInstanceOf(EnvValidationError);
    expect(caught?.issues.map((issue) => issue.name)).toEqual([
      'DB_NAME',
      'DB_USER',
      'DB_PASSWORD',
    ]);
  });

  it.each(['0', '65536', 'abc', '3306.5', '-1', '1e3', '0x10'])(
    'rejects invalid DB_PORT value %s',
    (port) => {
      expect(() =>
        parseDatabaseEnv({
          DB_PORT: port,
          DB_NAME: 'launchboard',
          DB_USER: 'launchboard_app',
          DB_PASSWORD: 'secret',
        }),
      ).toThrow(EnvValidationError);
    },
  );

  it('accepts the boundary database ports 1 and 65535', () => {
    const base = {
      DB_NAME: 'launchboard',
      DB_USER: 'launchboard_app',
      DB_PASSWORD: 'secret',
    };
    expect(parseDatabaseEnv({ ...base, DB_PORT: '1' })?.port).toBe(1);
    expect(parseDatabaseEnv({ ...base, DB_PORT: '65535' })?.port).toBe(65535);
  });

  it('rejects whitespace in the database host or user', () => {
    expect(() =>
      parseDatabaseEnv({
        DB_HOST: 'local host',
        DB_NAME: 'launchboard',
        DB_USER: 'launchboard_app',
        DB_PASSWORD: 'secret',
      }),
    ).toThrow(EnvValidationError);

    expect(() =>
      parseDatabaseEnv({
        DB_NAME: 'launchboard',
        DB_USER: 'launch board',
        DB_PASSWORD: 'secret',
      }),
    ).toThrow(EnvValidationError);
  });

  it('never echoes the password in a validation message', () => {
    const secret = 'super-secret-password';
    let caught: EnvValidationError | null = null;
    try {
      parseDatabaseEnv({
        DB_HOST: 'bad host',
        DB_NAME: 'launchboard',
        DB_USER: 'launchboard_app',
        DB_PASSWORD: secret,
      });
    } catch (error) {
      caught = error as EnvValidationError;
    }

    expect(caught).toBeInstanceOf(EnvValidationError);
    expect(caught?.message).not.toContain(secret);
  });

  it('ignores migration-only settings and stays unconfigured without runtime settings', () => {
    expect(
      parseDatabaseEnv({
        DB_MIGRATION_USER: 'launchboard_migrator',
        DB_MIGRATION_PASSWORD: 'migration-secret',
      }),
    ).toBeNull();
  });
});

describe('parseMigrationDatabaseEnv', () => {
  it('treats a completely absent migration and shared block as unconfigured', () => {
    expect(parseMigrationDatabaseEnv({})).toBeNull();
  });

  it('uses migration credentials and the shared host, port and database', () => {
    expect(
      parseMigrationDatabaseEnv({
        DB_HOST: ' db.local ',
        DB_PORT: ' 3307 ',
        DB_NAME: 'launchboard',
        DB_MIGRATION_USER: ' launchboard_migrator ',
        DB_MIGRATION_PASSWORD: 'migration-secret',
      }),
    ).toEqual({
      host: 'db.local',
      port: 3307,
      database: LAUNCHBOARD_DATABASE,
      user: 'launchboard_migrator',
      password: 'migration-secret',
    });
  });

  it('shares the production database CA with the migration connection', () => {
    expect(
      parseMigrationDatabaseEnv({
        NODE_ENV: 'production',
        DB_NAME: 'launchboard',
        DB_MIGRATION_USER: 'launchboard_migrator',
        DB_MIGRATION_PASSWORD: 'migration-secret',
        DB_SSL_CA: validCaCertificate,
      }),
    ).toMatchObject({ sslCa: validCaCertificate });
  });

  it('keeps runtime and migration credentials separate', () => {
    const source = {
      DB_NAME: 'launchboard',
      DB_USER: 'launchboard_app',
      DB_PASSWORD: 'runtime-secret',
      DB_MIGRATION_USER: 'launchboard_migrator',
      DB_MIGRATION_PASSWORD: 'migration-secret',
    };

    expect(parseDatabaseEnv(source)).toMatchObject({
      user: 'launchboard_app',
      password: 'runtime-secret',
    });
    expect(parseMigrationDatabaseEnv(source)).toMatchObject({
      user: 'launchboard_migrator',
      password: 'migration-secret',
    });
  });

  it('never falls back to runtime DB_USER or DB_PASSWORD', () => {
    let caught: EnvValidationError | null = null;
    try {
      parseMigrationDatabaseEnv({
        DB_NAME: 'launchboard',
        DB_USER: 'launchboard_app',
        DB_PASSWORD: 'runtime-secret',
      });
    } catch (error) {
      caught = error as EnvValidationError;
    }

    expect(caught).toBeInstanceOf(EnvValidationError);
    expect(caught?.issues.map((issue) => issue.name)).toEqual([
      'DB_MIGRATION_USER',
      'DB_MIGRATION_PASSWORD',
    ]);
    expect(caught?.message).not.toContain('runtime-secret');
  });

  it('requires DB_NAME and both migration settings once any relevant setting exists', () => {
    let caught: EnvValidationError | null = null;
    try {
      parseMigrationDatabaseEnv({ DB_HOST: '127.0.0.1' });
    } catch (error) {
      caught = error as EnvValidationError;
    }

    expect(caught).toBeInstanceOf(EnvValidationError);
    expect(caught?.issues.map((issue) => issue.name)).toEqual([
      'DB_NAME',
      'DB_MIGRATION_USER',
      'DB_MIGRATION_PASSWORD',
    ]);
  });

  it('rejects an incomplete migration credential pair', () => {
    expect(() =>
      parseMigrationDatabaseEnv({
        DB_NAME: 'launchboard',
        DB_MIGRATION_USER: 'launchboard_migrator',
      }),
    ).toThrow(EnvValidationError);

    expect(() =>
      parseMigrationDatabaseEnv({
        DB_NAME: 'launchboard',
        DB_MIGRATION_PASSWORD: 'migration-secret',
      }),
    ).toThrow(EnvValidationError);
  });

  it('refuses any database name other than launchboard before connecting', () => {
    let caught: EnvValidationError | null = null;
    try {
      parseMigrationDatabaseEnv({
        DB_NAME: 'nova_home',
        DB_MIGRATION_USER: 'launchboard_migrator',
        DB_MIGRATION_PASSWORD: 'migration-secret',
      });
    } catch (error) {
      caught = error as EnvValidationError;
    }

    expect(caught).toBeInstanceOf(EnvValidationError);
    expect(caught?.issues.map((issue) => issue.name)).toEqual(['DB_NAME']);
    expect(caught?.message).toContain(LAUNCHBOARD_DATABASE);
    expect(caught?.message).not.toContain('nova_home');
  });

  it('never echoes the migration password in a validation message', () => {
    const secret = 'super-secret-migration-password';
    let caught: EnvValidationError | null = null;
    try {
      parseMigrationDatabaseEnv({
        DB_HOST: 'bad host',
        DB_NAME: 'launchboard',
        DB_MIGRATION_USER: 'launchboard_migrator',
        DB_MIGRATION_PASSWORD: secret,
      });
    } catch (error) {
      caught = error as EnvValidationError;
    }

    expect(caught).toBeInstanceOf(EnvValidationError);
    expect(caught?.message).not.toContain(secret);
  });

  it('preserves migration password whitespace rather than trimming a secret', () => {
    expect(
      parseMigrationDatabaseEnv({
        DB_NAME: 'launchboard',
        DB_MIGRATION_USER: 'launchboard_migrator',
        DB_MIGRATION_PASSWORD: '  migration secret  ',
      })?.password,
    ).toBe('  migration secret  ');
  });
});
