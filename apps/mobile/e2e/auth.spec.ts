import { test, expect, type Page } from '@playwright/test';

// Unauthenticated coverage of the app's front door. Needs no credentials and
// writes nothing, so it runs anywhere the bundle can be served.

// Metro's first bundle is slow; wait on real content rather than a fixed sleep.
async function waitForApp(page: Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Sign In', { exact: true })).toBeVisible({ timeout: 120_000 });
}

test('the auth screen renders its sign-in form and both join paths', async ({ page }) => {
  await waitForApp(page);

  await expect(page.getByText('Workplace issue reporting')).toBeVisible();
  await expect(page.getByPlaceholder('Email')).toBeVisible();
  await expect(page.getByPlaceholder('Password')).toBeVisible();

  // Two distinct ways in — joining an existing org, or creating one. Losing
  // either strands a whole class of user on the first screen.
  await expect(page.getByText('Sign Up', { exact: true })).toBeVisible();
  await expect(page.getByText('Create an organisation')).toBeVisible();
});

test('the bundle loads without JS errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // No filter here on purpose. This used to skip jsqr/jsdelivr errors as "an
  // environment condition" — expo-camera's web entry fetched jsQR from a CDN
  // just by being imported. The import is gone (see src/lib/camera.web.ts), so
  // that error reappearing means someone reintroduced it, which is exactly what
  // this test should fail on rather than ignore.
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });

  await waitForApp(page);
  expect(errors).toEqual([]);
});

test('the password field is masked', async ({ page }) => {
  await waitForApp(page);
  // secureTextEntry maps to type="password" under react-native-web. A plain
  // text field would show a worker's password on a shared site phone.
  await expect(page.getByPlaceholder('Password')).toHaveAttribute('type', 'password');
});

test('bad credentials are rejected without reaching the app', async ({ page }) => {
  await waitForApp(page);

  await page.getByPlaceholder('Email').fill('definitely-not-a-user@example.invalid');
  await page.getByPlaceholder('Password').fill('not-the-password');
  await page.getByText('Sign In', { exact: true }).click();

  await expect(page.getByText(/couldn'?t sign you in/i)).toBeVisible({ timeout: 60_000 });
  // Still on the auth screen, not inside the app.
  await expect(page.getByPlaceholder('Email')).toBeVisible();
});

test('the sign-up path is reachable from the auth screen', async ({ page }) => {
  await waitForApp(page);

  await page.getByText('Sign Up', { exact: true }).click();
  // Leaving the auth screen is the assertion — the sign-in form goes away.
  await expect(page.getByText('Workplace issue reporting')).toBeHidden({ timeout: 60_000 });
});

test('the create-organisation path is reachable from the auth screen', async ({ page }) => {
  await waitForApp(page);

  await page.getByText('Create an organisation').click();
  await expect(page.getByText('Workplace issue reporting')).toBeHidden({ timeout: 60_000 });
});

test('nothing overflows horizontally at phone width', async ({ page }) => {
  await waitForApp(page);

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow, 'auth screen must not scroll sideways').toBeLessThanOrEqual(1);
});
