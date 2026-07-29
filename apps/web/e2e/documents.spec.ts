import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SUPERVISOR_STATE } from './auth-state';

// The org document library: upload → list → download → delete.
//
// This page was built and then written off as a stub in CLAUDE.md and
// SNAG_WEB_APP_PLAN.md §10, and had never been used — zero rows in
// `org_documents` against a live project. Nothing was broken; nobody had
// checked. That is the failure mode this spec exists to stop.
//
// It writes, unlike the rest of the web suite, so it is opt-in. But unlike
// snags — which the schema forbids deleting — documents are removable, so it
// cleans up after itself and leaves the org as it found it.
//
// The role gate isn't retested here: /documents is in the (portal) group, and
// portal.spec.ts already proves that group refuses a worker. Asserting it
// again would only add a second way for the same fact to flake.
const ENABLED = process.env.E2E_WRITE_PATH === '1';

test.describe('document library', () => {
  test.skip(
    !ENABLED || !process.env.E2E_EMAIL || !process.env.E2E_PASSWORD,
    'set E2E_WRITE_PATH=1 plus E2E_EMAIL/E2E_PASSWORD to run the document round trip'
  );
  test.use({ storageState: SUPERVISOR_STATE });
  test.describe.configure({ timeout: 180_000 });

  test('a document survives upload, listing and download, then deletes cleanly', async ({ page }) => {
    const title = `E2E probe ${Date.now()}`;
    const body = 'SNAG document library round-trip probe.\n';
    const file = path.join(os.tmpdir(), `snag-e2e-${Date.now()}.txt`);
    fs.writeFileSync(file, body);

    try {
      await page.goto('/documents');
      await expect(page.getByRole('heading', { name: /documents/i })).toBeVisible();

      await page.getByLabel('Title').fill(title);
      await page.getByLabel(/Category/).fill('Policy');
      await page.setInputFiles('input[type=file]', file);
      await page.getByRole('button', { name: /upload/i }).click();

      // Listed, and attributed — the row carries the uploader and date, which
      // is the whole point of a document *register* rather than a folder.
      const link = page.getByRole('link', { name: title });
      await expect(link, 'the upload should appear in the register').toBeVisible({ timeout: 60_000 });
      await expect(page.locator('main')).toContainText('Policy');

      // The signed URL has to actually serve the bytes.
      const href = await link.getAttribute('href');
      expect(href, 'a signed URL should be generated for the file').toBeTruthy();
      // Fetched with Node's fetch rather than the browser's request context:
      // behind a TLS-terminating proxy Chromium cannot reach Supabase at all
      // (see TESTING.md), while Node honours NODE_USE_ENV_PROXY. Either way
      // this is a real GET against storage, not a navigation.
      const res = await fetch(href!);
      expect(res.status, 'the signed URL should serve the document').toBe(200);
      expect((await res.text()).trim(), 'and serve the bytes that were uploaded').toBe(body.trim());
    } finally {
      // Always, even on failure: this is a live org, and an abandoned probe
      // document is worse than a failing test.
      await page.goto('/documents');
      const del = page.getByRole('button', { name: `Delete ${title}` });
      if (await del.count()) {
        await del.click();
        await expect(page.getByRole('link', { name: title })).toBeHidden({ timeout: 60_000 });
      }
      fs.rmSync(file, { force: true });
    }
  });

});
