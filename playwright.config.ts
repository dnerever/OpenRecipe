import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end flows against the production build, served the way the container
 * serves it: one Node process, the API and the built SPA on the same origin.
 * Run `npm run build` and `npm run db:migrate` first; CI does both.
 *
 * Locally, `PLAYWRIGHT_CHANNEL=chrome` uses an installed Chrome instead of
 * Playwright's own download.
 */
const PORT = 8788;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI'] ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
    ...(process.env['PLAYWRIGHT_CHANNEL'] ? { channel: process.env['PLAYWRIGHT_CHANNEL'] } : {}),
  },
  webServer: {
    // `--env-file-if-exists` never overrides a variable already set, so the
    // values below win over `.env`, and CI's own DATABASE_URL wins over both.
    command: 'node --env-file-if-exists=.env apps/api/dist/index.js',
    url: `${BASE_URL}/health`,
    reuseExistingServer: !process.env['CI'],
    env: {
      PORT: String(PORT),
      APP_URL: BASE_URL,
      SERVE_STATIC_DIR: 'apps/web/dist',
      NODE_ENV: 'test',
    },
  },
});
