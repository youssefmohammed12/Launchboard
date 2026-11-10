import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEPLOYMENT = resolve(ROOT, 'deployment');
const STAGE = resolve(DEPLOYMENT, 'release-stage');
const MANIFEST_PATH = resolve(DEPLOYMENT, 'upload-manifest.json');

const PROJECT_NAME = 'launchboard';
const DEFAULT_TEAM_ID = 'team_Ye1EjT7zC32Z2dfuWhtFM6Bm';
const DEFAULT_PROJECT_ID = 'prj_pocGrJDbZKhVa1aDxqYzZRCttDsr';
const PRODUCTION_ORIGINS = [
  'https://launchboard-drab.vercel.app',
  'https://launchboard-youssef-workplace.vercel.app',
];

const args = process.argv.slice(2);
const mode = args.length === 0 ? '--prepare' : args[0];

if (args.includes('--help') || args.includes('-h')) {
  printHelp();
  process.exit(0);
}
if (args.length > 1 || !['--prepare', '--production'].includes(mode)) {
  printHelp();
  throw new Error('Choose either --prepare or --production.');
}

function printHelp() {
  console.log([
    'Launchboard reusable prebuilt release',
    '',
    '  npm run release:prepare     Build, stage, hash and verify the package only.',
    '  npm run release:production Prepare, upload, create one Production deployment,',
    '                              wait for READY and run read-only live smoke checks.',
    '',
    'Production mode requires VERCEL_TOKEN in the process environment and an',
    'interactive confirmation. It does not create a Preview deployment.',
  ].join('\n'));
}

function run(command, commandArgs, env = process.env) {
  const result = spawnSync(command, commandArgs, {
    cwd: ROOT,
    env,
    stdio: 'inherit',
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(command + ' ' + commandArgs.join(' ') + ' failed with exit code ' + result.status + '.');
  }
}

function environmentWithoutVercelToken() {
  const env = { ...process.env };
  delete env.VERCEL_TOKEN;
  return env;
}

function git(args) {
  try {
    return execFileSync('git', args, {
      cwd: ROOT,
      env: environmentWithoutVercelToken(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

function sha1(buffer) {
  return createHash('sha1').update(buffer).digest('hex');
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function preparePackage(buildEnv) {
  console.log('\n[release] Building the API-mode frontend...');
  const npmCli = process.env.npm_execpath;
  if (!npmCli) {
    throw new Error('Run this workflow through npm run release:prepare or npm run release:production.');
  }
  run(process.execPath, [npmCli, 'run', 'build'], { ...buildEnv, VITE_DATA_MODE: 'api' });

  console.log('\n[release] Bundling the Node 24 Vercel API function...');
  run(process.execPath, ['deployment/build-api.mjs'], buildEnv);

  const distAssets = resolve(ROOT, 'dist', 'assets');
  const distIndex = resolve(ROOT, 'dist', 'index.html');
  const apiBundle = resolve(DEPLOYMENT, 'api', '[...].js');
  const runtimePackage = resolve(DEPLOYMENT, 'package.json');
  const vercelConfig = resolve(DEPLOYMENT, 'vercel.json');
  const favicon = resolve(ROOT, 'public', 'favicon.svg');

  for (const required of [distIndex, apiBundle, runtimePackage, vercelConfig, favicon]) {
    if (!(await exists(required))) {
      throw new Error('Required release input is missing: ' + required);
    }
  }
  const assetEntries = (await readdir(distAssets, { withFileTypes: true }))
    .filter((entry) => entry.isFile());
  if (assetEntries.length === 0) {
    throw new Error('The frontend build did not produce any files in dist/assets.');
  }

  await rm(STAGE, { recursive: true, force: true });
  await mkdir(resolve(STAGE, 'assets'), { recursive: true });
  await mkdir(resolve(STAGE, 'api'), { recursive: true });

  await Promise.all([
    cp(runtimePackage, resolve(STAGE, 'package.json')),
    cp(vercelConfig, resolve(STAGE, 'vercel.json')),
    cp(distIndex, resolve(STAGE, 'index.html')),
    cp(favicon, resolve(STAGE, 'favicon.svg')),
    cp(distAssets, resolve(STAGE, 'assets'), { recursive: true }),
    cp(apiBundle, resolve(STAGE, 'api', '[...].js')),
  ]);

  console.log('\n[release] Creating the SHA-1 upload manifest...');
  run(process.execPath, ['deployment/prepare-upload-manifest.mjs'], buildEnv);
  console.log('\n[release] Verifying every staged file and route configuration...');
  run(process.execPath, ['deployment/verify-upload-manifest.mjs'], buildEnv);

  const manifest = JSON.parse(await readFile(MANIFEST_PATH, 'utf8'));
  if (!Array.isArray(manifest) || manifest.length < 6) {
    throw new Error('The generated upload manifest is invalid or incomplete.');
  }

  console.log('\n[release] Package ready: ' + manifest.length + ' files.');
  console.log('[release] No Vercel network requests, database connections, migrations, email sends, or Git writes occurred.');
  return manifest;
}

function getReleaseMetadata() {
  const status = git(['status', '--porcelain', '--untracked-files=all']);
  return {
    branch: git(['branch', '--show-current']) || '(detached HEAD)',
    commitSha: git(['rev-parse', 'HEAD']),
    commitMessage: git(['log', '-1', '--format=%s']),
    remoteUrl: git(['remote', 'get-url', 'origin']),
    dirty: Boolean(status),
    dirtyPaths: status
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => line.slice(3)),
  };
}

async function confirmProduction(metadata, fileCount, token) {
  if (!token) {
    throw new Error('VERCEL_TOKEN is missing. Set it in the local process environment; do not put it in a repository file.');
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('Production mode requires an interactive terminal for the release confirmation.');
  }

  console.log('\n[release] Production target review');
  console.log('Project: ' + PROJECT_NAME);
  console.log('Project ID: ' + (process.env.VERCEL_PROJECT_ID || DEFAULT_PROJECT_ID));
  console.log('Branch: ' + metadata.branch);
  console.log('HEAD: ' + (metadata.commitSha || '(unavailable)'));
  console.log('Working tree: ' + (metadata.dirty ? 'DIRTY — prebuilt files may include uncommitted changes' : 'clean'));
  console.log('Files to upload: ' + fileCount);
  console.log('Target: PRODUCTION (one new deployment; no Preview deployment)');
  if (metadata.dirty) {
    console.log('Changed paths:');
    for (const path of metadata.dirtyPaths) console.log('  - ' + path);
  }

  const readline = createInterface({ input: process.stdin, output: process.stdout });
  let answer;
  try {
    answer = await readline.question('\nType exactly "DEPLOY LAUNCHBOARD TO PRODUCTION" to continue: ');
  } finally {
    readline.close();
  }
  if (answer !== 'DEPLOY LAUNCHBOARD TO PRODUCTION') {
    throw new Error('Production deployment cancelled; no files were uploaded.');
  }
}

function vercelUrl(path, teamId) {
  const url = new URL('https://api.vercel.com' + path);
  url.searchParams.set('teamId', teamId);
  return url;
}

async function vercelRequest(path, options, teamId, token) {
  const response = await fetch(vercelUrl(path, teamId), {
    ...options,
    headers: {
      Authorization: 'Bearer ' + token,
      ...(options.headers || {}),
    },
  });
  const raw = await response.text();
  let data = {};
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    data = { message: raw.slice(0, 240) };
  }
  if (!response.ok) {
    const detail = typeof data.error?.message === 'string'
      ? data.error.message
      : typeof data.message === 'string'
        ? data.message
        : 'No error detail returned';
    throw new Error('Vercel API request failed (HTTP ' + response.status + '): ' + detail.slice(0, 300));
  }
  return data;
}

async function withRetry(label, operation) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt === 3) break;
      const waitMs = 700 * attempt;
      console.warn('[release] ' + label + ' failed on attempt ' + attempt + '; retrying in ' + waitMs + 'ms.');
      await new Promise((resolvePromise) => setTimeout(resolvePromise, waitMs));
    }
  }
  throw lastError;
}

async function uploadFiles(manifest, teamId, token) {
  console.log('\n[release] Uploading ' + manifest.length + ' files (maximum 4 uploads at a time)...');
  for (let index = 0; index < manifest.length; index += 4) {
    const batch = manifest.slice(index, index + 4);
    await Promise.all(batch.map(async (entry) => {
      const buffer = Buffer.from(entry.base64, 'base64');
      if (buffer.length !== entry.size || sha1(buffer) !== entry.sha1) {
        throw new Error('Manifest checksum changed before upload: ' + entry.file);
      }
      await withRetry('Upload ' + entry.file, () => vercelRequest('/v2/files', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'x-vercel-digest': entry.sha1,
          'x-now-size': String(entry.size),
        },
        body: buffer,
      }, teamId, token));
      console.log('[release] Uploaded ' + entry.file + ' (' + entry.size + ' bytes).');
    }));
  }
}

async function createProductionDeployment(manifest, metadata, teamId, projectId, token) {
  const body = {
    name: PROJECT_NAME,
    project: projectId,
    target: 'production',
    files: manifest.map((entry) => ({
      file: entry.file,
      sha: entry.sha1,
      size: entry.size,
    })),
    gitMetadata: {
      remoteUrl: metadata.remoteUrl || undefined,
      commitRef: metadata.branch.startsWith('(') ? undefined : metadata.branch,
      commitSha: metadata.commitSha || undefined,
      commitMessage: (metadata.commitMessage || 'Prebuilt Launchboard release') + ' [prebuilt release]',
      dirty: metadata.dirty,
      rootDirectory: '',
    },
  };
  const result = await vercelRequest('/v13/deployments?skipAutoDetectionConfirmation=1', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, teamId, token);
  const deployment = result.deployment || result;
  if (!deployment.id) {
    throw new Error('Vercel did not return a deployment ID. No second deployment will be created automatically.');
  }
  return deployment;
}

async function waitForReady(deployment, teamId, token) {
  const startedAt = Date.now();
  const timeoutMs = 4 * 60 * 1000;
  console.log('\n[release] Waiting for Vercel Production deployment ' + deployment.id + '...');
  while (Date.now() - startedAt < timeoutMs) {
    const result = await vercelRequest(
      '/v13/deployments/' + encodeURIComponent(deployment.id),
      { method: 'GET' },
      teamId,
      token,
    );
    const current = result.deployment || result;
    const state = current.readyState || current.state;
    if (state === 'READY') {
      return {
        ...current,
        elapsedMs: Date.now() - startedAt,
        url: current.url || deployment.url,
      };
    }
    if (['ERROR', 'CANCELED', 'CANCELLED'].includes(state)) {
      const reason = current.errorMessage || current.error?.message || 'Vercel reported ' + state + '.';
      throw new Error('Production deployment did not become ready: ' + reason);
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 2500));
  }
  throw new Error('Timed out waiting for Vercel to finish. Inspect the existing deployment before retrying; this script will not create another one.');
}

async function fetchChecked(url, expectedStatus, label) {
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(25000),
  });
  if (response.status !== expectedStatus) {
    const detail = (await response.text()).slice(0, 160).replace(/[\r\n]+/g, ' ');
    throw new Error(label + ': expected HTTP ' + expectedStatus + ', received ' + response.status + ' (' + detail + ').');
  }
  return response;
}

async function verifyOrigin(origin) {
  const base = new URL(origin);
  const home = await fetchChecked(new URL('/', base), 200, origin + ' homepage');
  const html = await home.text();

  const assetPaths = [...html.matchAll(/(?:src|href)=["']([^"']*assets\/[^"']+)["']/g)]
    .map((match) => match[1]);
  const jsPath = assetPaths.find((path) => /\.js(?:$|\?)/.test(path));
  const cssPath = assetPaths.find((path) => /\.css(?:$|\?)/.test(path));
  if (!jsPath || !cssPath) {
    throw new Error(origin + ': the homepage did not reference both a JavaScript and CSS asset.');
  }
  for (const assetPath of assetPaths) {
    const assetUrl = new URL(assetPath, base);
    if (assetUrl.origin !== base.origin) {
      throw new Error(origin + ': unexpected cross-origin asset reference.');
    }
    await fetchChecked(assetUrl, 200, origin + ' asset ' + assetPath);
  }

  await fetchChecked(new URL('/login', base), 200, origin + ' login route');
  await fetchChecked(new URL('/favicon.svg', base), 200, origin + ' favicon');

  const healthResponse = await fetchChecked(new URL('/api/health', base), 200, origin + ' API health');
  const health = await healthResponse.json();
  if (health.status !== 'ok') throw new Error(origin + ': API health returned an unexpected JSON body.');

  const readyResponse = await fetchChecked(new URL('/api/ready', base), 200, origin + ' API readiness');
  const ready = await readyResponse.json();
  if (ready.status !== 'ok' || ready.db !== 'ok') {
    throw new Error(origin + ': database readiness did not report status=ok and db=ok.');
  }

  for (const route of ['/api/auth/me', '/api/opportunities']) {
    const response = await fetchChecked(new URL(route, base), 401, origin + ' unauthenticated ' + route);
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      throw new Error(origin + ': ' + route + ' did not return a JSON authentication response.');
    }
  }

  console.log('[release] Read-only smoke passed: ' + origin + ' (SPA, assets, login route, favicon, health, readiness, auth guards).');
}

async function verifyProduction(deployment) {
  const deploymentOrigin = 'https://' + deployment.url.replace(/^https?:\/\//, '').replace(/\/+$/, '');
  await verifyOrigin(deploymentOrigin);

  // The deployment URL is verified first; then confirm both canonical Production aliases.
  for (const origin of PRODUCTION_ORIGINS) {
    let lastError;
    for (let attempt = 1; attempt <= 6; attempt += 1) {
      try {
        await verifyOrigin(origin);
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
        if (attempt < 6) await new Promise((resolvePromise) => setTimeout(resolvePromise, 2000));
      }
    }
    if (lastError) throw lastError;
  }
}

async function deployProduction(manifest, token) {
  const teamId = process.env.VERCEL_TEAM_ID || DEFAULT_TEAM_ID;
  const projectId = process.env.VERCEL_PROJECT_ID || DEFAULT_PROJECT_ID;
  const metadata = getReleaseMetadata();

  await confirmProduction(metadata, manifest.length, token);
  await uploadFiles(manifest, teamId, token);

  console.log('\n[release] Creating exactly one Production deployment...');
  const created = await createProductionDeployment(manifest, metadata, teamId, projectId, token);
  const ready = await waitForReady(created, teamId, token);
  if (!ready.url) throw new Error('Vercel reported READY but did not return a deployment URL.');

  console.log('\n[release] Verifying the deployed URL and canonical aliases...');
  await verifyProduction(ready);

  console.log('\n[release] PRODUCTION RELEASE VERIFIED');
  console.log('Deployment ID: ' + ready.id);
  console.log('Deployment URL: https://' + ready.url.replace(/^https?:\/\//, ''));
  console.log('Target: Production');
  console.log('Files uploaded: ' + manifest.length);
  console.log('Build/deployment wait: ' + (ready.elapsedMs / 1000).toFixed(1) + 's');
  console.log('Aliases verified: ' + PRODUCTION_ORIGINS.join(', '));
  console.log('Database migrations: none');
  console.log('Account creation, email sending and CRUD: not performed');
}

async function main() {
  const version = process.versions.node.split('.').map(Number);
  if (version[0] < 20 || (version[0] === 20 && version[1] < 12)) {
    throw new Error('Node.js 20.12 or newer is required.');
  }
  if (mode === '--production' && !process.env.VERCEL_TOKEN) {
    throw new Error('VERCEL_TOKEN is missing. Production mode cannot continue.');
  }

  const token = process.env.VERCEL_TOKEN;
  const buildEnv = environmentWithoutVercelToken();
  const manifest = await preparePackage(buildEnv);
  if (mode === '--prepare') return;
  await deployProduction(manifest, token);
}

main().catch((error) => {
  console.error('\n[release] FAILED: ' + (error instanceof Error ? error.message : String(error)));
  process.exitCode = 1;
});
