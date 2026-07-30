import { test, expect, type Page } from '@playwright/test';

// Deep links: /snags/:id, and ?step= opening one section of it.
//
// The app shipped with no linking config at all, so every URL resolved to the
// default screen and the path was silently discarded — which mattered because
// supabase/functions/notify-snag has always mailed people `/snags/<id>` links.
// They returned 200 (the web build is `output: "single"`, so every path serves
// the app shell) and then dropped the reader on the Report tab.
//
// Read-only: opening a snag and expanding a card writes nothing.
const EMAIL = process.env.E2E_EMAIL;
const PASSWORD = process.env.E2E_PASSWORD;

async function signIn(page: Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Sign In', { exact: true })).toBeVisible({ timeout: 120_000 });
  await page.getByPlaceholder('Email').fill(EMAIL!);
  await page.getByPlaceholder('Password').fill(PASSWORD!);
  await page.getByText('Sign In', { exact: true }).click();
  await expect(page.getByText('Report a Snag', { exact: true }).first()).toBeVisible({ timeout: 90_000 });
}

/** The id of the first serious snag this account can see, via the UI. */
async function firstSeriousSnagId(page: Page): Promise<string | null> {
  await page.getByText('Snags', { exact: true }).first().click();
  const badge = page
    .getByText('Incident', { exact: true })
    .or(page.getByText('Hazard', { exact: true }))
    .first();
  await expect(badge, 'the account needs a serious snag it can see').toBeVisible({ timeout: 90_000 });
  await badge.click();

  // An untriaged serious snag opens onto the triage prompt, which is not
  // dismissible — answering it is a write and this tier writes nothing.
  const triage = page.getByText('Triage this incident', { exact: true });
  if (await triage.isVisible({ timeout: 30_000 }).catch(() => false)) {
    test.skip(true, 'the first serious snag is untriaged — allocate it, or point E2E_EMAIL at an org whose serious snags are');
  }

  await expect(page.getByText('Health & Safety Report')).toBeVisible({ timeout: 90_000 });

  // Now that a snag is open, the URL is the thing under test in reverse: the
  // linking config has to *write* /snags/<id> as well as read it.
  const match = page.url().match(/\/snags\/([0-9a-f-]{36})/);
  return match?.[1] ?? null;
}

test.describe('deep links', () => {
  test.skip(!EMAIL || !PASSWORD, 'set E2E_EMAIL and E2E_PASSWORD to run the deep-link specs');

  test('opening a snag puts it in the URL', async ({ page }) => {
    await signIn(page);
    const id = await firstSeriousSnagId(page);
    expect(id, 'navigating to a snag should be reflected in the address bar').toBeTruthy();
  });

  test('/snags/:id opens that snag directly', async ({ page }) => {
    await signIn(page);
    const id = await firstSeriousSnagId(page);
    test.skip(!id, 'no serious snag available');

    // A fresh load of the bare URL, not an in-app navigation — this is what a
    // link in an email actually does.
    await page.goto(`/snags/${id}`, { waitUntil: 'domcontentloaded' });
    await expect(
      page.getByText('Health & Safety Report'),
      'the link should land on the snag, not on the Report tab'
    ).toBeVisible({ timeout: 90_000 });
  });

  test('?step= opens that section rather than leaving it collapsed', async ({ page }) => {
    await signIn(page);
    const id = await firstSeriousSnagId(page);
    test.skip(!id, 'no serious snag available');

    // Evidence rather than the RCA, because every serious snag has an evidence
    // card while the analysis only exists once the snag is resolved. The
    // mechanism is the same one `openStep` drives for every key.
    await page.goto(`/snags/${id}?step=evidence`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Health & Safety Report')).toBeVisible({ timeout: 90_000 });

    // Expanded, not merely present. StepCard doesn't mount its children while
    // collapsed, so the panel's own copy is the proof — and every section
    // starts closed since the Stage 2 restructure, which is exactly why a link
    // that only got you to the snag left an assignee hunting.
    await expect(
      page.getByText(/Nothing captured yet/),
      'the evidence card should be open, showing the panel and not just its header'
    ).toBeVisible({ timeout: 30_000 });

    // And the rest must still be closed, or this would pass on a page that
    // simply expanded everything. A visible summary means a collapsed card.
    await expect(
      page.getByText('Not recorded', { exact: true }).first(),
      'other sections should still be showing their collapsed summary'
    ).toBeVisible();
  });

  test('?step=rca opens the analysis when the snag has one', async ({ page }) => {
    await signIn(page);
    const id = await firstSeriousSnagId(page);
    test.skip(!id, 'no serious snag available');

    await page.goto(`/snags/${id}?step=rca`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Health & Safety Report')).toBeVisible({ timeout: 90_000 });

    // The card only exists once the snag is resolved or has an RCA out, and a
    // read-only spec doesn't get to choose which snag is first in the list.
    const card = page.getByText('5 Whys analysis', { exact: true });
    if (!(await card.isVisible().catch(() => false))) {
      test.info().annotations.push({
        type: 'note',
        description: 'first serious snag is not resolved — no analysis card to open',
      });
      // The link must still be harmless: an unopenable step is not an error.
      await expect(page.getByText('Root cause', { exact: true }).first()).toBeVisible();
      return;
    }

    // RcaPanel's body only mounts while expanded.
    const body = await page.locator('body').innerText();
    expect(body, 'the analysis card should be open').toMatch(/Waived|Assign|Why \d|Submit|Send back|With /i);
  });

  test('an unknown step is ignored rather than breaking the screen', async ({ page }) => {
    await signIn(page);
    const id = await firstSeriousSnagId(page);
    test.skip(!id, 'no serious snag available');

    // On web this comes straight off a URL anyone can type.
    await page.goto(`/snags/${id}?step=not-a-real-step`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Health & Safety Report')).toBeVisible({ timeout: 90_000 });
    await expect(page.getByText('Root cause', { exact: true }).first()).toBeVisible();
  });
});
