import { test, expect, type Page } from '@playwright/test';

// Coverage for the serious-incident detail screen — the guided investigation,
// and the densest screen in the app. Read-only: it opens cards and sheets and
// asserts on what's rendered, but saves nothing, so it's safe against an org
// with real records in it.
//
// Needs a supervisor or officer_admin account, plus a serious snag visible to
// it (see TESTING.md — supabase/seed/qa-accounts.sql sets up the org):
//   E2E_EMAIL / E2E_PASSWORD
const EMAIL = process.env.E2E_EMAIL;
const PASSWORD = process.env.E2E_PASSWORD;

async function openFirstSeriousSnag(page: Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Sign In', { exact: true })).toBeVisible({ timeout: 120_000 });
  await page.getByPlaceholder('Email').fill(EMAIL!);
  await page.getByPlaceholder('Password').fill(PASSWORD!);
  await page.getByText('Sign In', { exact: true }).click();

  await page.getByText('Snags', { exact: true }).first().click();

  // Exact match on the category badge, not a loose regex: the Report tab keeps
  // "Report a Serious Incident" mounted but hidden, and a substring match finds
  // that first and then waits forever for it to become visible.
  const badge = page
    .getByText('Incident', { exact: true })
    .or(page.getByText('Hazard', { exact: true }))
    .first();
  await expect(badge, 'the account needs a serious snag it can see').toBeVisible({ timeout: 90_000 });
  await badge.click();

  // The H&S header is the marker that this is the serious lane; a niggle shows
  // "Snag Details" instead and has none of the investigation cards.
  await expect(page.getByText('Health & Safety Report')).toBeVisible({ timeout: 90_000 });
}

test.describe('serious incident detail', () => {
  test.skip(!EMAIL || !PASSWORD, 'set E2E_EMAIL and E2E_PASSWORD to run the incident specs');

  test('the next step is stated above the fold', async ({ page }) => {
    await openFirstSeriousSnag(page);

    // The whole point of the restructure: something actionable is visible
    // without scrolling. Assert on position, not just presence — presence was
    // true before too, 932px down.
    const next = page.getByText('Next step', { exact: true });
    await expect(next).toBeVisible();

    const box = await next.boundingBox();
    const viewport = page.viewportSize();
    expect(box, 'Next step card should be laid out').not.toBeNull();
    expect(
      box!.y,
      'the next step must be above the fold, not below it'
    ).toBeLessThan(viewport!.height);
  });

  test('no empty photo placeholder is rendered', async ({ page }) => {
    await openFirstSeriousSnag(page);

    // The old 200px camera-icon block. Its absence is what buys the space for
    // the next-step card, so it's worth a guard.
    await expect(page.getByText(/Add up to 5 photos/)).toBeHidden();
  });

  test('Resolve is stated as blocked rather than offered', async ({ page }) => {
    await openFirstSeriousSnag(page);

    // Either it's blocked with a count, or the gate is clear and it offers the
    // real action — both are correct, but it must never be a live Resolve
    // button while conditions are outstanding.
    const blocked = page.getByText(/Resolve — blocked, \d+ steps? remaining/);
    const ready = page.getByText('Ready to resolve');
    await expect(blocked.or(ready).first()).toBeVisible();
  });

  test('each investigation card reports its own state while collapsed', async ({ page }) => {
    await openFirstSeriousSnag(page);

    // This is what replaced the horizontal progress strip. A card with no
    // summary is the failure mode — it happened for real, because StepCard
    // only mounts children while expanded.
    for (const title of ['Make safe & preserve scene', 'Witnesses', 'Evidence', 'Root cause']) {
      await expect(page.getByText(title, { exact: true }).first()).toBeVisible();
    }

    const body = await page.locator('body').innerText();
    expect(body, 'checklist card should show its count').toMatch(/\d of 5 done/);
    expect(body, 'evidence card should say where it stands').toMatch(/None captured|\d item/);
    expect(body, 'root cause card should say where it stands').toMatch(/Recorded|Not recorded/);
  });

  test('adding evidence opens a sheet with a usable caption field', async ({ page }) => {
    await openFirstSeriousSnag(page);

    await page.getByText('Evidence', { exact: true }).first().click();

    // .last(), not .first(): when the gate's outstanding condition happens to
    // be evidence, the Next-step card offers an "Add evidence" CTA too, and it
    // renders above the card. That CTA only opens the card — clicking it here
    // left the sheet closed and the failure looked like a missing sheet rather
    // than a mis-aimed click. The panel's own button is always the later one.
    await page.getByText('Add evidence', { exact: true }).last().click();

    // The sheet must show both fields at once — the whole reason capture moved
    // out of the inline stack. The caption input was stranded below the fold
    // on the first build of this, so assert the field itself, not the label.
    await expect(page.getByText(/Photos carry more than a description/)).toBeVisible();
    const caption = page.getByPlaceholder(/Walkway markings worn away/);
    await expect(caption).toBeVisible();
    await expect(page.getByText('Save evidence')).toBeVisible();

    // And it must be reachable, not just painted.
    await caption.fill('test caption, not saved');
    await expect(caption).toHaveValue('test caption, not saved');
  });

  test('the WorkSafe criteria stay behind a disclosure', async ({ page }) => {
    await openFirstSeriousSnag(page);

    await page.getByText('Notifiable Event', { exact: true }).first().click();

    // The criteria only exist on the undecided branch — once answered the card
    // shows the decision instead. Skip rather than fail on a snag that has
    // already been decided, so this spec doesn't depend on the order other
    // specs (or a person) happened to touch the test data in.
    const question = page.getByText('Does this need reporting to WorkSafe?');
    if (!(await question.isVisible().catch(() => false))) {
      test.info().annotations.push({
        type: 'note',
        description: 'notifiable already decided on this snag — disclosure not applicable',
      });
      return;
    }

    // ~450px of statute that used to be expanded by default.
    await expect(page.getByText(/hospital admission as an inpatient/)).toBeHidden();

    await page.getByText('What counts as notifiable?').click();
    await expect(page.getByText(/hospital admission as an inpatient/)).toBeVisible();
  });

  test('the comment composer starts collapsed', async ({ page }) => {
    await openFirstSeriousSnag(page);

    // Fixed chrome, so its height costs viewport on every screen of scroll.
    await expect(page.getByText('Add a comment', { exact: true })).toBeVisible();
    await expect(page.getByPlaceholder(/type @ to mention/)).toBeHidden();

    await page.getByText('Add a comment', { exact: true }).click();
    await expect(page.getByPlaceholder(/type @ to mention/)).toBeVisible();
  });
});
