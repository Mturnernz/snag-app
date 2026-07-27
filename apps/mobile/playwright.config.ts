import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

// Expo loads .env.local then .env for the bundle, but not for this process, so
// the E2E_* credentials would sit in the file while the authenticated specs
// silently skipped. Same precedence as Expo: .env.local wins, real environment
// variables win over both.
//
// Resolved from cwd rather than the config's own path: Playwright transpiles
// this file to CJS, where import.meta is unavailable. Both `npx playwright test`
// run here and `npm run test:e2e --workspace=apps/mobile` put cwd at this
// directory.
for (const file of ['.env.local', '.env']) {
  try {
    for (const line of readFileSync(resolve(process.cwd(), file), 'utf8').split('\n')) {
      const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
    }
  } catch {
    // No such file — fine, the specs skip themselves without credentials.
  }
}

// Browser-level specs for the Expo app, rendered through react-native-web.
//
// This is real coverage of layout, navigation, and data flow, but it is not
// equivalent to a native build: expo-camera, expo-image-picker,
// expo-image-manipulator, and expo-file-system have no web implementation worth
// asserting on, so those paths still need a device via Expo Go. See TESTING.md.

const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined;

process.env.NO_PROXY = [process.env.NO_PROXY, 'localhost,127.0.0.1'].filter(Boolean).join(',');

const PORT = Number(process.env.MOBILE_E2E_PORT ?? 8081);
const baseURL = process.env.MOBILE_E2E_BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  // Metro serves an unminified dev bundle, so first paint is slow.
  timeout: 120_000,
  expect: { timeout: 30_000 },

  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: executablePath ? { executablePath } : {},
    // The app is phone-shaped; asserting at desktop width would test a layout
    // no real user sees.
    ...devices['Pixel 7'],
  },

  projects: [{ name: 'mobile-web', use: {} }],

  webServer: {
    command: `npx expo start --web --port ${PORT}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    // Cold Metro start plus the first bundle is well over a minute.
    timeout: 300_000,
    stdout: 'ignore',
    stderr: 'pipe',
    env: {
      ...(process.env as Record<string, string>),
      NODE_USE_ENV_PROXY: '1',
    },
  },
});
