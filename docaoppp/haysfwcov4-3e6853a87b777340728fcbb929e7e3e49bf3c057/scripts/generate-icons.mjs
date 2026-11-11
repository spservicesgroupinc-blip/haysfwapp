// Generates the raster PWA icons in public/icons/ from the Hays + Sons brand
// mark (the same geometry used in src/App.tsx Brand and public/logo.svg).
//
// Run: node scripts/generate-icons.mjs
// Requires Playwright Chromium (already a devDependency for browser tests):
//   npx playwright install chromium
import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "public", "icons");

// Brand mark: red bar + heavy black plus that also reads as an "H".
// Geometry mirrors the Brand component (65 x 42); markScale is the fraction of the
// canvas width the mark should occupy (kept inside the maskable safe zone).
function markSvg({ size, bg, left, right, bar, markScale }) {
  const canvas = 512;
  const markW = canvas * markScale;
  const markH = markW * (42 / 65);
  const x = (canvas - markW) / 2;
  const y = (canvas - markH) / 2;
  const s = markW / 65;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${canvas} ${canvas}">
  <rect width="${canvas}" height="${canvas}" fill="${bg}"/>
  <g transform="translate(${x} ${y}) scale(${s})">
    <rect x="0" y="0" width="14" height="42" fill="${left}"/>
    <rect x="36" y="0" width="14" height="42" fill="${right}"/>
    <rect x="14" y="14" width="51" height="14" fill="${bar}"/>
  </g>
</svg>`;
}

const icons = [
  {
    file: "icon-192.png",
    size: 192,
    svg: markSvg({ size: 192, bg: "#ffffff", left: "#DC2626", right: "#1A1A1A", bar: "#1A1A1A", markScale: 0.62 }),
  },
  {
    file: "icon-512.png",
    size: 512,
    svg: markSvg({ size: 512, bg: "#ffffff", left: "#DC2626", right: "#1A1A1A", bar: "#1A1A1A", markScale: 0.62 }),
  },
  {
    file: "maskable-512.png",
    size: 512,
    // Full-bleed brand-red background with a white mark kept inside the maskable safe zone.
    svg: markSvg({ size: 512, bg: "#DC2626", left: "#FFFFFF", right: "#FFFFFF", bar: "#FFFFFF", markScale: 0.5 }),
  },
  {
    file: "apple-touch-icon.png",
    size: 180,
    // iOS paints transparency black, so keep the background opaque white.
    svg: markSvg({ size: 180, bg: "#ffffff", left: "#DC2626", right: "#1A1A1A", bar: "#1A1A1A", markScale: 0.62 }),
  },
];

await mkdir(outDir, { recursive: true });
const browser = await chromium.launch();
for (const icon of icons) {
  const page = await browser.newPage({
    viewport: { width: icon.size, height: icon.size },
    deviceScaleFactor: 1,
  });
  await page.setContent(
    `<style>html,body{margin:0;padding:0;overflow:hidden}</style>${icon.svg}`,
  );
  await page.screenshot({ path: join(outDir, icon.file) });
  await page.close();
  console.log("wrote", join(outDir, icon.file));
}
await browser.close();
