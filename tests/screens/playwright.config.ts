import { defineConfig, devices } from '@playwright/test';

// The site's screenshots of the example workspace (docs/17): `pnpm screenshots`, never in CI. Needs the local stack,
// `pnpm seed:demo` and the app running at PORT (a production build gives the crispest, steadiest pages).
const port = Number(process.env.PORT ?? 3000);

export default defineConfig({
  testDir: '.',
  testMatch: /screenshots\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  timeout: 600_000,
  expect: { timeout: 30_000 },
  use: { baseURL: `http://localhost:${port}`, trace: 'off' },
  projects: [
    {
      name: 'desktop',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 2,
      },
    },
    {
      name: 'phone',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 2,
      },
    },
  ],
});
