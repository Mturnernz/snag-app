import { expect, type Page } from '@playwright/test';

/**
 * From a cold load to the password box, the way a person gets there: hello,
 * *Get started*, *Use my email*, the address, *Continue*.
 *
 * One helper for every spec, because the front door is now a run of screens
 * rather than one form, and three copies of the route through it are three
 * places to fix the next time a screen is added to it. Metro's first bundle is
 * slow, so the first wait is on real content rather than a fixed sleep.
 */
export async function reachPassword(page: Page, email: string) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Get started', { exact: true })).toBeVisible({ timeout: 120_000 });
  await page.getByText('Get started', { exact: true }).click();
  await page.getByText('Use my email', { exact: true }).click();
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByText('Continue', { exact: true }).click();
  await expect(page.getByLabel('Password', { exact: true })).toBeVisible();
}
