import { expect, type Page } from '@playwright/test';

/**
 * From a cold load to the email form, the way a person gets there: hello,
 * *Get started*, *Use my email*. The form is AuthScreen, with the email and
 * password boxes together, and it opens on *Sign in*.
 *
 * One helper for every spec, because the front door is now a run of screens
 * rather than one form, and three copies of the route through it are three
 * places to fix the next time a screen is added to it. Metro's first bundle is
 * slow, so the first wait is on real content rather than a fixed sleep.
 */
export async function reachEmail(page: Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Get started', { exact: true })).toBeVisible({ timeout: 120_000 });
  await page.getByText('Get started', { exact: true }).click();
  await page.getByText('Use my email', { exact: true }).click();
  await expect(page.getByLabel('Password', { exact: true })).toBeVisible();
}

/** The email form with the address filled in, ready for a password. */
export async function reachPassword(page: Page, email: string) {
  await reachEmail(page);
  await page.getByLabel('Email', { exact: true }).fill(email);
}
