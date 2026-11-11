// Copies electron-builder artifacts from dist_desktop/ into release/ so the
// dedicated `release/` Vercel project can serve the desktop auto-update feed
// (latest.yml + installer + blockmap).
//
// Run via:  npm run desktop:release
// Then deploy:  npx vercel deploy ./release --prod   (first time: link the
// `hays-desktop-releases` project, and keep the URL in electron-builder.yml).
import { copyFile, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const from = path.join(root, 'dist_desktop');
const to = path.join(root, 'release');

await mkdir(to, { recursive: true });
const files = await readdir(from);
const wanted = files.filter(
  (file) => file.endsWith('.exe') || file.endsWith('.blockmap') || file === 'latest.yml'
);
if (wanted.length === 0) {
  throw new Error(`No installer artifacts found in ${from} — run "npm run desktop:build" first.`);
}
for (const file of wanted) {
  await copyFile(path.join(from, file), path.join(to, file));
}
console.log(`Copied ${wanted.join(', ')} -> release/`);
console.log(
  'Upload release/ to the update-feed host and keep publish.url in electron-builder.yml in sync.'
);
