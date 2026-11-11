import { defineConfig } from "@playwright/test";
const port = Number(process.env.PLAYWRIGHT_PORT || 3010);
export default defineConfig({
  testDir: "tests",
  testMatch: "*.spec.ts",
  workers: 1,
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    serviceWorkers: "block",
    headless: true,
    trace: "retain-on-failure",
  },
  webServer: {
    command: `${process.env.PLAYWRIGHT_PREVIEW ? "npm run preview" : "npm run dev"} -- --port ${port}`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: true,
    timeout: 30000,
  },
});
