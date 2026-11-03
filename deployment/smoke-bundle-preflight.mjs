import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

const directory = dirname(fileURLToPath(import.meta.url));
process.loadEnvFile(resolve(directory, '..', 'server', '.env.tidb.local'));
process.env.NODE_ENV = 'production';
process.env.CSRF_SECRET = randomBytes(32).toString('base64url');
process.env.TRUSTED_ORIGINS = 'http://127.0.0.1';

// Do not send real mail during this bundle preflight.
delete process.env.SMTP_USER;
delete process.env.SMTP_PASS;
delete process.env.APP_BASE_URL;

const { default: handler } = await import('./api/[...].js');
const server = createServer(handler);
server.listen(0, '127.0.0.1');
await new Promise((resolvePromise, reject) => {
  server.once('listening', resolvePromise);
  server.once('error', reject);
});

try {
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Local API did not bind.');

  const origin = 'http://127.0.0.1';
  const baseUrl = `http://127.0.0.1:${address.port}/api`;
  const health = await fetch(`${baseUrl}/health`);
  if (health.status !== 200) throw new Error(`Health returned HTTP ${health.status}.`);

  const ready = await fetch(`${baseUrl}/ready`);
  if (ready.status !== 200) throw new Error(`TiDB readiness returned HTTP ${ready.status}.`);

  const preSession = await fetch(`${baseUrl}/auth/pre-session`, {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json' },
    body: '{}',
  });
  if (preSession.status !== 200) {
    throw new Error(`Pre-session returned HTTP ${preSession.status}.`);
  }
  const body = await preSession.json();
  if (!body.csrfToken || body.context !== 'pre-auth') {
    throw new Error('Pre-session response did not contain the expected pre-auth CSRF state.');
  }
  const setCookies = preSession.headers.getSetCookie();
  if (!setCookies.some((value) => value.startsWith('__Host-launchboard_pre_session='))) {
    throw new Error('Expected production pre-auth cookie was not set.');
  }

  console.log('Preflight passed: bundled Vercel handler, health, TiDB readiness and pre-auth CSRF bootstrap.');
  console.log('SMTP settings intentionally absent; no email was sent and no user/account data was changed.');
} finally {
  await new Promise((resolvePromise) => server.close(resolvePromise));
}
