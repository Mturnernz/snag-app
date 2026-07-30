import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SUPERVISOR_STATE } from './auth-state';

// Document mode: an organisation running its own investigation process.
//
// The fork is a *substitution*, not a shortcut — the notifiable decision, the
// checklist, a witness statement and evidence are all still required, and in
// their place at the end sit two new conditions: a document is attached, and a
// supervisor accepts it. Not necessarily a *different* supervisor: that rule was
// reverted in 20260729000200 because it deadlocked a one-supervisor org, so the
// page names who attached and who accepted rather than preventing them from
// being the same person.
//
// The gate arithmetic is covered by unit tests against the shared function and
// the rules are enforced in SQL. What only a browser can tell you is whether
// the page puts the right control in front of the right person.
//
// Writes, so it's opt-in, and it runs against a live org. Snags can't be
// deleted (5-year retention), so it uses a snag the QA org already has and
// removes only the document it filed.
const ENABLED = process.env.E2E_WRITE_PATH === '1';

// The QA org's spare serious snag. Flagged, unresolved, no real content.
const SNAG_ID = process.env.E2E_SERIOUS_SNAG_ID ?? '4687e567-9b2c-4ade-9700-00e98356836f';

/**
 * Put the snag on `mode`, via whichever surface it currently offers.
 *
 * An unallocated serious snag opens onto the triage prompt — a modal that has
 * to be answered, so Manage is unreachable until it is. Once allocated the
 * prompt is gone and Manage is the re-decide path. Both write the same three
 * RPCs, and this spec runs repeatedly against a snag whose state it leaves
 * behind, so it has to cope with either.
 */
async function allocateWithMode(page: Page, mode: 'snag' | 'document') {
  await page.goto(`/snags/${SNAG_ID}?step=manage`);

  const triage = page.getByRole('heading', { name: 'Triage this incident' });
  if (await triage.isVisible().catch(() => false)) {
    await page.locator(`input[name="modeChoice"][value="${mode}"]`).check();
    await page.locator('input[name="investigatorChoice"]').first().check();
    // Not "yes"/"no": this spec asserts on the gate's remaining count, and
    // answering the notifiable question here would change it.
    await page.locator('input[name="notifiableChoice"][value="later"]').check();
    await page.getByRole('button', { name: 'Start the investigation' }).click();
    await page.waitForURL(`**/snags/${SNAG_ID}**`);
    return;
  }

  await page.locator(`input[name="mode"][value="${mode}"]`).check();
  await page.getByRole('button', { name: 'Save allocation' }).click();
  await page.waitForURL(`**/snags/${SNAG_ID}`);
}

test.describe('investigation document mode', () => {
  test.skip(
    !ENABLED || !process.env.E2E_EMAIL || !process.env.E2E_PASSWORD,
    'set E2E_WRITE_PATH=1 plus E2E_EMAIL/E2E_PASSWORD to run the document-mode journey'
  );
  test.use({ storageState: SUPERVISOR_STATE });
  test.describe.configure({ timeout: 180_000 });

  test("choosing the org's own process swaps the last two gate conditions", async ({ page }) => {
    const title = `E2E investigation ${Date.now()}`;
    const file = path.join(os.tmpdir(), `snag-inv-${Date.now()}.txt`);
    fs.writeFileSync(file, "Investigation report produced under the org's own process.\n");

    try {
      // ── Allocate, and choose the mode while doing it ──────────────────────
      // The mode is asked at allocation time rather than behind a button of its
      // own: allocating is when someone is already deciding who deals with
      // this, and asking in two places is how a snag gets an owner and no
      // investigator.
      await allocateWithMode(page, 'document');
      await page.goto(`/snags/${SNAG_ID}`);

      // ── The guided steps are gone; the document step has taken their place ─
      await expect(
        page.locator('#investigationDocument'),
        'document mode should show the document step'
      ).toBeVisible();
      await expect(
        page.locator('#rootCause'),
        'and should not still be asking for a root cause'
      ).toHaveCount(0);
      await expect(page.locator('#correctiveActions')).toHaveCount(0);

      // The steps before the fork are untouched — that's what makes this a
      // substitution rather than a way out of the investigation.
      await expect(page.locator('#notifiable')).toBeVisible();
      await expect(page.locator('#checklist')).toBeVisible();
      await expect(page.locator('#witnesses')).toBeVisible();
      await expect(page.locator('#evidence')).toBeVisible();

      // ── Upload and attach ────────────────────────────────────────────────
      await page.goto(`/snags/${SNAG_ID}?step=investigationDocument`);
      await page.locator('#documentFile').setInputFiles(file);
      await page.locator('#documentTitle').fill(title);
      await page.getByRole('button', { name: /upload and attach|replace with a new upload/i }).click();

      await expect(
        page.locator('[data-investigation-document]'),
        'the attached document should be listed'
      ).toContainText(title, { timeout: 60_000 });

      // ── Attaching is still not accepting ─────────────────────────────────
      // The gate wants a supervisor to have read it and said so. It need not be
      // a *different* supervisor — a site lead allocates the investigation to a
      // crew, so the two are usually different people anyway, and forcing it
      // deadlocked the one-supervisor org. What the page must do instead is
      // name both, so a self-signed investigation is visible in the record.
      await expect(
        page.getByRole('button', { name: /accept this document/i }),
        'a supervisor can sign off their own work'
      ).toBeVisible();
      await expect(page.locator('main')).toContainText(/attached by .+ · not yet accepted/i);

      // ── And the gate counts acceptance among what's outstanding ───────────
      // Not *names* it: the Next-step card names the first unmet condition, and
      // on this snag that's still the notifiable decision. What acceptance
      // changes is the count — the document is attached, so five of the six
      // conditions remain, and none of them is a root cause.
      await page.goto(`/snags/${SNAG_ID}`);
      await expect(page.locator('main')).toContainText('5 steps remaining');
      await expect(page.locator('#investigationDocument')).toContainText(/awaiting sign-off/i);
      await expect(
        page.locator('main'),
        'the guided process should not be mentioned at all in document mode'
      ).not.toContainText(/record the root cause/i);

      // ── Signing it off closes that condition and names who did ────────────
      await page.goto(`/snags/${SNAG_ID}?step=investigationDocument`);
      await page.getByRole('button', { name: /accept this document/i }).click();
      await expect(page.locator('#investigationDocument')).toContainText(/accepted by /i, { timeout: 60_000 });
      await expect(page.locator('main')).toContainText('4 steps remaining');
    } finally {
      // Leave the snag on the guided path and take the probe document with us.
      await allocateWithMode(page, 'snag').catch(() => {});
      await page.goto('/documents');
      const del = page.getByRole('button', { name: `Delete ${title}` });
      if (await del.count()) await del.click();
      fs.rmSync(file, { force: true });
    }
  });
});
