import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.PORT ?? 3000);
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  use: { baseURL, trace: 'off' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] }, testIgnore: /perf\.spec\.ts/ },
    {
      name: 'phone',
      use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 } },
      testIgnore: /perf\.spec\.ts/,
    },
    // frame timings mean something only on a quiet machine: the scroll budget runs after everything else, alone
    {
      name: 'perf',
      use: { ...devices['Desktop Chrome'] },
      testMatch: /perf\.spec\.ts/,
      dependencies: ['chromium', 'phone'],
    },
  ],
  webServer: {
    command: process.env.CI ? `pnpm start --port ${port}` : `pnpm dev --port ${port}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
