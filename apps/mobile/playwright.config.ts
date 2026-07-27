import { defineConfig, devices } from '@playwright/test';

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
