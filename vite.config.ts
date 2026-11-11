import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';
import {VitePWA} from 'vite-plugin-pwa';

export default defineConfig(() => {
  return {
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        strategies: 'injectManifest',
        srcDir: 'src',
        filename: 'sw.ts',
        registerType: 'prompt',
        injectRegister: false,
        manifest: {
          name: 'Hays + Sons — Restoration Document Suite',
          short_name: 'Hays + Sons',
          description:
            'Single-entry document automation engine to capture job data and generate PDF contracts, reports, and production packets.',
          start_url: '/',
          scope: '/',
          display: 'standalone',
          theme_color: '#DC2626',
          background_color: '#F8FAFC',
          icons: [
            {src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png'},
            {src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png'},
            {
              src: '/maskable-icon-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        injectManifest: {
          // Shell + pdf.js worker + icons; authed API calls are never precached.
          globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}'],
          maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        },
        devOptions: {enabled: false},
      }),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
