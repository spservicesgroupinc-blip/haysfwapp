// Bundles electron/main.cjs + electron/preload.cjs into dist-electron/.
// electron-updater (and its dependencies) are inlined, so the packaged app
// ships without node_modules; `electron` itself stays external.
import { build } from 'esbuild';
import { rmSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const outdir = path.join(root, 'dist-electron');

rmSync(outdir, { recursive: true, force: true });

await build({
  entryPoints: [
    path.join(root, 'electron', 'main.cjs'),
    path.join(root, 'electron', 'preload.cjs'),
  ],
  outdir,
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  // package.json is "type": "module", so the main/preload must keep .cjs.
  outExtension: { '.js': '.cjs' },
  external: ['electron'],
  logLevel: 'info',
});

console.log('Bundled electron main/preload -> dist-electron/');
