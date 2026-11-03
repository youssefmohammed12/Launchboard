import { readFile, writeFile } from 'node:fs/promises';

const data = await readFile('deployment/api/[...].js');
const encoded = data.toString('base64');
const lines = encoded.match(/.{1,20000}/g) ?? [];
await writeFile('deployment/api-bundle.b64', lines.join('\n'));
console.log(JSON.stringify({bytes:data.length,base64Chars:encoded.length,lines:lines.length,lineLength:20000}));
