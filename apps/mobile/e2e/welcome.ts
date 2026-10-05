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

/**
 * Past anything setup has still to show this account, onto the list.
 *
 * A step added after the account was set up — the tour, October 2026 — is
 * shown once as a catch-up (*One new thing*, then the step) before the app. A
 * person skips it; so does this, which also marks it seen, so later runs go
 * straight to the list. Waits on whichever comes first, because which one
 * comes depends on what the shared account has already been shown.
 */
export async function pastSetup(page: Page) {
  const list = page.getByLabel('Capture a new job');
  const catchUp = page.getByText('One new thing', { exact: true });
  const tour = page.getByText('How Snag works', { exact: true });
  await expect(list.or(catchUp).or(tour)).toBeVisible({ timeout: 90_000 });
  if (await catchUp.isVisible()) {
    await page.getByText('Continue', { exact: true }).click();
    await expect(tour).toBeVisible();
  }
  if (await tour.isVisible()) await page.getByText('Skip', { exact: true }).click();
  await expect(list).toBeVisible({ timeout: 90_000 });
}
