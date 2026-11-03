import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDatabaseEnv } from '../src/config/env.js';
import { createDatabasePool } from '../src/db/pool.js';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
process.loadEnvFile(resolve(scriptDirectory, '..', '.env.tidb.local'));
process.env.NODE_ENV = 'production';
process.env.CSRF_SECRET = Buffer.from(randomUUID() + randomUUID()).toString('base64url');
process.env.TRUSTED_ORIGINS = 'http://127.0.0.1';

const [{ vercelApp }, cookies, tokens, sessions] = await Promise.all([
  import('../src/vercel.js'),
  import('../src/auth/cookies.js'),
  import('../src/auth/tokens.js'),
  import('../src/auth/sessionRepo.js'),
]);

const server = vercelApp.listen(0, '127.0.0.1');
await new Promise((resolvePromise, reject) => {
  server.once('listening', resolvePromise);
  server.once('error', reject);
});
const address = server.address();
if (!address || typeof address === 'string') throw new Error('Could not bind smoke-test server.');
const baseUrl = `http://127.0.0.1:${address.port}`;
const origin = 'http://127.0.0.1';
const email = `tidb-smoke-${randomUUID()}@example.test`;
const password = 'Launchboard-TiDB-Smoke-Test-2026!';
let userId;
let testPool;

function cookiesFrom(response) {
  return typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie') ?? ''];
}
function cookiePair(response, name) {
  const header = cookiesFrom(response).find((value) => value.startsWith(`${name}=`));
  if (!header) throw new Error(`Expected cookie ${name} was not set. Returned cookie names: ${cookiesFrom(response).map((v) => v.split('=', 1)[0]).join(', ')}`);
  return header.split(';', 1)[0];
}
async function expectStatus(response, expected, label) {
  if (response.status !== expected) {
    const body = await response.text();
    throw new Error(`${label} returned HTTP ${response.status}; expected ${expected}: ${body.slice(0, 300)}`);
  }
}

try {
  const health = await fetch(`${baseUrl}/api/health`);
  await expectStatus(health, 200, 'Health');
  const ready = await fetch(`${baseUrl}/api/ready`);
  await expectStatus(ready, 200, 'Ready');
  console.log('Liveness and DB readiness: passed');

  const pre = await fetch(`${baseUrl}/api/auth/pre-session`, {
    method: 'POST', headers: { 'content-type': 'application/json', origin }, body: '{}',
  });
  await expectStatus(pre, 200, 'Pre-session');
  const preBody = await pre.json();
  const preCookie = cookiePair(pre, cookies.PRE_SESSION_COOKIE_NAME);

  const reg = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin, cookie: preCookie, 'x-csrf-token': preBody.csrfToken },
    body: JSON.stringify({ email, password }),
  });
  await expectStatus(reg, 201, 'Registration');
  const regBody = await reg.json();
  userId = regBody.user?.id;
  console.log('Registration and Argon2 password hashing: passed');

  const authPair = cookiePair(reg, cookies.SESSION_COOKIE_NAME);
  const parsed = cookies.parseCookies(authPair);
  const token = parsed[cookies.SESSION_COOKIE_NAME];
  if (!tokens.isValidToken(token)) throw new Error('Auth cookie did not contain a valid session token.');

  const config = parseDatabaseEnv(process.env);
  if (!config) throw new Error('Runtime config missing.');
  testPool = createDatabasePool(config);
  const [rows] = await testPool.execute(
    'SELECT s.id, s.last_seen_at, s.expires_at, s.revoked_at FROM sessions s WHERE s.token_hash=?',
    [tokens.hashToken(token)],
  );
  console.log('Cookie token matches persisted session:', rows.length === 1);
  const direct = await sessions.findActiveAuthSession(testPool, token);
  console.log('Database session repository recognizes token:', Boolean(direct));

  const me = await fetch(`${baseUrl}/api/auth/me`, { headers: { cookie: authPair } });
  await expectStatus(me, 200, 'Session restoration');
  const meBody = await me.json();
  if (meBody.user?.email !== email) throw new Error('Session endpoint returned an unexpected account.');
  console.log('Authenticated session restoration: passed');

  const logout = await fetch(`${baseUrl}/api/auth/logout`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin, cookie: authPair, 'x-csrf-token': regBody.csrfToken },
    body: '{}',
  });
  await expectStatus(logout, 204, 'Logout');
  console.log('CSRF-protected logout: passed');
} finally {
  try {
    if (!testPool) {
      const config = parseDatabaseEnv(process.env);
      if (config) testPool = createDatabasePool(config);
    }
    if (testPool && userId) {
      await testPool.execute('DELETE FROM users WHERE id = ?', [userId]);
      console.log('Disposable smoke-test account removed.');
    }
  } finally {
    if (testPool) await testPool.end().catch(() => {});
    await new Promise((resolvePromise) => server.close(resolvePromise));
  }
}
