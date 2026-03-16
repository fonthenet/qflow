import { defineConfig, devices } from '@playwright/test';
import { loadLocalEnv } from './scripts/e2e-env';

loadLocalEnv();

const baseURL = process.env.QUEUEFLOW_E2E_BASE_URL ?? 'http://127.0.0.1:3100';
const useManagedServer = !process.env.QUEUEFLOW_E2E_BASE_URL;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: Number(process.env.QUEUEFLOW_E2E_WORKERS ?? '1'),
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
      },
    },
  ],
  webServer: useManagedServer
    ? {
        command: 'pnpm dev:e2e',
        cwd: __dirname,
        url: baseURL,
        reuseExistingServer: true,
        timeout: 120_000,
      }
    : undefined,
});
