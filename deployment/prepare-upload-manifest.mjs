import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';

const staticFiles = [
  { file: 'package.json', path: 'deployment/package.json' },
  { file: 'vercel.json', path: 'deployment/vercel.json' },
  { file: 'index.html', path: 'deployment/index.html' },
];

const assetNames = (await readdir('deployment/assets', { withFileTypes: true }))
  .filter((entry) => entry.isFile())
  .map((entry) => entry.name)
  .sort();

const files = [
  ...staticFiles,
  ...assetNames.map((name) => ({
    file: `assets/${name}`,
    path: `deployment/assets/${name}`,
  })),
  { file: 'api/[...].js', path: 'deployment/api/[...].js' },
];

const entries = [];
for (const item of files) {
  const data = await readFile(item.path);
  entries.push({
    file: item.file,
    size: data.length,
    sha1: createHash('sha1').update(data).digest('hex'),
    base64: data.toString('base64'),
  });
}

await writeFile('deployment/upload-manifest.json', JSON.stringify(entries));
console.log(JSON.stringify(entries.map(({ file, size, sha1 }) => ({ file, size, sha1 })), null, 2));
