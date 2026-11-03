import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDatabaseEnv } from '../server/dist/config/env.js';
import { createDatabasePool } from '../server/dist/db/pool.js';
import { hashToken, isValidToken } from '../server/dist/auth/tokens.js';
import { findActiveAuthSession } from '../server/dist/auth/sessionRepo.js';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
process.loadEnvFile(resolve(scriptDirectory, '..', 'server', '.env.tidb.local'));
process.env.NODE_ENV = 'production';
process.env.CSRF_SECRET = Buffer.from(randomUUID() + randomUUID()).toString('base64url');
process.env.TRUSTED_ORIGINS = 'http://127.0.0.1';

const [{ default: handler }, cookies] = await Promise.all([
  import('../deployment/api/[...].js'),
  import('../server/dist/auth/cookies.js'),
]);
const server = createServer(handler);
server.listen(0, '127.0.0.1');
await new Promise((resolvePromise, reject) => {
  server.once('listening', resolvePromise);
  server.once('error', reject);
});
const address = server.address();
if (!address || typeof address === 'string') throw new Error('Could not start bundled API test.');
const baseUrl = `http://127.0.0.1:${address.port}`;
const origin = 'http://127.0.0.1';
const email = `tidb-bundle-${randomUUID()}@example.test`;
const password = 'Launchboard-TiDB-Bundle-Test-2026!';
let userId;
let pool;

function cookiePair(response, name) {
  const values = response.headers.getSetCookie();
  const match = values.find((value) => value.startsWith(`${name}=`));
  if (!match) throw new Error(`Expected cookie ${name} missing.`);
  return match.split(';', 1)[0];
}
async function check(response, expected, label) {
  if (response.status !== expected) {
    throw new Error(`${label}: HTTP ${response.status}, expected ${expected}: ${(await response.text()).slice(0, 200)}`);
  }
}
try {
  await check(await fetch(`${baseUrl}/api/health`), 200, 'Health');
  await check(await fetch(`${baseUrl}/api/ready`), 200, 'DB readiness');

  const pre = await fetch(`${baseUrl}/api/auth/pre-session`, {
    method: 'POST', headers: { 'content-type': 'application/json', origin }, body: '{}',
  });
  await check(pre, 200, 'Pre-session');
  const preData = await pre.json();
  const preCookie = cookiePair(pre, cookies.PRE_SESSION_COOKIE_NAME);

  const register = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin, cookie: preCookie, 'x-csrf-token': preData.csrfToken },
    body: JSON.stringify({ email, password }),
  });
  await check(register, 201, 'Registration');
  const registration = await register.json();
  userId = registration.user?.id;
  const authCookie = cookiePair(register, cookies.SESSION_COOKIE_NAME);
  const authToken = cookies.parseCookies(authCookie)[cookies.SESSION_COOKIE_NAME];
  console.log('Auth cookie present:', Boolean(authToken), 'valid token:', isValidToken(authToken));
  pool = createDatabasePool(parseDatabaseEnv(process.env));
  const [sessionRows] = await pool.execute(
    'SELECT id, token_hash, last_seen_at, expires_at, revoked_at FROM sessions WHERE token_hash = ?',
    [hashToken(authToken)],
  );
  console.log('Matching session rows:', sessionRows.length);
  console.log('Session repository lookup:', Boolean(await findActiveAuthSession(pool, authToken)));

  const me = await fetch(`${baseUrl}/api/auth/me`, { headers: { cookie: authCookie } });
  console.log('Auth cookie name:', cookies.SESSION_COOKIE_NAME, 'cookie length:', authCookie.length);
  console.log('Session endpoint status:', me.status);
  if (me.status !== 200) console.log('Session endpoint response:', (await me.text()).slice(0, 200));
  await check(me, 200, 'Session restoration');
  const meData = await me.json();
  if (meData.user?.email !== email) throw new Error('Bundled handler restored the wrong user.');

  const logout = await fetch(`${baseUrl}/api/auth/logout`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin, cookie: authCookie, 'x-csrf-token': registration.csrfToken },
    body: '{}',
  });
  await check(logout, 204, 'Logout');

  console.log('Bundled Vercel API handler smoke test passed.');
  console.log('Health, TiDB readiness, pre-session, Argon2 registration, session restoration and CSRF logout passed.');
} finally {
  const config = parseDatabaseEnv(process.env);
  if (!pool && config) pool = createDatabasePool(config);
  if (pool && userId) {
    await pool.execute('DELETE FROM users WHERE id = ?', [userId]);
    console.log('Disposable test account removed.');
  }
  if (pool) await pool.end().catch(() => {});
  await new Promise((resolvePromise) => server.close(resolvePromise));
}
