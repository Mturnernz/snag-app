import { test, expect, type Page } from '@playwright/test';

// The guided walkthrough, in a browser.
//
// Everything about it that can break silently is web-specific: the overlay is
// four absolutely-positioned scrim rects rather than a Modal (so it can draw
// over the tab bar without swallowing the tap the step is asking for), the
// callout's placement is computed from `useWindowDimensions` rather than a
// percentage, and the whole thing renders through react-native-web at desktop
// widths as well as phone ones. None of that is exercised by jest.
//
// Started from Profile → Walkthrough rather than by waiting for a first run:
// `tour_status` is a server column, so a test account only auto-starts once,
// and a spec that depends on that passes exactly one time.
//
// Needs a worker account:
//   E2E_WORKER_EMAIL / E2E_WORKER_PASSWORD
const EMAIL = process.env.E2E_WORKER_EMAIL;
const PASSWORD = process.env.E2E_WORKER_PASSWORD;

async function signIn(page: Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Sign In', { exact: true })).toBeVisible({ timeout: 120_000 });
  await page.getByPlaceholder('Email').fill(EMAIL!);
  await page.getByPlaceholder('Password').fill(PASSWORD!);
  await page.getByText('Sign In', { exact: true }).click();
  await expect(page.getByText(/report a snag|welcome to snag/i).first()).toBeVisible({
    timeout: 90_000,
  });
}

/** Leaves the walkthrough running at step 1, whatever state the account was in. */
async function startWalkthrough(page: Page) {
  // If a first run already opened it, we're there.
  const welcome = page.getByText('Welcome to SNAG', { exact: true });
  if (await welcome.isVisible().catch(() => false)) return;

  await page.getByText('Profile', { exact: true }).last().click();
  await page.getByText(/^(Resume )?walkthrough$/i).click();
  await expect(welcome).toBeVisible({ timeout: 30_000 });
}

test.describe('the guided walkthrough', () => {
  test.skip(
    !EMAIL || !PASSWORD,
    'set E2E_WORKER_EMAIL and E2E_WORKER_PASSWORD to run the authenticated mobile specs'
  );

  test('opens on the welcome step and counts them', async ({ page }) => {
    await signIn(page);
    await startWalkthrough(page);

    await expect(page.getByText(/^Step 1 of \d+$/)).toBeVisible();
    // Crew see 14 steps; a Site Lead or Manager more. Asserting the shape
    // rather than the number keeps this from failing on a content edit.
    const progress = await page.getByText(/^Step 1 of \d+$/).textContent();
    expect(Number(progress!.match(/of (\d+)/)![1])).toBeGreaterThan(5);
  });

  test('moves forward and back', async ({ page }) => {
    await signIn(page);
    await startWalkthrough(page);

    await page.getByText('Next', { exact: true }).click();
    await expect(page.getByText(/^Step 2 of \d+$/)).toBeVisible();

    await page.getByText('Next', { exact: true }).click();
    await expect(page.getByText(/^Step 3 of \d+$/)).toBeVisible();

    await page.getByText('Back', { exact: true }).click();
    await expect(page.getByText(/^Step 2 of \d+$/)).toBeVisible();
  });

  test('pauses to a resume bar, and comes back to the same step', async ({ page }) => {
    await signIn(page);
    await startWalkthrough(page);

    await page.getByText('Next', { exact: true }).click();
    await page.getByText('Next', { exact: true }).click();
    await expect(page.getByText(/^Step 3 of \d+$/)).toBeVisible();

    await page.getByText('Pause', { exact: true }).click();

    // The callout goes; the way back stays, naming where it stopped.
    await expect(page.getByText(/^Step 3 of \d+$/)).toBeHidden();
    await expect(page.getByText('Walkthrough paused')).toBeVisible();
    await expect(page.getByText(/^Step 3 of \d+ ·/)).toBeVisible();

    await page.getByText('Resume', { exact: true }).click();
    await expect(page.getByText(/^Step 3 of \d+$/)).toBeVisible();
  });

  test('leaves the spotlit control tappable', async ({ page }) => {
    await signIn(page);
    await startWalkthrough(page);

    // Step 3 points at the Report tab. The scrim is four rects with a hole in
    // the middle precisely so this still works — with a Modal, or with one
    // full-screen overlay, the tab would be unreachable and the step would be
    // telling somebody to do something the walkthrough itself prevents.
    await page.getByText('Next', { exact: true }).click();
    await page.getByText('Next', { exact: true }).click();
    await expect(page.getByText('Reporting is the first tab')).toBeVisible();

    await page.getByText('Report', { exact: true }).last().click();
    await expect(page.getByText(/what's wrong\?/i)).toBeVisible({ timeout: 30_000 });
    // And the walkthrough is still up over it.
    await expect(page.getByText('Reporting is the first tab')).toBeVisible();
  });

  test('holds a gated step until the action is done, and offers a way past', async ({ page }) => {
    await signIn(page);
    await startWalkthrough(page);

    // Walk to "Add a photo", the first gated step.
    for (let i = 0; i < 12; i += 1) {
      if (await page.getByText('Add a photo', { exact: true }).isVisible().catch(() => false)) break;
      await page.getByText('Next', { exact: true }).click();
    }
    await expect(page.getByText('Add a photo', { exact: true })).toBeVisible();
    await expect(page.getByText(/Next opens up once you have/)).toBeVisible();

    // Nobody gets stuck: a denied camera permission or an empty org still has
    // a way forward.
    await page.getByText('Skip this step').click();
    await expect(page.getByText('Add a photo', { exact: true })).toBeHidden();
  });

  test('caps the callout at desktop width', async ({ page }) => {
    // apps/mobile is also served at app.snaghq.co.nz in a desktop browser,
    // where a full-bleed instruction card reads as a banner rather than as
    // something pointing at a control.
    await page.setViewportSize({ width: 1440, height: 900 });
    await signIn(page);
    await startWalkthrough(page);

    const card = page.getByText('Welcome to SNAG', { exact: true });
    const box = await card.boundingBox();
    expect(box!.width).toBeLessThan(500);
  });
});
