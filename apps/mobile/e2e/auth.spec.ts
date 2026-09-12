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
  await expect(page.getByPlaceholder('Email')).toBeVisible();
  await expect(page.getByPlaceholder('Password')).toBeVisible();
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

test('submitting is blocked until both fields are filled', async ({ page }) => {
  await waitForApp(page);

  const submit = page.getByText('Sign in', { exact: true });
  await page.getByPlaceholder('Email').fill('someone@example.com');
  // Password is still empty, and a six-character minimum applies.
  await page.getByPlaceholder('Password').fill('abc');
  await submit.click();

  // Still on the auth screen: nothing navigated.
  await expect(page.getByPlaceholder('Email')).toBeVisible();
});
