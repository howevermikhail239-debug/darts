import { defineConfig, devices } from '@playwright/test';

const externalBaseURL = process.env.PLAYWRIGHT_BASE_URL;

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: false,
  reporter: 'list',
  use: {
    baseURL: externalBaseURL || 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // Allows running against a browser that is already present on the machine
    // (CI images, sandboxes) instead of Playwright's downloaded revision.
    ...(process.env.PLAYWRIGHT_CHROMIUM_PATH
      ? { launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } }
      : {}),
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: externalBaseURL
    ? undefined
    : {
        command: 'npm run build && npm run preview',
        url: 'http://127.0.0.1:4173',
        reuseExistingServer: false,
        timeout: 60_000,
        env: {
          ...process.env,
          // The production limiter is intentionally strict. A serial E2E run creates
          // more than five isolated companies from localhost, so keep the security
          // behavior covered by server tests and prevent cross-test bucket leakage here.
          DARTS_RATE_LIMIT_GROUPS: '1000',
          DARTS_RATE_LIMIT_MUTATIONS: '10000',
        },
      },
});
