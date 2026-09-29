import { expect, type Page } from '@playwright/test';

/**
 * From a cold load to the email box, the way a person gets there: hello,
 * *Get started*, and — only when Google is switched on — *Use my email*.
 *
 * One helper for every spec, because the front door is a run of screens
 * rather than one form, and three copies of the route through it are three
 * places to fix the next time a screen is added. Metro's first bundle is slow,
 * so the first wait is on real content rather than a fixed sleep.
 */
export async function reachEmail(page: Page, path = '/') {
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Get started', { exact: true })).toBeVisible({ timeout: 120_000 });
  await page.getByText('Get started', { exact: true }).click();
  const useEmail = page.getByText('Use my email', { exact: true });
  const emailBox = page.getByLabel('Email', { exact: true });
  await expect(useEmail.or(emailBox)).toBeVisible();
  if (await useEmail.isVisible()) await useEmail.click();
  await expect(emailBox).toBeVisible();
}

/** On to the password box with an address typed. */
export async function reachPassword(page: Page, email: string, path = '/') {
  await reachEmail(page, path);
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByText('Continue', { exact: true }).click();
  await expect(page.getByLabel('Password', { exact: true })).toBeVisible();
}
