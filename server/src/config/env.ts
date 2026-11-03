import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Runtime modes the server understands. */
export const NODE_ENVS = ['development', 'test', 'production'] as const;
export type NodeEnv = (typeof NODE_ENVS)[number];

export interface EnvConfig {
  nodeEnv: NodeEnv;
  host: string;
  port: number;
}

/** The only database Launchboard is allowed to use. */
export const LAUNCHBOARD_DATABASE = 'launchboard' as const;
export const DEFAULT_DB_HOST = '127.0.0.1';
export const DEFAULT_DB_PORT = 3306;

export interface DatabaseConfig {
  host: string;
  port: number;
  database: typeof LAUNCHBOARD_DATABASE;
  user: string;
  password: string;
  /** Require a TLS connection; enabled explicitly for TiDB Serverless. */
  ssl?: boolean;
  /** Optional PEM-encoded database CA for providers that require a custom CA. */
  sslCa?: string;
  /** Use a smaller pool when this config belongs to a serverless function. */
  serverless?: boolean;
}

export interface EnvIssue {
  /** The setting name only. Never a setting value. */
  name: string;
  /** A safe explanation that contains no environment values. */
  message: string;
}

/**
 * Raised when the environment is unusable. The message lists setting names and
 * safe explanations, never the values, because a value may be a secret.
 */
export class EnvValidationError extends Error {
  readonly issues: readonly EnvIssue[];

  constructor(issues: readonly EnvIssue[]) {
    super(
      `Invalid environment configuration: ${issues
        .map((issue) => `${issue.name} ${issue.message}`)
        .join('; ')}`,
    );
    this.name = 'EnvValidationError';
    this.issues = issues;
  }
}

const DEFAULT_ENV_FILE = fileURLToPath(new URL('../../.env', import.meta.url));

/**
 * Loads a `.env` file through Node's built-in loader. Missing files are not an
 * error, and existing process variables take precedence over file values.
 * Parse failures are reported without echoing file contents.
 */
export function loadEnvFile(filePath: string = DEFAULT_ENV_FILE): boolean {
  if (!existsSync(filePath)) return false;
  try {
    process.loadEnvFile(filePath);
  } catch {
    throw new EnvValidationError([
      { name: '.env', message: 'could not be read or parsed' },
    ]);
  }
  return true;
}

function readSetting(source: NodeJS.ProcessEnv, name: string): string | undefined {
  const raw = source[name];
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  return trimmed === '' ? undefined : trimmed;
}

/**
 * Parses and validates the supported environment without starting a listener.
 * Defaults are deliberately local-development safe: loopback host, port 3000.
 */
export function parseEnv(source: NodeJS.ProcessEnv = process.env): EnvConfig {
  const issues: EnvIssue[] = [];

  const nodeEnvRaw = readSetting(source, 'NODE_ENV');
  let nodeEnv: NodeEnv = 'development';
  if (nodeEnvRaw !== undefined) {
    if ((NODE_ENVS as readonly string[]).includes(nodeEnvRaw)) {
      nodeEnv = nodeEnvRaw as NodeEnv;
    } else {
      issues.push({
        name: 'NODE_ENV',
        message: `must be one of ${NODE_ENVS.join(', ')}`,
      });
    }
  }

  const hostRaw = readSetting(source, 'HOST');
  let host = '127.0.0.1';
  if (hostRaw !== undefined) {
    if (/\s/.test(hostRaw) || hostRaw.length > 255) {
      issues.push({
        name: 'HOST',
        message: 'must be a host name without whitespace',
      });
    } else {
      host = hostRaw;
    }
  }

  const portRaw = readSetting(source, 'PORT');
  let port = 3000;
  if (portRaw !== undefined) {
    const parsed = /^\d+$/.test(portRaw) ? Number(portRaw) : Number.NaN;
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
      issues.push({
        name: 'PORT',
        message: 'must be an integer between 1 and 65535',
      });
    } else {
      port = parsed;
    }
  }

  if (issues.length > 0) throw new EnvValidationError(issues);
  return { nodeEnv, host, port };
}

const DATABASE_SETTING_NAMES = [
  'DB_HOST',
  'DB_PORT',
  'DB_NAME',
  'DB_USER',
  'DB_PASSWORD',
  'DB_SSL',
  'DB_SSL_CA',
] as const;

/** Settings shared by the runtime and migration connections. */
const SHARED_DATABASE_SETTING_NAMES = [
  'DB_HOST',
  'DB_PORT',
  'DB_NAME',
  'DB_SSL',
  'DB_SSL_CA',
] as const;

/**
 * Migration credentials are deliberately separate from `DB_USER` and
 * `DB_PASSWORD`. There is no fallback between the two credential sets.
 */
const MIGRATION_SETTING_NAMES = [
  'DB_MIGRATION_USER',
  'DB_MIGRATION_PASSWORD',
] as const;

interface SharedDatabaseSettings {
  host: string;
  port: number;
  database: typeof LAUNCHBOARD_DATABASE;
  ssl?: boolean;
  sslCa?: string;
}

/**
 * Validates the host, port and target database shared by both connection
 * kinds. `DB_NAME` is never defaulted and must be exactly `launchboard`.
 */
function parseSharedDatabaseSettings(
  source: NodeJS.ProcessEnv,
  issues: EnvIssue[],
): SharedDatabaseSettings {
  const hostRaw = readSetting(source, 'DB_HOST');
  let host = DEFAULT_DB_HOST;
  if (hostRaw !== undefined) {
    if (/\s/.test(hostRaw) || hostRaw.length > 255) {
      issues.push({
        name: 'DB_HOST',
        message: 'must be a host name without whitespace',
      });
    } else {
      host = hostRaw;
    }
  }

  const portRaw = readSetting(source, 'DB_PORT');
  let port = DEFAULT_DB_PORT;
  if (portRaw !== undefined) {
    const parsed = /^\d+$/.test(portRaw) ? Number(portRaw) : Number.NaN;
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
      issues.push({
        name: 'DB_PORT',
        message: 'must be an integer between 1 and 65535',
      });
    } else {
      port = parsed;
    }
  }

  const databaseRaw = readSetting(source, 'DB_NAME');
  if (databaseRaw === undefined) {
    issues.push({ name: 'DB_NAME', message: 'must be set' });
  } else if (databaseRaw !== LAUNCHBOARD_DATABASE) {
    issues.push({
      name: 'DB_NAME',
      message: `must be exactly ${LAUNCHBOARD_DATABASE}`,
    });
  }

  const sslCaRaw = readSetting(source, 'DB_SSL_CA');
  let sslCa: string | undefined;
  if (sslCaRaw !== undefined) {
    if (
      !sslCaRaw.includes('-----BEGIN CERTIFICATE-----') ||
      !sslCaRaw.includes('-----END CERTIFICATE-----')
    ) {
      issues.push({
        name: 'DB_SSL_CA',
        message: 'must contain a PEM-encoded certificate',
      });
    } else {
      sslCa = sslCaRaw;
    }
  }

  const sslRaw = readSetting(source, 'DB_SSL');
  let ssl = sslCa !== undefined || readSetting(source, 'NODE_ENV') === 'production';
  if (sslRaw !== undefined) {
    if (sslRaw !== 'true' && sslRaw !== 'false') {
      issues.push({ name: 'DB_SSL', message: 'must be true or false' });
    } else {
      ssl = sslRaw === 'true';
      if (readSetting(source, 'NODE_ENV') === 'production' && !ssl) {
        issues.push({
          name: 'DB_SSL',
          message: 'cannot be disabled in production',
        });
      }
    }
  }
  if (sslCa !== undefined && !ssl) {
    issues.push({
      name: 'DB_SSL',
      message: 'must be true when DB_SSL_CA is supplied',
    });
  }

  return {
    host,
    port,
    database: LAUNCHBOARD_DATABASE,
    ...(ssl ? { ssl: true } : {}),
    ...(sslCa === undefined ? {} : { sslCa }),
  };
}

/**
 * Parses the optional runtime database settings used by the application server,
 * its pool and readiness checks. A completely absent runtime block is valid:
 * the process can still serve `/api/health`, while `/api/ready` reports that the
 * database is not configured.
 *
 * Once any runtime database setting is present, the block must be complete.
 * Migration-only settings are ignored here, so they cannot enable a runtime
 * database connection. Error messages name the setting and the rule, never a
 * value, because `DB_PASSWORD` is a secret.
 */
export function parseDatabaseEnv(
  source: NodeJS.ProcessEnv = process.env,
): DatabaseConfig | null {
  const hasAnySetting = DATABASE_SETTING_NAMES.some(
    (name) => source[name] !== undefined,
  );
  if (!hasAnySetting) return null;

  const issues: EnvIssue[] = [];
  const shared = parseSharedDatabaseSettings(source, issues);

  const userRaw = readSetting(source, 'DB_USER');
  if (userRaw === undefined) {
    issues.push({ name: 'DB_USER', message: 'must be set' });
  } else if (/\s/.test(userRaw) || userRaw.length > 128) {
    issues.push({
      name: 'DB_USER',
      message: 'must be a user name without whitespace',
    });
  }

  const passwordRaw = source.DB_PASSWORD;
  if (typeof passwordRaw !== 'string') {
    issues.push({
      name: 'DB_PASSWORD',
      message:
        'must be set (it may be empty only if the database user intentionally has no password)',
    });
  }

  if (issues.length > 0) throw new EnvValidationError(issues);

  return {
    ...shared,
    user: userRaw as string,
    password: passwordRaw as string,
  };
}

/**
 * Parses the migration-only credentials used by `npm run db:migrate`.
 *
 * `DB_MIGRATION_USER` and `DB_MIGRATION_PASSWORD` must both be provided
 * explicitly. Runtime `DB_USER` and `DB_PASSWORD` are intentionally ignored:
 * the migration command never falls back to the application account.
 *
 * The shared host, port and database settings are reused and validated with the
 * same rules as the runtime connection, including the exact `launchboard`
 * target guard. Returns `null` when neither migration nor shared database
 * settings are present so the CLI can report a clear missing-configuration
 * error.
 */
export function parseMigrationDatabaseEnv(
  source: NodeJS.ProcessEnv = process.env,
): DatabaseConfig | null {
  const hasAnyMigrationSetting = MIGRATION_SETTING_NAMES.some(
    (name) => source[name] !== undefined,
  );
  const hasAnySharedSetting = SHARED_DATABASE_SETTING_NAMES.some(
    (name) => source[name] !== undefined,
  );
  if (!hasAnyMigrationSetting && !hasAnySharedSetting) return null;

  const issues: EnvIssue[] = [];
  const shared = parseSharedDatabaseSettings(source, issues);

  const userRaw = readSetting(source, 'DB_MIGRATION_USER');
  if (userRaw === undefined) {
    issues.push({ name: 'DB_MIGRATION_USER', message: 'must be set' });
  } else if (/\s/.test(userRaw) || userRaw.length > 128) {
    issues.push({
      name: 'DB_MIGRATION_USER',
      message: 'must be a user name without whitespace',
    });
  }

  const passwordRaw = source.DB_MIGRATION_PASSWORD;
  if (typeof passwordRaw !== 'string') {
    issues.push({
      name: 'DB_MIGRATION_PASSWORD',
      message:
        'must be set (it may be empty only if the migration user intentionally has no password)',
    });
  }

  if (issues.length > 0) throw new EnvValidationError(issues);

  return {
    ...shared,
    user: userRaw as string,
    password: passwordRaw as string,
  };
}

export interface AuthEnvConfig {
  csrfSecret: string;
  trustedOrigins: string[];
}

export function parseAuthEnv(source: NodeJS.ProcessEnv = process.env): AuthEnvConfig | null {
  // Cryptographic secrets must be consumed exactly as supplied; never trim or
  // silently normalize whitespace or padding.
  const csrfSecretRaw = source.CSRF_SECRET;
  const trustedRaw = source.TRUSTED_ORIGINS;

  if (csrfSecretRaw === undefined && trustedRaw === undefined) {
    return null;
  }

  const issues: EnvIssue[] = [];

  if (typeof csrfSecretRaw !== 'string' || csrfSecretRaw.length === 0) {
    issues.push({ name: 'CSRF_SECRET', message: 'must be set' });
  } else if (!/^[A-Za-z0-9_-]+$/.test(csrfSecretRaw)) {
    issues.push({
      name: 'CSRF_SECRET',
      message: 'must be canonical unpadded base64url',
    });
  } else {
    const decoded = Buffer.from(csrfSecretRaw, 'base64url');
    if (decoded.toString('base64url') !== csrfSecretRaw) {
      issues.push({
        name: 'CSRF_SECRET',
        message: 'must be canonical unpadded base64url',
      });
    } else if (decoded.length < 32) {
      issues.push({ name: 'CSRF_SECRET', message: 'must be at least 32 bytes' });
    }
  }

  if (typeof trustedRaw !== 'string' || trustedRaw.trim() === '') {
    issues.push({ name: 'TRUSTED_ORIGINS', message: 'must be set' });
  }

  const trustedOrigins =
    typeof trustedRaw === 'string'
      ? trustedRaw.split(',').map((origin) => origin.trim())
      : [];

  if (trustedOrigins.some((origin) => origin.length === 0)) {
    issues.push({
      name: 'TRUSTED_ORIGINS',
      message: 'must contain only non-empty exact origins',
    });
  }

  for (const origin of trustedOrigins) {
    if (origin.length === 0) continue;

    try {
      const url = new URL(origin);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        issues.push({
          name: 'TRUSTED_ORIGINS',
          message: 'must use HTTP or HTTPS origins',
        });
        break;
      }
      if (url.username || url.password) {
        issues.push({ name: 'TRUSTED_ORIGINS', message: 'must not contain credentials' });
        break;
      }
      if (url.hostname.includes('*')) {
        issues.push({ name: 'TRUSTED_ORIGINS', message: 'must not contain wildcards' });
        break;
      }
      if (url.pathname !== '/' || url.search || url.hash) {
        issues.push({ name: 'TRUSTED_ORIGINS', message: 'must be exact origins' });
        break;
      }
      const canonicalOrigin = url.protocol + '//' + url.host;
      if (origin !== canonicalOrigin) {
        issues.push({ name: 'TRUSTED_ORIGINS', message: 'must be canonical exact origins' });
        break;
      }
    } catch {
      issues.push({ name: 'TRUSTED_ORIGINS', message: 'must be valid exact origins' });
      break;
    }
  }

  if (issues.length > 0) throw new EnvValidationError(issues);
  return { csrfSecret: csrfSecretRaw as string, trustedOrigins };
}

export interface EmailServiceConfig {
  smtpUser: string;
  smtpPassword: string;
  appBaseUrl: string;
}

/**
 * Parses Gmail SMTP credentials and the canonical application origin.
 * Google app passwords are sometimes displayed in four-character groups, so
 * whitespace is removed before validating the 16-character credential.
 */
export function parseEmailEnv(
  source: NodeJS.ProcessEnv = process.env,
): EmailServiceConfig | null {
  const smtpUserRaw = source.SMTP_USER;
  const smtpPasswordRaw = source.SMTP_PASS;
  const appBaseUrlRaw = source.APP_BASE_URL;

  const hasAny =
    smtpUserRaw !== undefined ||
    smtpPasswordRaw !== undefined ||
    appBaseUrlRaw !== undefined;
  if (!hasAny) return null;

  const issues: EnvIssue[] = [];
  const smtpUser = readSetting(source, 'SMTP_USER');
  const smtpPassword =
    typeof smtpPasswordRaw === 'string'
      ? smtpPasswordRaw.replace(/\s/g, '')
      : undefined;
  const appBaseUrl = readSetting(source, 'APP_BASE_URL');

  if (smtpUser === undefined) {
    issues.push({ name: 'SMTP_USER', message: 'must be set' });
  } else if (
    smtpUser.length > 254 ||
    !/^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@(?:gmail\.com|googlemail\.com)$/i.test(smtpUser)
  ) {
    issues.push({
      name: 'SMTP_USER',
      message: 'must be a valid Gmail or Google Mail address',
    });
  }

  if (smtpPassword === undefined || smtpPassword.length === 0) {
    issues.push({ name: 'SMTP_PASS', message: 'must be set' });
  } else if (!/^[A-Za-z0-9]{16}$/.test(smtpPassword)) {
    issues.push({
      name: 'SMTP_PASS',
      message: 'must be a 16-character Google app password',
    });
  }

  if (appBaseUrl === undefined) {
    issues.push({ name: 'APP_BASE_URL', message: 'must be set' });
  } else {
    try {
      const url = new URL(appBaseUrl);
      const nodeEnv = readSetting(source, 'NODE_ENV') ?? 'development';
      const isLocalHttp =
        url.protocol === 'http:' &&
        (url.hostname === 'localhost' ||
          url.hostname === '127.0.0.1' ||
          url.hostname === '[::1]') &&
        nodeEnv !== 'production';

      if (
        (url.protocol !== 'https:' && !isLocalHttp) ||
        url.username ||
        url.password ||
        url.pathname !== '/' ||
        url.search ||
        url.hash ||
        url.origin !== appBaseUrl
      ) {
        issues.push({
          name: 'APP_BASE_URL',
          message: 'must be an exact canonical HTTPS origin (HTTP localhost is allowed in development)',
        });
      }
    } catch {
      issues.push({
        name: 'APP_BASE_URL',
        message: 'must be a valid exact application origin',
      });
    }
  }

  if (issues.length > 0) throw new EnvValidationError(issues);

  return {
    smtpUser: smtpUser as string,
    smtpPassword: smtpPassword as string,
    appBaseUrl: appBaseUrl as string,
  };
}