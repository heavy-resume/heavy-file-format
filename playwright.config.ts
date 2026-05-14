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
    baseURL: 'http://127.0.0.1:4173',
    headless: true,
    actionTimeout: 1_000,
    navigationTimeout: 1_000,
  },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4173',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: true,
    timeout: 120000,
  },
});
