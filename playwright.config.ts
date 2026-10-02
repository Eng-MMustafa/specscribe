import { defineConfig, devices } from '@playwright/test';

/**
 * Browser tests for the docs UI, run against a real Express fixture app
 * (test/ui/fixture) and the standalone docs server built from `dist/`.
 *
 *   npm run build && npm run test:ui
 *
 * SPECSCRIBE_CHROMIUM may point at a local Chromium when Playwright's own
 * browser download is not available.
 */
const API_PORT = 4510;
const DOCS_PORT = 4511;

export default defineConfig({
  testDir: 'test/ui',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 7_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: `http://localhost:${DOCS_PORT}`,
    trace: 'retain-on-failure',
    launchOptions: process.env.SPECSCRIBE_CHROMIUM ? { executablePath: process.env.SPECSCRIBE_CHROMIUM } : {},
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
  webServer: {
    command: 'node test/ui/fixture/server.js',
    url: `http://localhost:${DOCS_PORT}/docs`,
    env: { UI_FIXTURE_API_PORT: String(API_PORT), UI_FIXTURE_DOCS_PORT: String(DOCS_PORT) },
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
