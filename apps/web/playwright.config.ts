import { loadEnvConfig } from '@next/env';
import { defineConfig, devices } from '@playwright/test';

// Next loads .env.local for the app, but not for this process — without this the
// E2E_* credentials sit in .env.local and the authenticated specs silently skip.
loadEnvConfig(process.cwd(), true, { info: () => {}, error: console.error });

// Some sandboxes ship a pre-installed Chromium that doesn't match the build
// `npx playwright install` would fetch. Point PLAYWRIGHT_CHROMIUM_PATH at it
// there; leave it unset locally and Playwright uses its own download.
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined;

// The dev server talks to Supabase over the public internet, but the tests talk
// to the dev server on loopback — a proxy in between breaks that.
process.env.NO_PROXY = [process.env.NO_PROXY, 'localhost,127.0.0.1'].filter(Boolean).join(',');

const PORT = Number(process.env.E2E_PORT ?? 3000);
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  // Server actions mutate shared state; keep write-path specs from racing.
  workers: process.env.CI ? 1 : undefined,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  timeout: 30_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: executablePath ? { executablePath } : {},
  },

  projects: [
    { name: 'chromium-light', use: { ...devices['Desktop Chrome'], colorScheme: 'light' } },
    { name: 'chromium-dark', use: { ...devices['Desktop Chrome'], colorScheme: 'dark' } },
    // The portal sidebar collapses to a drawer under 900px — worth its own run.
    { name: 'mobile-viewport', use: { ...devices['Pixel 7'] } },
  ],

  // Reuse an already-running `next dev` when there is one, so an interactive
  // session doesn't get its server torn down by a test run.
  webServer: {
    command: `npm run dev -- --port ${PORT}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
    // Replaces process.env rather than merging, so spread it or the command
    // loses PATH and never starts.
    env: {
      ...(process.env as Record<string, string>),
      // Node's built-in fetch ignores HTTPS_PROXY, so behind a proxy the server
      // silently fails to reach Supabase — and the app reports that as
      // "Incorrect email or password.", which looks like a test-data problem
      // rather than a network one. Needs Node >= 22.21; harmless without a proxy.
      NODE_USE_ENV_PROXY: '1',
    },
  },
});
