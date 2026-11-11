import { defineConfig } from '@vite-pwa/assets-generator/config';

/**
 * Icon generation for Hays + Sons.
 *
 * Source: public/logo.svg (the red bar + black plus mark, on a square field).
 * Run with `npm run icons`.
 *
 * - transparent: favicon + standard PWA icons (192/512) + 256/64 for the Windows .ico.
 *   These carry a white field: the mark's plus is near-black, so on a transparent icon it
 *   disappears against a dark wallpaper, tab bar or taskbar, leaving only the red bar.
 * - maskable: white field (safe zone) for Android/Windows maskable slots.
 * - apple: opaque white background for iOS home-screen icons
 *
 * The white field is baked into public/logo-icon.svg rather than applied as a resize
 * option, because the generator ignores resizeOptions.background for the transparent
 * preset. The in-app mark (components/BrandLogo.tsx) and public/logo.svg stay
 * transparent — they sit on surfaces the app controls.
 */
export default defineConfig({
  preset: {
    transparent: {
      sizes: [64, 192, 256, 512],
      favicons: [[48, 'favicon.ico']],
      padding: 0,
    },
    maskable: {
      sizes: [512],
      padding: 0.3,
      resizeOptions: { background: '#FFFFFF' },
    },
    apple: {
      sizes: [180],
      padding: 0.3,
      resizeOptions: { background: '#FFFFFF' },
    },
  },
  images: ['public/logo-icon.svg'],
});
