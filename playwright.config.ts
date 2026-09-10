import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: /^(?!.*\.unit\.spec\.ts$).*\.spec\.ts$/,
  timeout: 3_000,
  workers: 1,
  expect: {
    timeout: 1_000,
  },
  use: {
    baseURL: 'http://127.0.0.1:47317',
    headless: true,
    actionTimeout: 1_000,
    navigationTimeout: 1_000,
  },
  webServer: {
    // 4173 is Vite's default preview port, so any other Vite project on this
    // machine can squat it; combined with reuseExistingServer that silently
    // runs the suite against a foreign app. Use a port nothing defaults to.
    command: 'npm run dev -- --host 127.0.0.1 --port 47317 --strictPort',
    url: 'http://127.0.0.1:47317',
    reuseExistingServer: true,
    timeout: 120000,
  },
});
