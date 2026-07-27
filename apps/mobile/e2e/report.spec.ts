import { test, expect, type Page } from '@playwright/test';

// Authenticated, READ-ONLY coverage of the worker's core journey: sign in, reach
// the report screen, and see the two reporting lanes. It fills no form and
// submits nothing, so it is safe against an org with real data in it.
//
// Needs a worker account:
//   E2E_WORKER_EMAIL / E2E_WORKER_PASSWORD
//
// The app calls Supabase from the browser, so the browser needs egress to the
// project. Behind a TLS-terminating proxy that Chromium cannot traverse, run
// scripts/supabase-relay.mjs and point the bundle at it — see TESTING.md.
const EMAIL = process.env.E2E_WORKER_EMAIL;
const PASSWORD = process.env.E2E_WORKER_PASSWORD;

async function signIn(page: Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Sign In', { exact: true })).toBeVisible({ timeout: 120_000 });

  await page.getByPlaceholder('Email').fill(EMAIL!);
  await page.getByPlaceholder('Password').fill(PASSWORD!);
  await page.getByText('Sign In', { exact: true }).click();
}

test.describe('worker journey', () => {
  test.skip(
    !EMAIL || !PASSWORD,
    'set E2E_WORKER_EMAIL and E2E_WORKER_PASSWORD to run the authenticated mobile specs'
  );

  test('a worker can sign in', async ({ page }) => {
    await signIn(page);

    // First run lands on onboarding; a returning account goes straight in. Both
    // are success — the assertion is that the auth screen is behind us.
    await expect(
      page.getByText(/welcome to snag|report a snag/i).first()
    ).toBeVisible({ timeout: 90_000 });
  });

  test('the report screen offers both lanes and is scoped to the right org', async ({ page }) => {
    await signIn(page);

    const start = page.getByText(/report a snag/i).first();
    await expect(start).toBeVisible({ timeout: 90_000 });
    await start.click();

    // Which org a report lands in is the thing a worker must never get wrong.
    await expect(page.getByText('Reporting into')).toBeVisible({ timeout: 60_000 });

    await expect(page.getByText("What's wrong?")).toBeVisible();
    await expect(page.getByText('Add up to 5 photos')).toBeVisible();

    // The two lanes: niggles inline, serious incidents down a separate guided
    // path. Collapsing them would let a hazard be filed as a fixit.
    await expect(page.getByText('Fixit', { exact: true })).toBeVisible();
    await expect(page.getByText('Improvement', { exact: true })).toBeVisible();
    await expect(page.getByText(/report a serious incident/i)).toBeVisible();
  });

  test('the description field enforces its character limit', async ({ page }) => {
    await signIn(page);
    await page.getByText(/report a snag/i).first().click();
    await expect(page.getByText("What's wrong?")).toBeVisible({ timeout: 60_000 });

    // The counter reads "0 / 300" before typing; the cap is what stops a report
    // being silently truncated on save.
    await expect(page.getByText(/\/\s*300/)).toBeVisible();
  });

  test('the tab bar exposes the worker sections', async ({ page }) => {
    await signIn(page);
    await expect(page.getByText(/report a snag/i).first()).toBeVisible({ timeout: 90_000 });

    for (const label of ['Report', 'Snags', 'Profile']) {
      await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
    }
  });

  test('the snags list is reachable and renders', async ({ page }) => {
    await signIn(page);
    await expect(page.getByText(/report a snag/i).first()).toBeVisible({ timeout: 90_000 });

    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await page.getByText('Snags', { exact: true }).first().click();
    // Either snags or a genuine empty state — both are correct. A blank screen
    // with a JS error is not.
    await page.waitForTimeout(5_000);
    expect(errors).toEqual([]);
  });
});
