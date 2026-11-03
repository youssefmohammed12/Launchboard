import { build } from 'esbuild';

await build({
  entryPoints: ['api/[...path].ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  packages: 'bundle',
  external: ['@node-rs/argon2'],
  target: 'node24',
  minify: true,
  banner: {
    js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
  },
  outfile: 'deployment/api/[...].js',
});
console.log('Bundled Vercel API handler successfully.');
