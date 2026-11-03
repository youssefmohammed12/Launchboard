import { randomBytes, randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const base = 'https://launchboard-drab.vercel.app';
const origin = base;
const email = `live-smoke-${randomUUID()}@example.test`;
const password = `Launchboard-${randomBytes(24).toString('base64url')}!Aa9`;
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
process.env.NODE_ENV = 'production';
const cookies = await import('../server/dist/auth/cookies.js');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
function cookiePair(response, name) {
  const value = response.headers.getSetCookie().find((entry) => entry.startsWith(`${name}=`));
  assert(value, `Expected ${name} cookie was not set.`);
  return value.split(';', 1)[0];
}
function cookieAttributes(response, name) {
  const value = response.headers.getSetCookie().find((entry) => entry.startsWith(`${name}=`));
  if (!value) return null;
  const attributes = value.split(';').slice(1).map((part) => part.trim().split('=', 1)[0].toLowerCase());
  return {
    secure: attributes.includes('secure'),
    httpOnly: attributes.includes('httponly'),
    sameSiteLax: value.toLowerCase().includes('samesite=lax'),
    pathRoot: value.toLowerCase().includes('path=/'),
    hostPrefix: name.startsWith('__Host-'),
  };
}
async function request(path, options) {
  return fetch(base + path, { redirect: 'manual', ...options });
}
async function expectStatus(response, expected, label) {
  if (response.status !== expected) {
    const body = (await response.text()).slice(0, 160).replace(/[\r\n]+/g, ' ');
    throw new Error(`${label}: expected HTTP ${expected}, received ${response.status} (${body})`);
  }
}
async function json(response, label) {
  const type = response.headers.get('content-type') || '';
  assert(type.includes('application/json'), `${label}: response was not JSON.`);
  return response.json();
}
let cleanupResult = 'not-needed';
let registered = false;
try {
  const health = await request('/api/health');
  await expectStatus(health, 200, 'Health');
  const healthData = await json(health, 'Health');
  assert(healthData.status === 'ok', 'Health returned an unexpected status.');

  const ready = await request('/api/ready');
  await expectStatus(ready, 200, 'Database readiness');
  const readyData = await json(ready, 'Database readiness');
  assert(readyData.status === 'ok' && readyData.db === 'ok', 'TiDB readiness did not pass.');

  const csrfBeforeSession = await request('/api/auth/csrf');
  await expectStatus(csrfBeforeSession, 401, 'Pre-auth CSRF bootstrap');
  await json(csrfBeforeSession, 'Pre-auth CSRF bootstrap');

  const pre = await request('/api/auth/pre-session', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin },
    body: '{}',
  });
  await expectStatus(pre, 200, 'Pre-session');
  const preData = await json(pre, 'Pre-session');
  assert(typeof preData.csrfToken === 'string' && preData.csrfToken.length > 20, 'Pre-session token missing.');
  const preCookie = cookiePair(pre, cookies.PRE_SESSION_COOKIE_NAME);

  const registration = await request('/api/auth/register', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin,
      cookie: preCookie,
      'x-csrf-token': preData.csrfToken,
    },
    body: JSON.stringify({ email, password }),
  });
  await expectStatus(registration, 201, 'Registration');
  registered = true;
  const registrationData = await json(registration, 'Registration');
  assert(registrationData.user?.email === email, 'Registration returned the wrong account.');
  assert(typeof registrationData.csrfToken === 'string', 'Registration auth CSRF token missing.');
  const sessionCookie = cookiePair(registration, cookies.SESSION_COOKIE_NAME);
  const sessionCookiePolicy = cookieAttributes(registration, cookies.SESSION_COOKIE_NAME);

  const me = await request('/api/auth/me', { headers: { cookie: sessionCookie } });
  await expectStatus(me, 200, 'Session restoration');
  const meData = await json(me, 'Session restoration');
  assert(meData.user?.email === email, 'Session restoration returned the wrong account.');

  const opportunities = await request('/api/opportunities', { headers: { cookie: sessionCookie } });
  await expectStatus(opportunities, 200, 'Authenticated opportunities read');
  await json(opportunities, 'Authenticated opportunities read');

  const logout = await request('/api/auth/logout', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin,
      cookie: sessionCookie,
      'x-csrf-token': registrationData.csrfToken,
    },
    body: '{}',
  });
  await expectStatus(logout, 204, 'Logout after registration');

  const preLogin = await request('/api/auth/pre-session', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin },
    body: '{}',
  });
  await expectStatus(preLogin, 200, 'Login pre-session');
  const preLoginData = await json(preLogin, 'Login pre-session');
  const preLoginCookie = cookiePair(preLogin, cookies.PRE_SESSION_COOKIE_NAME);

  const login = await request('/api/auth/login', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin,
      cookie: preLoginCookie,
      'x-csrf-token': preLoginData.csrfToken,
    },
    body: JSON.stringify({ email, password }),
  });
  await expectStatus(login, 200, 'Login');
  const loginData = await json(login, 'Login');
  assert(loginData.user?.email === email, 'Login returned the wrong account.');
  const loginCookie = cookiePair(login, cookies.SESSION_COOKIE_NAME);

  const meAfterLogin = await request('/api/auth/me', { headers: { cookie: loginCookie } });
  await expectStatus(meAfterLogin, 200, 'Session after login');
  const afterLoginData = await json(meAfterLogin, 'Session after login');
  assert(afterLoginData.user?.email === email, 'Login session restored the wrong account.');

  const logoutAfterLogin = await request('/api/auth/logout', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin,
      cookie: loginCookie,
      'x-csrf-token': loginData.csrfToken,
    },
    body: '{}',
  });
  await expectStatus(logoutAfterLogin, 204, 'Logout after login');

  console.log(JSON.stringify({
    result: 'passed',
    checks: [
      'health endpoint',
      'TiDB readiness endpoint',
      'nested auth routes',
      'pre-auth CSRF and session cookie',
      'registration',
      'secure session restoration',
      'authenticated opportunity collection read',
      'logout',
      'login',
      'post-login session restoration',
      'second logout',
    ],
    sessionCookiePolicy,
    disposableAccountCreated: registered,
  }, null, 2));
} finally {
  // Delete only the uniquely generated smoke-test email; never print credentials.
  try {
    process.loadEnvFile(resolve(scriptDirectory, '..', 'server', '.env.tidb.local'));
    const { parseDatabaseEnv } = await import('../server/dist/config/env.js');
    const { createDatabasePool } = await import('../server/dist/db/pool.js');
    const config = parseDatabaseEnv(process.env);
    assert(config, 'Local TiDB cleanup configuration was not available.');
    const pool = createDatabasePool(config);
    try {
      const [result] = await pool.execute('DELETE FROM users WHERE email = ?', [email]);
      cleanupResult = result.affectedRows === 1 ? 'removed' : 'no-row-found';
    } finally {
      await pool.end();
    }
  } catch {
    cleanupResult = 'failed';
  }
  console.log(`Disposable account cleanup: ${cleanupResult}`);
}
