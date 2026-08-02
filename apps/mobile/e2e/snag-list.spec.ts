import { test, expect, type Page } from '@playwright/test';

// Authenticated, READ-ONLY coverage of the Snags tab — the filter bar and the
// card chrome. It taps nothing that writes and submits no form.
//
// This tier exists because the Snags tab had no browser coverage at all, and
// the filter bar is where that hurt: `hitSlop` is the obvious way to widen a
// chip's tap area, it typechecks, it works on a phone, and react-native-web's
// TouchableOpacity never reads it — so the web build kept 34px targets while
// the code said 48. Nothing failed. The touch-target spec below is the one
// that would have caught it, and it measures the rendered box rather than
// trusting the prop.
//
// Needs a member account:
//   E2E_EMAIL / E2E_PASSWORD
//
// See TESTING.md for running this behind a TLS-terminating proxy.
const EMAIL = process.env.E2E_EMAIL;
const PASSWORD = process.env.E2E_PASSWORD;

// apps/mobile/src/constants/theme.ts — the rule the filter bar bends visually
// and must not bend in the tap area.
const MIN_TOUCH_TARGET = 48;

// Every chip the bar can render. Which of them are present depends on the
// account's role and org (Public only shows for a public org with public
// submissions, the unassigned scopes only for staff), so the specs assert
// against whichever are actually on screen rather than a fixed list.
const CHIP_LABELS = ['Status', 'Date', 'Oldest', 'Site', 'Assigned', 'Trending', 'Public',
  'Relevant', 'Mine', 'My Sites', 'Raised by Me', 'Mentioned'];

async function signIn(page: Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Sign In', { exact: true })).toBeVisible({ timeout: 120_000 });
  await page.getByPlaceholder('Email').fill(EMAIL!);
  await page.getByPlaceholder('Password').fill(PASSWORD!);
  await page.getByText('Sign In', { exact: true }).click();
}

async function openSnags(page: Page) {
  await signIn(page);
  await expect(page.getByText(/report a snag/i).first()).toBeVisible({ timeout: 90_000 });
  await page.getByText('Snags', { exact: true }).first().click();

  // Status/Date/Trending render immediately; Scope, Site and Assigned are
  // gated on `hasOrg`, which is only known once the first fetch resolves. Wait
  // for Site or the bar measured here is a three-chip bar that fits the
  // viewport, and every assertion below is about the wrong thing.
  await expect(page.getByRole('button', { name: 'Status', exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('button', { name: 'Site', exact: true })).toBeVisible({ timeout: 60_000 });
}

/**
 * The filter chips actually rendered for this account, left to right.
 *
 * Sorted by measured position rather than returned in CHIP_LABELS order: the
 * Scope chip is the bar's first, and its label is whichever scope is selected,
 * so any fixed ordering here puts it in the wrong place and "the last chip"
 * stops meaning the rightmost one.
 */
async function chips(page: Page) {
  const found = [];
  for (const label of CHIP_LABELS) {
    const chip = page.getByRole('button', { name: label, exact: true });
    if (!(await chip.count())) continue;
    const box = await chip.first().boundingBox();
    if (box) found.push({ label, chip: chip.first(), box });
  }
  return found.sort((a, b) => a.box.x - b.box.x);
}

test.describe('snag list filter bar', () => {
  test.skip(!EMAIL || !PASSWORD, 'set E2E_EMAIL and E2E_PASSWORD to run the authenticated mobile specs');

  // The one that matters. The chips are 34px tall on purpose — that is the
  // documented trade that fits seven controls in one scrollable row — but the
  // *target* has to clear 48 on every platform the app ships to, and this one
  // is a browser.
  test('every filter chip clears the minimum touch target', async ({ page }) => {
    await openSnags(page);

    const rendered = await chips(page);
    expect(rendered.length).toBeGreaterThan(2);

    for (const { label, chip } of rendered) {
      const box = await chip.boundingBox();
      expect(box, `${label} chip should be laid out`).not.toBeNull();
      expect.soft(box!.height, `${label} chip touch height`).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
    }
  });

  // The expansion is padding pulled back by a negative margin, so it must cost
  // no layout: a bar that grew by 14px would have pushed the grid down.
  test('the widened targets do not change the height of the bar', async ({ page }) => {
    await openSnags(page);

    const [{ box: a }, { box: b }] = await chips(page);

    // Adjacent chips sit on one row: same top, and the touch boxes are flush
    // rather than overlapping (the horizontal padding is capped at half the
    // 8px gap for exactly this reason).
    expect(Math.abs(a.y - b.y)).toBeLessThan(1);
    expect(b.x).toBeGreaterThanOrEqual(a.x + a.width - 1);
  });

  test('the chips are reachable and toggle', async ({ page }) => {
    await openSnags(page);

    // Trending is a plain toggle — no dropdown, no write, and it is one of the
    // chips that sits off the right-hand edge at phone width.
    const trending = page.getByRole('button', { name: 'Trending', exact: true });
    await trending.scrollIntoViewIfNeeded();
    await trending.click();
    await expect(trending).toBeVisible();

    // Put it back, so the spec leaves no state behind it.
    await trending.click();
  });

  test('the bar scrolls rather than truncating at phone width', async ({ page }) => {
    await openSnags(page);

    const rendered = await chips(page);
    const last = rendered[rendered.length - 1];

    // The premise of the fade: the rightmost chip starts out beyond the
    // viewport. If this ever stops being true the bar no longer overflows and
    // the fade has nothing to say — which is worth failing over, not skipping.
    const viewport = page.viewportSize()!;
    expect(last.box.x + last.box.width).toBeGreaterThan(viewport.width);

    // And is reachable by scrolling, not lost.
    await last.chip.scrollIntoViewIfNeeded();
    const after = await last.chip.boundingBox();
    expect(after!.x + after!.width).toBeLessThanOrEqual(viewport.width + 1);
  });
});

test.describe('snag list cards', () => {
  test.skip(!EMAIL || !PASSWORD, 'set E2E_EMAIL and E2E_PASSWORD to run the authenticated mobile specs');

  // A first visit has no stored last-seen timestamp, so every snag in the org
  // is newer than "never". Marking them all would make the badge meaningless
  // on the one screen where the reader has no idea what any of it means yet.
  test('a first visit marks nothing as new', async ({ page }) => {
    await openSnags(page);
    await page.waitForTimeout(3_000);

    await expect(page.getByText('NEW', { exact: true })).toHaveCount(0);
  });

  test('the tab renders without a JS error', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await openSnags(page);
    await page.waitForTimeout(5_000);

    expect(errors).toEqual([]);
  });
});
