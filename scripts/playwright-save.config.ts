import { defineConfig } from '@playwright/test';

const port = Number(process.env.PLAYWRIGHT_UI_PORT || 3108);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('PLAYWRIGHT_UI_PORT must be a valid port number.');
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: '.',
  testMatch: ['test-save-ui.spec.ts', 'test-job-workspace-ui.spec.ts'],
  workers: 1,
  timeout: 20000,
  use: { baseURL, viewport: { width: 1440, height: 1000 } },
  webServer: {
    command: `npm run dev -- --port=${port} --strictPort`,
    cwd: '..',
    url: baseURL,
    reuseExistingServer: false,
    env: { VITE_APPS_SCRIPT_URL: 'https://script.google.com/macros/s/TEST/exec', VITE_DEV_SHARED_SECRET: '' },
  },
});
