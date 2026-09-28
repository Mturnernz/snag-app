import { test, expect, type Page } from '@playwright/test';

// Unauthenticated coverage of the app's front door. Needs no credentials and
// writes nothing, so it runs anywhere the bundle can be served.

// Metro's first bundle is slow; wait on real content rather than a fixed sleep.
async function waitForApp(page: Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Sign in', { exact: true })).toBeVisible({ timeout: 120_000 });
}

test('the auth screen renders its sign-in form', async ({ page }) => {
  await waitForApp(page);

  await expect(page.getByText('The list of things that need doing')).toBeVisible();
  await expect(page.getByLabel('Email', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Password', { exact: true })).toBeVisible();
});

// textContentType is iOS-native only. What reaches a browser's password manager
// is the autocomplete attribute, and without it the web build — the one people
// install — offered nothing to save and nothing to fill.
test('each box tells the browser what it holds', async ({ page }) => {
  await waitForApp(page);

  await expect(page.getByLabel('Email', { exact: true })).toHaveAttribute('autocomplete', 'email');
  await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute('autocomplete', 'current-password');

  await page.getByText('No account yet? Create one').click();
  await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute('autocomplete', 'new-password');
});

test('you can get to account creation and back', async ({ page }) => {
  await waitForApp(page);

  await page.getByText('No account yet? Create one').click();
  await expect(page.getByText('Create account', { exact: true })).toBeVisible();

  await page.getByText('Already have an account? Sign in').click();
  await expect(page.getByText('Sign in', { exact: true })).toBeVisible();
});

test('password recovery is reachable without an account', async ({ page }) => {
  // Mobile has no recovery screen of its own — this hands off to the portal's
  // /reset-password. If this link goes, there is no other way back in.
  await waitForApp(page);
  await expect(page.getByText('Forgot your password?')).toBeVisible();
});

// The button is never dead: a disabled one can't be told apart from one that
// did nothing. It says what the form still wants, and sends nothing.
test('a new password that is too short is refused in words, before anything is sent', async ({ page }) => {
  await waitForApp(page);

  await page.getByText('No account yet? Create one').click();
  await page.getByLabel('Email', { exact: true }).fill('someone@example.com');
  await page.getByLabel('Password', { exact: true }).fill('abc');
  await page.getByText('Create account', { exact: true }).click();

  await expect(page.getByText('Use at least 8 characters.')).toBeVisible();
  await expect(page.getByLabel('Email', { exact: true })).toBeVisible();
});

// Somebody who has just scanned a household's QR has no account. Signing up is
// their journey, so the screen opens on it and says why they are there.
test('a join link opens on create account', async ({ page }) => {
  await page.goto('/join/8f1d3c2e-0000-4000-8000-000000000000', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Create account', { exact: true })).toBeVisible({ timeout: 120_000 });
  await expect(page.getByText('Create an account to join the household that shared this link.')).toBeVisible();
});
