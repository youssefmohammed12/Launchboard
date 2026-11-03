import { randomBytes, randomUUID } from 'node:crypto';

let pool = null;
let server = null;
let syntheticEmail = null;
const outboundMessages = [];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function readJson(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Expected JSON response (HTTP ${response.status}).`);
  }
}

function cookiePair(response, name) {
  const all = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie') ?? ''];

  const header = all.find((value) => value.startsWith(`${name}=`));
  assert(header, `Expected the ${name} cookie.`);
  return header.split(';', 1)[0];
}

function actionToken(message, parameter) {
  const match = message.text.match(/https?:\/\/[^\s]+/);
  assert(match, 'Expected the fake mail sender to receive an account-action URL.');
  const link = new URL(match[0]);
  const token = new URLSearchParams(link.hash.replace(/^#/, '')).get(parameter);
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
    throw new Error(
      `Expected a valid fragment token for ${parameter} (present=${Boolean(token)}, length=${token?.length ?? 0}, hashPresent=${Boolean(link.hash)}).`,
    );
  }
  return token;
}

async function expectStatus(response, status, label) {
  if (response.status !== status) {
    const body = await readJson(response);
    throw new Error(`${label} returned HTTP ${response.status} (expected ${status}; ${body.error?.code ?? 'unexpected response'}).`);
  }
  return readJson(response);
}

async function main() {
  const { loadEnvFile, parseDatabaseEnv } = await import('../src/config/env.ts');
  loadEnvFile();
  const databaseConfig = parseDatabaseEnv();
  assert(databaseConfig, 'Local runtime database configuration is missing.');
  assert(
    databaseConfig.database === 'launchboard' &&
      (databaseConfig.host === '127.0.0.1' || databaseConfig.host === 'localhost'),
    'Refusing to run account lifecycle smoke checks against a non-local database.',
  );

  // Set these before importing the cookie module, which chooses cookie names
  // based on NODE_ENV at module initialization time.
  process.env.NODE_ENV = 'development';
  process.env.CSRF_SECRET = randomBytes(32).toString('base64url');
  process.env.SMTP_USER = 'launchboard.test@gmail.com';
  process.env.SMTP_PASS = 'x'.repeat(16);
  process.env.APP_BASE_URL = 'http://127.0.0.1:5173';

  const [{ createDatabasePool }, { createApp }, cookies] = await Promise.all([
    import('../src/db/pool.ts'),
    import('../src/app.ts'),
    import('../src/auth/cookies.ts'),
  ]);

  pool = createDatabasePool(databaseConfig);
  const emailSender = async (_config, message) => {
    outboundMessages.push(message);
  };

  const app = createApp({ dbPool: pool, emailSender, logErrors: false });
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });

  const address = server.address();
  assert(address && typeof address === 'object', 'Local test server did not bind a TCP port.');
  const origin = `http://127.0.0.1:${address.port}`;
  process.env.TRUSTED_ORIGINS = origin;

  const request = (path, options = {}) => fetch(`${origin}/api${path}`, {
    ...options,
    signal: AbortSignal.timeout(10_000),
  });

  async function newPreAuth() {
    const response = await request('/auth/pre-session', {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: '{}',
    });
    const body = await expectStatus(response, 200, 'Pre-authentication bootstrap');
    return {
      cookie: cookiePair(response, cookies.PRE_SESSION_COOKIE_NAME),
      csrf: body.csrfToken,
    };
  }

  async function accountAction(path, body) {
    const preAuth = await newPreAuth();
    return request(path, {
      method: 'POST',
      headers: {
        Origin: origin,
        'Content-Type': 'application/json',
        Cookie: preAuth.cookie,
        'X-CSRF-Token': preAuth.csrf,
      },
      body: JSON.stringify(body),
    });
  }

  async function signIn(password) {
    const preAuth = await newPreAuth();
    const response = await request('/auth/login', {
      method: 'POST',
      headers: {
        Origin: origin,
        'Content-Type': 'application/json',
        Cookie: preAuth.cookie,
        'X-CSRF-Token': preAuth.csrf,
      },
      body: JSON.stringify({ email: syntheticEmail, password }),
    });
    const body = await expectStatus(response, 200, 'Sign-in');
    const session = cookiePair(response, cookies.SESSION_COOKIE_NAME);
    return { body, session };
  }

  try {
    syntheticEmail = `local-smoke+${randomUUID()}@example.test`;
    const initialPassword = 'a-local-smoke-initial-passphrase-2026';
    const changedPassword = 'a-local-smoke-new-passphrase-2026';

    const registration = await accountAction('/auth/register', {
      email: syntheticEmail,
      password: initialPassword,
    });
    const registrationBody = await expectStatus(registration, 202, 'Registration');
    assert(registrationBody.message, 'Registration should return the generic verification message.');
    const registrationCookies = typeof registration.headers.getSetCookie === 'function'
      ? registration.headers.getSetCookie()
      : [registration.headers.get('set-cookie') ?? ''];
    assert(
      registrationCookies.some((value) =>
        value.split(';', 1)[0] === `${cookies.PRE_SESSION_COOKIE_NAME}=`,
      ),
      'Registration response should clear the pre-authentication cookie.',
    );
    assert(
      !(typeof registration.headers.getSetCookie === 'function'
        ? registration.headers.getSetCookie()
        : [registration.headers.get('set-cookie') ?? ''])
        .some((value) => value.startsWith(`${cookies.SESSION_COOKIE_NAME}=`)),
      'Registration must not issue an authenticated session.',
    );
    assert(outboundMessages.length === 1, 'Registration should send one fake verification email.');

    const verificationToken = actionToken(outboundMessages[0], 'verifyEmail');
    const verification = await accountAction('/auth/verify-email', { token: verificationToken });
    const verificationBody = await expectStatus(verification, 200, 'Email verification');
    assert(verificationBody.message.includes('verified'), 'Verification should report success.');
    assert(
      !(typeof verification.headers.getSetCookie === 'function'
        ? verification.headers.getSetCookie()
        : [verification.headers.get('set-cookie') ?? ''])
        .some((value) => value.startsWith(`${cookies.SESSION_COOKIE_NAME}=`)),
      'Verification must not issue an authenticated session.',
    );

    const firstLogin = await signIn(initialPassword);
    const oldSessionCookie = firstLogin.session;
    const meBeforeReset = await request('/auth/me', {
      headers: { Cookie: oldSessionCookie },
    });
    await expectStatus(meBeforeReset, 200, 'Session restoration before reset');

    const resetRequest = await accountAction('/auth/password-reset/request', {
      email: syntheticEmail,
    });
    await expectStatus(resetRequest, 202, 'Password reset request');
    assert(outboundMessages.length === 2, 'Password reset request should send one fake reset email.');
    const resetToken = actionToken(outboundMessages[1], 'resetPassword');

    const reset = await accountAction('/auth/password-reset/confirm', {
      token: resetToken,
      password: changedPassword,
    });
    const resetBody = await expectStatus(reset, 200, 'Password reset confirmation');
    assert(resetBody.message.includes('password has been changed'), 'Reset should confirm the password change.');

    const oldSession = await request('/auth/me', {
      headers: { Cookie: oldSessionCookie },
    });
    assert(oldSession.status === 401, 'Password reset must revoke the old authenticated session.');

    const secondLogin = await signIn(changedPassword);
    const meAfterReset = await request('/auth/me', {
      headers: { Cookie: secondLogin.session },
    });
    await expectStatus(meAfterReset, 200, 'Sign-in with the new password');

    console.log('[local-account-actions] Registration -> verification -> login -> reset -> old-session revocation -> new login: PASS');
    console.log('[local-account-actions] Email delivery was stubbed; no external email was sent.');
  } finally {
    if (syntheticEmail && pool) {
      try {
        await pool.execute('DELETE FROM users WHERE email = ?', [syntheticEmail]);
        console.log('[local-account-actions] Disposable local account cleanup: complete.');
      } catch {
        console.error('[local-account-actions] Disposable local account cleanup: FAILED; manual cleanup may be required.');
      }
    }
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    await pool?.end();
  }
}

main().catch((error) => {
  console.error(`[local-account-actions] FAILED: ${error instanceof Error ? error.message : 'unknown error'}`);
  process.exitCode = 1;
});
