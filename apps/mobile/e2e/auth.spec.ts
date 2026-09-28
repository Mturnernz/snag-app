import { test, expect, type Page } from '@playwright/test';
import { reachPassword } from './welcome';

// Unauthenticated coverage of the app's front door. Needs no credentials and
// writes nothing, so it runs anywhere the bundle can be served.

// Metro's first bundle is slow; wait on real content rather than a fixed sleep.
async function waitForApp(page: Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Get started', { exact: true })).toBeVisible({ timeout: 120_000 });
}

test('it opens on a greeting, not a form', async ({ page }) => {
  await waitForApp(page);

  await expect(page.getByText('Welcome', { exact: true })).toBeVisible();
  await expect(page.getByText('The list of things that need doing around the house')).toBeVisible();
  await expect(page.getByLabel('Password', { exact: true })).toHaveCount(0);
});

test('Google comes first, and email is the other way in', async ({ page }) => {
  await waitForApp(page);
  await page.getByText('Get started', { exact: true }).click();

  await expect(page.getByText('Continue with Google', { exact: true })).toBeVisible();
  await expect(page.getByText('Use my email', { exact: true })).toBeVisible();
});

test('you can get to account creation and back', async ({ page }) => {
  await reachPassword(page, 'someone@example.com');
  await expect(page.getByText('Welcome back', { exact: true })).toBeVisible();

  await page.getByText("I'm new here", { exact: true }).click();
  await expect(page.getByText('Create account', { exact: true })).toBeVisible();

  await page.getByText('I already have an account', { exact: true }).click();
  await expect(page.getByText('Sign in', { exact: true })).toBeVisible();
});

test('password recovery is reachable without an account', async ({ page }) => {
  // Mobile has no recovery screen of its own — this hands off to the portal's
  // /reset-password. If this link goes, there is no other way back in.
  await reachPassword(page, 'someone@example.com');
  await expect(page.getByText('Forgot your password?')).toBeVisible();
});

test('submitting is blocked until the password is long enough', async ({ page }) => {
  await reachPassword(page, 'someone@example.com');

  // A six-character minimum applies.
  await page.getByLabel('Password', { exact: true }).fill('abc');
  await page.getByText('Sign in', { exact: true }).click({ force: true });

  // Still on the password screen: nothing navigated.
  await expect(page.getByLabel('Password', { exact: true })).toBeVisible();
});
