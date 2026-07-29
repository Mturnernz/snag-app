import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SUPERVISOR_STATE } from './auth-state';

// Document mode: an organisation running its own investigation process.
//
// The fork is a *substitution*, not a shortcut — the notifiable decision, the
// checklist, a witness statement and evidence are all still required, and in
// their place at the end sit two new conditions: a document is attached, and
// somebody other than the person who attached it accepts it.
//
// The gate arithmetic is covered by unit tests against the shared function and
// the rules are enforced in SQL. What only a browser can tell you is whether
// the page puts the right control in front of the right person — and whether it
// refuses to put the Accept button in front of the one person who can never
// use it.
//
// Writes, so it's opt-in, and it runs against a live org. Snags can't be
// deleted (5-year retention), so it uses a snag the QA org already has and
// removes only the document it filed.
const ENABLED = process.env.E2E_WRITE_PATH === '1';

// The QA org's spare serious snag. Flagged, unresolved, no real content.
const SNAG_ID = process.env.E2E_SERIOUS_SNAG_ID ?? '4687e567-9b2c-4ade-9700-00e98356836f';

async function allocateWithMode(page: Page, mode: 'snag' | 'document') {
  await page.goto(`/snags/${SNAG_ID}?step=manage`);
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
      // The prompt lives in the allocate flow rather than behind its own
      // button: allocating is when someone is already deciding who deals with
      // this, and asking in two places is how a snag gets an owner and no
      // investigator.
      const owner = page.locator('#ownerId');
      await page.goto(`/snags/${SNAG_ID}?step=manage`);
      await owner.selectOption({ index: 1 });
      await page.locator('input[name="mode"][value="document"]').check();
      await page.getByRole('button', { name: 'Save allocation' }).click();
      await page.waitForURL(`**/snags/${SNAG_ID}`);

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

      // ── The one thing the attacher cannot do ─────────────────────────────
      // accept_investigation_document refuses whoever attached it, so the page
      // has to say so rather than offer a button that can only fail.
      await expect(
        page.getByRole('button', { name: /accept this document/i }),
        'the attacher should not be offered the Accept button'
      ).toHaveCount(0);
      await expect(page.locator('main')).toContainText(/another supervisor has to sign it off/i);

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
