// Builds the Windows application icons for Electron from the generated PWA assets.
// Run via `npm run icons` (after `pwa-assets-generator` has produced public/pwa-*.png).
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import pngToIco from 'png-to-ico';

const root = path.resolve(import.meta.dirname, '..');
const publicDir = path.join(root, 'public');
const buildDir = path.join(root, 'build');

const pngs = await Promise.all(
  ['pwa-64x64.png', 'pwa-256x256.png'].map((file) =>
    readFile(path.join(publicDir, file))
  )
);

await mkdir(buildDir, { recursive: true });
await writeFile(path.join(buildDir, 'icon.ico'), await pngToIco(pngs));
await copyFile(
  path.join(publicDir, 'pwa-512x512.png'),
  path.join(buildDir, 'icon.png')
);

console.log('Generated build/icon.ico and build/icon.png');
