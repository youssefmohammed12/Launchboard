import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

const manifestPath = resolve('deployment/upload-manifest.json');
const stageRoot = resolve('deployment/release-stage');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));

function fail(message) {
  console.error(`[release-preflight] FAIL: ${message}`);
  process.exitCode = 1;
}

function sha1(buffer) {
  return createHash('sha1').update(buffer).digest('hex');
}

if (!Array.isArray(manifest) || manifest.length === 0) {
  fail('Upload manifest is empty or invalid.');
  process.exit();
}

const expected = new Set();
for (const entry of manifest) {
  if (
    typeof entry?.file !== 'string' ||
    typeof entry?.base64 !== 'string' ||
    !Number.isInteger(entry?.size) ||
    typeof entry?.sha1 !== 'string'
  ) {
    fail('Manifest contains an invalid entry.');
    continue;
  }

  const relative = entry.file.replaceAll('/', sep);
  const stagedPath = resolve(stageRoot, relative);
  if (!stagedPath.startsWith(stageRoot + sep)) {
    fail(`Unsafe staged path in manifest: ${entry.file}`);
    continue;
  }

  expected.add(entry.file);
  const payload = Buffer.from(entry.base64, 'base64');
  if (payload.length !== entry.size || sha1(payload) !== entry.sha1) {
    fail(`Manifest payload checksum mismatch: ${entry.file}`);
    continue;
  }

  try {
    const staged = await readFile(stagedPath);
    if (staged.length !== entry.size || sha1(staged) !== entry.sha1) {
      fail(`Staged file does not match manifest: ${entry.file}`);
    }
  } catch {
    fail(`Staged file is missing: ${entry.file}`);
  }
}

const required = [
  'package.json',
  'vercel.json',
  'index.html',
  'favicon.svg',
  'api/[...].js',
];
for (const file of required) {
  if (!expected.has(file)) fail(`Required release file is missing from manifest: ${file}`);
}

try {
  const indexHtml = await readFile(resolve(stageRoot, 'index.html'), 'utf8');
  const assetReferences = [...indexHtml.matchAll(/(?:src|href)=["']([^"']*assets\/[^"']+)["']/g)]
    .map((match) => match[1].replace(/^\//, ''));
  for (const reference of assetReferences) {
    if (!expected.has(reference)) fail(`HTML references an asset absent from the manifest: ${reference}`);
  }
  if (assetReferences.length === 0) fail('No built JS/CSS assets are referenced by index.html.');

  const config = JSON.parse(await readFile(resolve(stageRoot, 'vercel.json'), 'utf8'));
  const rewrites = config.rewrites ?? [];
  const apiIndex = rewrites.findIndex((item) =>
    item.source === '/api/:path*' && item.destination === '/api/[...]',
  );
  const spaIndex = rewrites.findIndex((item) =>
    item.source === '/((?!api/).*)' && item.destination === '/index.html',
  );
  if (apiIndex < 0 || spaIndex < 0 || apiIndex >= spaIndex) {
    fail('Vercel API rewrite is missing or must appear before the SPA fallback.');
  }

  const runtime = JSON.parse(await readFile(resolve(stageRoot, 'package.json'), 'utf8'));
  if (runtime.engines?.node !== '24.x' || !runtime.dependencies?.['@node-rs/argon2']) {
    fail('Vercel runtime package does not declare Node 24 and the Argon2 runtime dependency.');
  }
} catch (error) {
  fail(error instanceof Error ? error.message : 'Release structure could not be inspected.');
}

const stagedFiles = [];
async function collect(relativeDirectory = '') {
  const absoluteDirectory = relativeDirectory
    ? resolve(stageRoot, relativeDirectory)
    : stageRoot;
  for (const entry of await readdir(absoluteDirectory, { withFileTypes: true })) {
    const relative = relativeDirectory
      ? `${relativeDirectory}/${entry.name}`
      : entry.name;
    if (entry.isDirectory()) await collect(relative);
    else stagedFiles.push(relative);
  }
}
await collect();

for (const file of stagedFiles) {
  if (!expected.has(file)) fail(`Unexpected stale file in staged package: ${file}`);
}
for (const file of expected) {
  if (!stagedFiles.includes(file)) fail(`Manifest entry is absent from staged package: ${file}`);
}

if (process.exitCode) {
  process.exit(1);
}

console.log(`[release-preflight] PASS: ${manifest.length} files; manifest payloads, staged checksums, assets, runtime package and API-before-SPA rewrite verified.`);
console.log('[release-preflight] No network calls or database operations were performed.');
