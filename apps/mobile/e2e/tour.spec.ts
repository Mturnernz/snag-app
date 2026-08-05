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
// **These tests are stateful, and deliberately so.** Walkthrough progress is a
// server column on `profiles`, not per-session state, so every run shares one
// account's resume point and each test inherits whatever the last one left.
// The first attempt at this file ignored that and failed in CI in two ways
// worth recording, because both are the feature behaving correctly:
//
//   - `signIn` waited for "Report a Snag", assuming the app lands on the Report
//     tab. It doesn't any more: the walkthrough restores the tab its saved step
//     lives on, so a resumed run lands on Profile and React Navigation leaves
//     the Report screen mounted with `display: none`. The locator resolved and
//     reported `hidden` for ninety seconds.
//   - Each test called a "start the walkthrough" helper that assumed it would
//     land on step 1. A *paused* walkthrough resumes where it stopped — which
//     is the whole point of it — so from test four onward they began mid-way.
//
// A saved step no longer decides which tab the app opens on: an unfinished
// walkthrough now comes back as the resume bar rather than putting the overlay
// straight up (see TourContext). So this is the only spec that has to know the
// walkthrough exists.
//
// So: one serial journey rather than six independent tests, `resetToStepOne`
// to get a known starting point out of any prior state, and the run ends by
// finishing the walkthrough so the shared account is left in `done` — a clean,
// known state for the next run.
//
// Needs a worker account:
//   E2E_WORKER_EMAIL / E2E_WORKER_PASSWORD
const EMAIL = process.env.E2E_WORKER_EMAIL;
const PASSWORD = process.env.E2E_WORKER_PASSWORD;

test.describe.configure({ mode: 'serial' });

const welcomeCard = (page: Page) => page.getByText('Welcome to SNAG', { exact: true });
const progress = (page: Page) => page.getByText(/^Step \d+ of \d+$/);

async function signIn(page: Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const signInButton = page.getByText('Sign In', { exact: true });
  await expect(signInButton).toBeVisible({ timeout: 120_000 });
  await page.getByPlaceholder('Email').fill(EMAIL!);
  await page.getByPlaceholder('Password').fill(PASSWORD!);
  await signInButton.click();

  // Tab-independent on purpose: which tab the app opens on depends on the
  // walkthrough's saved step, so the only thing we can assert here is that the
  // auth screen is behind us.
  await expect(signInButton).toBeHidden({ timeout: 90_000 });
}

/** The step number showing on the callout right now. */
async function stepNumber(page: Page): Promise<number> {
  const text = await progress(page).textContent();
  return Number(text!.match(/^Step (\d+)/)![1]);
}

/**
 * Press on to the finish card and dismiss it, leaving the walkthrough `done`.
 *
 * Gated steps won't let Next through until the action is done, so this takes
 * their Skip — the escape hatch that exists precisely so nobody can be trapped.
 */
async function advanceToEnd(page: Page) {
  for (let i = 0; i < 40; i += 1) {
    const skip = page.getByText('Skip this step');
    if (await skip.isVisible().catch(() => false)) {
      await skip.click();
      continue;
    }
    const finish = page.getByText('Finish', { exact: true });
    if (await finish.isVisible().catch(() => false)) {
      await finish.click();
      break;
    }
    await page.getByText('Next', { exact: true }).click();
  }

  // Progress is written fire-and-forget — the app doesn't await the RPC, which
  // is right for a user (a killed app costs them one step) and wrong for a
  // shared test account: closing the page cuts the final `done` off, and the
  // next run then boots every earlier spec inside a live walkthrough. That is
  // what produced the first three failures here.
  //
  // Matched on the body rather than just the URL. The first attempt waited for
  // any `set_tour_progress` response and still left the account mid-way: the
  // writes are queued now, so several are in flight behind this one, and it
  // resolved on the wrong one.
  const written = page
    .waitForResponse(
      (r) =>
        r.url().includes('/rpc/set_tour_progress') &&
        (r.request().postData() ?? '').includes('"done"') &&
        r.status() < 400,
      { timeout: 15_000 },
    )
    .catch(() => null);

  await page.getByText('Done', { exact: true }).click();
  await expect(progress(page)).toBeHidden();
  await written;
}

/**
 * Reach the Profile tab with nothing of the walkthrough's own on top of it.
 *
 * The scrim no longer blocks, but the callout card is a real interactive
 * surface and can sit over the row we want — so pause, which takes it away.
 * `isVisible()` resolves immediately rather than waiting, so a callout that
 * hasn't rendered yet reads as absent; hence the second look.
 */
async function openProfile(page: Page) {
  const pause = page.getByText('Pause', { exact: true });
  if (!(await pause.isVisible().catch(() => false))) await page.waitForTimeout(1500);
  if (await pause.isVisible().catch(() => false)) await pause.click();

  // The resume bar takes the pause's place, low on the screen; dismiss it so it
  // can't sit over the row either.
  const dismiss = page.getByLabel('Hide until next time');
  if (await dismiss.isVisible().catch(() => false)) await dismiss.click();

  await page.getByText('Profile', { exact: true }).last().click();
}

const walkthroughRow = (page: Page) => page.getByText(/^(Resume walkthrough|Walkthrough)$/);

/**
 * Step 1, out of whatever the previous run left behind.
 *
 * Tapping the Profile row restarts when the walkthrough is finished and
 * *resumes* when it is paused, so a mid-way account needs driving to the end
 * first — there is no "start over" from a paused state, which is a real (if
 * minor) gap in the UI as well as an inconvenience here.
 */
async function resetToStepOne(page: Page) {
  if (await welcomeCard(page).isVisible().catch(() => false)) return;

  await openProfile(page);
  await walkthroughRow(page).click();
  await expect(progress(page)).toBeVisible({ timeout: 30_000 });

  if (!(await welcomeCard(page).isVisible().catch(() => false))) {
    await advanceToEnd(page);
    await openProfile(page);
    await walkthroughRow(page).click();
  }
  await expect(welcomeCard(page)).toBeVisible({ timeout: 30_000 });
}

test.describe('the guided walkthrough', () => {
  test.skip(
    !EMAIL || !PASSWORD,
    'set E2E_WORKER_EMAIL and E2E_WORKER_PASSWORD to run the authenticated mobile specs'
  );

  test('walks a crew member through, and can be paused and picked up', async ({ page }) => {
    await signIn(page);
    await resetToStepOne(page);

    // ── Opens on the welcome step, and says how many there are ──────────────
    await expect(progress(page)).toHaveText(/^Step 1 of \d+$/);
    const total = Number((await progress(page).textContent())!.match(/of (\d+)/)![1]);
    // Crew see 14 today. Asserting the shape rather than the number keeps this
    // from failing every time somebody edits the guide.
    expect(total).toBeGreaterThan(5);

    // ── Forward and back ────────────────────────────────────────────────────
    await page.getByText('Next', { exact: true }).click();
    await expect(progress(page)).toHaveText('Step 2 of ' + total);
    await page.getByText('Next', { exact: true }).click();
    await expect(progress(page)).toHaveText('Step 3 of ' + total);
    await page.getByText('Back', { exact: true }).click();
    await expect(progress(page)).toHaveText('Step 2 of ' + total);

    // ── Pause leaves a way back, at the same step ───────────────────────────
    await page.getByText('Pause', { exact: true }).click();
    await expect(progress(page)).toBeHidden();
    await expect(page.getByText('Walkthrough paused')).toBeVisible();
    await expect(page.getByText(/^Step 2 of \d+ ·/)).toBeVisible();

    await page.getByText('Resume', { exact: true }).click();
    await expect(progress(page)).toHaveText('Step 2 of ' + total);

    // ── The spotlit control stays tappable ──────────────────────────────────
    //
    // The reason the overlay is four scrim rects rather than a Modal or one
    // full-screen layer: with either of those, the tab this step is pointing at
    // would be the one thing you couldn't press.
    //
    // Clicks the tab *label*, not the icon, deliberately. The anchor wraps the
    // icon, so a scrim that swallowed taps left the word "Report" dead — this
    // test caught exactly that, and the scrim no longer blocks at all.
    while (!(await page.getByText('Reporting is the first tab').isVisible().catch(() => false))) {
      await page.getByText('Next', { exact: true }).click();
      expect(await stepNumber(page)).toBeLessThan(total);
    }
    await page.getByText('Report', { exact: true }).last().click();
    await expect(page.getByText(/what's wrong\?/i)).toBeVisible({ timeout: 30_000 });
    // And the walkthrough is still up over it, rather than dismissed by the tap.
    await expect(page.getByText('Reporting is the first tab')).toBeVisible();

    // ── A gated step waits, and offers a way past ───────────────────────────
    while (!(await page.getByText('Add a photo', { exact: true }).isVisible().catch(() => false))) {
      await page.getByText('Next', { exact: true }).click();
      expect(await stepNumber(page)).toBeLessThan(total);
    }
    await expect(page.getByText(/Next opens up once you have/)).toBeVisible();
    const gatedAt = await stepNumber(page);

    // Nobody gets stuck: a denied camera permission, or an org with no sites,
    // still has a way forward.
    await page.getByText('Skip this step').click();
    await expect(progress(page)).toHaveText(`Step ${gatedAt + 1} of ${total}`);

    // ── Finish, leaving the shared account in a known state ─────────────────
    await advanceToEnd(page);
  });

  test('caps the callout at desktop width', async ({ page }) => {
    // apps/mobile is also served at app.snaghq.co.nz in a desktop browser,
    // where a full-bleed instruction card reads as a banner rather than as
    // something pointing at a control.
    await page.setViewportSize({ width: 1440, height: 900 });
    await signIn(page);
    await resetToStepOne(page);

    const box = await welcomeCard(page).boundingBox();
    expect(box!.width).toBeLessThan(500);

    await advanceToEnd(page);
  });
});
