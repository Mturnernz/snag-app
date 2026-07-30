import { test, expect, type Locator, type Page } from '@playwright/test';

// ─── Tier 3: the write path ──────────────────────────────────────────────────
//
// Drives a serious incident from report through to resolved, asserting the gate
// blocks and then releases at each condition. This is the only tier that
// mutates, so it is fenced three ways:
//
//   1. Opt-in only. E2E_WRITE_PATH=1 must be set explicitly, so `npm test`
//      never writes even when credentials are present.
//   2. Org-checked at runtime. The spec reads the org the app says it is
//      reporting into and FAILS — loudly, before writing anything — if it is
//      not the expected one. A wrong E2E_EMAIL should not quietly file test
//      incidents into a customer's org.
//   3. Disposable org by design. `snags` rows cannot be deleted and retention
//      is enforced in the database, so every run leaves a permanent record.
//      That is fine in SNAG QA and nowhere else.
//
// It reports as the supervisor rather than handing off worker → supervisor:
// the subject here is the resolve gate, and a second account would add
// coordination without testing anything more.
const EMAIL = process.env.E2E_EMAIL;
const PASSWORD = process.env.E2E_PASSWORD;
const ENABLED = process.env.E2E_WRITE_PATH === '1';
const EXPECTED_ORG = process.env.E2E_WRITE_ORG ?? 'SNAG QA';

/** Ties the snag this run creates to this run, so a failure is traceable. */
const RUN_ID = `wp-${Date.now().toString(36)}`;
const DESCRIPTION =
  `Automated write-path check ${RUN_ID}. Pallet stack collapsed against the racking in bay 4.`;

// Each write goes through an RPC and a refetch, so the assertion after one has
// to outlast a round trip to Supabase rather than a re-render.
const SAVED = 45_000;

/**
 * Exact text that is actually on screen.
 *
 * Both navigators keep screens mounted after they've been visited — the stack
 * behind a pushed screen, and every tab once opened — so a bare getByText can
 * match a string on a hidden screen and then wait forever for it to appear.
 * Filtering to visible first makes .first()/.last() mean what they read like.
 */
function visible(page: Page, text: string): Locator {
  return page.getByText(text, { exact: true }).filter({ visible: true });
}

/**
 * Toggles a disclosure or StepCard by its header. Used to collapse a card once
 * its task is done — several card bodies carry text that also appears in the
 * Next-step card ("Capture evidence" is both a checklist row and a step
 * title), and leaving them open makes those locators ambiguous.
 */
async function toggle(page: Page, title: string) {
  const header = visible(page, title).first();
  await header.scrollIntoViewIfNeeded();
  await header.click();
  await page.waitForTimeout(600);
}

/**
 * Presses the button the Next-step card is currently offering, which opens the
 * card for that step. Driving the journey through the CTA rather than the
 * headers is deliberate: it asserts the card actually routes to the step it
 * names, which is the whole claim the restructure makes.
 */
async function followNextStep(page: Page, cta: string) {
  const button = visible(page, cta).first();
  await expect(button, `the Next-step card should offer "${cta}"`).toBeVisible();
  await button.click();
  await page.waitForTimeout(800);
}

/**
 * Clicks a panel's own button where the Next-step CTA carries the same label
 * ("Add a witness" and "Add evidence" are both). The Next-step card renders
 * above the investigation cards, so the panel's copy is the later one; the
 * sheet that would add a third match only mounts once this click lands.
 */
async function clickPanelButton(page: Page, label: string) {
  const button = visible(page, label).last();
  await expect(button).toBeVisible();
  await button.click();
  await page.waitForTimeout(800);
}

test.describe('write path: report → investigate → resolve', () => {
  test.skip(
    !ENABLED || !EMAIL || !PASSWORD,
    'set E2E_WRITE_PATH=1 plus E2E_EMAIL/E2E_PASSWORD to run the write-path spec'
  );

  // One journey, not several tests: every step depends on the one before it,
  // and splitting them would mean creating a fresh snag per assertion — in an
  // org where nothing can ever be deleted.
  test('a serious incident cannot be resolved until every gate condition is met', async ({ page }) => {
    test.setTimeout(15 * 60_000);

    // ── Sign in ──────────────────────────────────────────────────────────────
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(visible(page, 'Sign In').first()).toBeVisible({ timeout: 120_000 });
    await page.getByPlaceholder('Email').fill(EMAIL!);
    await page.getByPlaceholder('Password').fill(PASSWORD!);
    await visible(page, 'Sign In').first().click();
    await expect(visible(page, 'Report a Snag').first()).toBeVisible({ timeout: 90_000 });

    // ── Guard ────────────────────────────────────────────────────────────────
    // Before a single write, confirm which org this account reports into. The
    // Report tab states it outright, so there is no need to infer it.
    await expect(
      visible(page, EXPECTED_ORG).first(),
      `refusing to write: expected to be reporting into "${EXPECTED_ORG}". ` +
        'Set E2E_WRITE_ORG if the test org is named differently, but never point ' +
        'this spec at an org whose records anyone relies on.'
    ).toBeVisible({ timeout: 30_000 });

    // ── Report ───────────────────────────────────────────────────────────────
    await visible(page, 'Report a Serious Incident').first().click();
    await expect(page.getByText(/Use this for anything involving injury/)).toBeVisible({ timeout: 60_000 });

    await visible(page, 'Incident').first().click();
    await page.getByPlaceholder(/Describe what happened/).fill(DESCRIPTION);
    await visible(page, 'Injury').first().click();
    await visible(page, 'Next: Review').first().click();

    const submit = visible(page, 'Submit Incident Report').first();
    await expect(submit).toBeVisible({ timeout: 60_000 });
    await submit.click();

    // The success block names the reference, which is the cheapest reliable
    // handle on the row this run just created.
    await expect(visible(page, 'This has been logged').first()).toBeVisible({ timeout: SAVED });
    const logged = await page.getByText(/is now a formal record/).innerText();
    const reference = logged.match(/SNAG-\d+/)?.[0];
    expect(reference, `expected a snag reference in "${logged}"`).toBeTruthy();

    await visible(page, 'Done').first().click();

    // ── Open it ──────────────────────────────────────────────────────────────
    await visible(page, 'Snags').first().click();
    // By run id, not by reference: the list renders compact IssueCards, which
    // show the description and drop the reference. The reference is still
    // worth capturing above — it's what makes a failed run traceable in the
    // database afterwards.
    const row = page.getByText(new RegExp(RUN_ID)).filter({ visible: true }).first();
    await expect(row, 'the reported incident should appear in the list').toBeVisible({ timeout: 90_000 });
    await row.click();

    // ── Triage ───────────────────────────────────────────────────────────────
    // A serious snag arrives owned (apply_default_owner names the first serious
    // incident owner) but unallocated — no investigations row — so opening it as
    // a supervisor means answering the triage prompt before anything else. It is
    // not dismissible: that is the point of it.
    await expect(visible(page, 'Triage this incident').first()).toBeVisible({ timeout: 90_000 });
    await visible(page, "SNAG's guided investigation").first().click();
    await expect(
      page.getByText(/^Assigning to /),
      'the auto-assigned serious incident owner should be offered as the default lead'
    ).toBeVisible();
    // Deferred on purpose: this spec's subject is the resolve gate, and
    // answering the notifiable question here would take a condition off the
    // count before the walk below starts.
    await visible(page, "I'm not sure yet").first().click();
    await visible(page, 'Start the investigation').first().click();

    await expect(visible(page, 'Health & Safety Report').first()).toBeVisible({ timeout: SAVED });

    // A fresh serious snag is blocked on five conditions, and the notifiable
    // decision is named first — matching update_snag_status's own ordering.
    await expect(visible(page, 'Next step').first()).toBeVisible({ timeout: 60_000 });
    await expect(visible(page, 'Decide if this is notifiable').first()).toBeVisible();
    await expect(visible(page, 'Resolve — blocked, 5 steps remaining').first()).toBeVisible();

    // Manage must agree with the card rather than offering an action the
    // server would refuse — the two read from the same gate for this reason.
    await toggle(page, 'Manage');
    await expect(
      visible(page, 'Decide if this is a notifiable event').first(),
      'Manage should state the same blocking reason the Next-step card does'
    ).toBeVisible();
    await toggle(page, 'Manage');

    // ── 1. Notifiable ────────────────────────────────────────────────────────
    await followNextStep(page, 'Make the call');
    await visible(page, 'No').first().click();
    await expect(
      page.getByText(/— not notifiable\./),
      'answering the question should record the decision on the card'
    ).toBeVisible({ timeout: SAVED });
    await expect(
      visible(page, 'Decide if this is notifiable'),
      'and clear it from the gate'
    ).toHaveCount(0);
    await toggle(page, 'Notifiable Event');

    // ── 2. Checklist ─────────────────────────────────────────────────────────
    await expect(visible(page, 'Finish the first-response checklist').first()).toBeVisible();
    await followNextStep(page, 'Open the checklist');
    for (const step of [
      'Make the area safe',
      'Preserve the scene',
      'Capture evidence',
      'Identify witnesses',
      'Find the root cause',
    ]) {
      await visible(page, step).first().click();
      // Serial on purpose: ChecklistPanel refuses a second tap while one is in
      // flight, so clicking through without waiting silently drops steps.
      await page.waitForTimeout(2_500);
    }
    // Collapse first, then read the count: StepCard only renders its summary
    // while collapsed, which is exactly the state the progress list is read in.
    await toggle(page, 'Make safe & preserve scene');
    await expect(visible(page, '5 of 5 done').first()).toBeVisible({ timeout: SAVED });

    // ── 3. Witness ───────────────────────────────────────────────────────────
    await expect(visible(page, 'Add a witness statement').first()).toBeVisible();
    await followNextStep(page, 'Add a witness');
    await clickPanelButton(page, 'Add a witness');
    await expect(page.getByText(/in their own words/)).toBeVisible();
    await page.getByPlaceholder('Their name').fill('Priya Raman');
    await page.getByPlaceholder(/Heard the reverse alarm/).fill(
      'Saw the top three pallets shift as the racking flexed, called the stop.'
    );
    await visible(page, 'Save statement').first().click();
    await expect(visible(page, 'Priya Raman').first()).toBeVisible({ timeout: SAVED });
    await toggle(page, 'Witnesses');

    // ── 4. Evidence ──────────────────────────────────────────────────────────
    // Caption only: the picker needs expo-image-picker, which has no web
    // implementation, and add_evidence_item accepts an empty media path.
    await expect(visible(page, 'Capture evidence').first()).toBeVisible();
    await followNextStep(page, 'Add evidence');
    await clickPanelButton(page, 'Add evidence');
    await expect(page.getByText(/Photos carry more than a description/)).toBeVisible();
    const caption = 'Racking upright bent at the base, bay 4.';
    await page.getByPlaceholder(/Walkway markings worn away/).fill(caption);
    await visible(page, 'Save evidence').first().click();
    await expect(visible(page, caption).first()).toBeVisible({ timeout: SAVED });
    await toggle(page, 'Evidence');

    // ── 5. Root cause ────────────────────────────────────────────────────────
    await expect(visible(page, 'Record the root cause').first()).toBeVisible();
    await followNextStep(page, 'Record root cause');
    await page.getByPlaceholder(/No physical separation/).fill(
      'Racking had not been re-rated after the heavier stock line was introduced.'
    );
    await visible(page, 'Save root cause').first().click();

    // ── Gate released ────────────────────────────────────────────────────────
    // No corrective actions were created, so none are open and the last
    // condition is already satisfied: the card should flip from a blocked
    // count to the real Resolve action.
    await expect(
      visible(page, 'Ready to resolve').first(),
      'with every condition met the gate should open'
    ).toBeVisible({ timeout: SAVED });
    await expect(page.getByText(/Resolve — blocked/).filter({ visible: true })).toHaveCount(0);
    await toggle(page, 'Root cause');

    // ── Resolve ──────────────────────────────────────────────────────────────
    // The card's button opens Manage, where Resolve itself lives — one place
    // for the terminal action rather than two.
    await visible(page, 'Resolve this snag').first().click();
    await visible(page, 'Resolve Snag').first().click();
    await expect(visible(page, 'Resolve snag').first()).toBeVisible({ timeout: 30_000 });
    await visible(page, 'Resolve').first().click();

    await expect(
      visible(page, 'Resolved').first(),
      'the snag should end up resolved'
    ).toBeVisible({ timeout: SAVED });
  });
});
