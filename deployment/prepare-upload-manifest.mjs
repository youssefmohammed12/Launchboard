import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const stageRoot = resolve(dirname(fileURLToPath(import.meta.url)), 'release-stage');

async function collectFiles(directory, prefix = '') {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relativePath = prefix ? prefix + '/' + entry.name : entry.name;
    const absolutePath = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectFiles(absolutePath, relativePath));
    } else if (entry.isFile()) {
      files.push(relativePath);
    }
  }
  return files;
}

const filePaths = (await collectFiles(stageRoot)).sort();
if (filePaths.length === 0) {
  throw new Error('The staged release directory is empty. Run deployment/release.mjs first.');
}

const entries = [];
for (const file of filePaths) {
  const path = resolve(stageRoot, ...file.split('/'));
  const data = await readFile(path);
  entries.push({
    file,
    size: data.length,
    sha1: createHash('sha1').update(data).digest('hex'),
    base64: data.toString('base64'),
  });
}

const manifestPath = resolve(dirname(fileURLToPath(import.meta.url)), 'upload-manifest.json');
await writeFile(manifestPath, JSON.stringify(entries));
console.log(JSON.stringify(entries.map(({ file, size, sha1 }) => ({ file, size, sha1 })), null, 2));
