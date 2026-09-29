import { test, expect, type Page } from '@playwright/test';
import { reachEmail, reachPassword } from './welcome';

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

// Google is off until it is set up for households, and with one way in the
// choice screen is skipped.
test('get started goes to the email question', async ({ page }) => {
  await reachEmail(page);
  await expect(page.getByText("What's your email?", { exact: true })).toBeVisible();
});

// textContentType is iOS-native only. What reaches a browser's password manager
// is the autocomplete attribute, and without it the web build — the one people
// install — offered nothing to save and nothing to fill.
test('each box tells the browser what it holds', async ({ page }) => {
  await reachEmail(page);
  await expect(page.getByLabel('Email', { exact: true })).toHaveAttribute('autocomplete', 'email');

  await page.getByLabel('Email', { exact: true }).fill('someone@example.com');
  await page.getByText('Continue', { exact: true }).click();
  await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute('autocomplete', 'current-password');

  await page.getByText("I'm new here", { exact: true }).click();
  await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute('autocomplete', 'new-password');
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

// The button is never dead: a disabled one can't be told apart from one that
// did nothing. It says what the form still wants, and sends nothing.
test('a new password that is too short is refused in words, before anything is sent', async ({ page }) => {
  await reachPassword(page, 'someone@example.com');
  await page.getByText("I'm new here", { exact: true }).click();
  await page.getByLabel('Password', { exact: true }).fill('abc');
  await page.getByText('Create account', { exact: true }).click();

  await expect(page.getByText('Use at least 8 characters.')).toBeVisible();
  await expect(page.getByLabel('Password', { exact: true })).toBeVisible();
});

// Somebody who has just scanned a household's QR has no account. Signing up is
// their journey, so the email path opens on it and says why they are there.
test('a join link opens on create account', async ({ page }) => {
  await reachPassword(page, 'someone@example.com', '/join/8f1d3c2e-0000-4000-8000-000000000000');
  await expect(page.getByText('Create account', { exact: true })).toBeVisible();
  await expect(page.getByText('Create an account to join the household that shared this link.')).toBeVisible();
});
