import { test, expect, type Page } from '@playwright/test';

// The document library on the phone, and the investigation-mode prompt that
// sends people to it.
//
// Read-only, like incident.spec.ts: it opens screens and asserts on what's
// rendered, and saves nothing. The half that can't be covered here is picking a
// file — expo-document-picker has no meaningful web implementation, so the
// upload path still needs a device (see TESTING.md). What this does cover is
// everything around it: that a worker can reach the register at all, that the
// listing renders, and that allocating a serious snag asks how it will be
// investigated.
const EMAIL = process.env.E2E_EMAIL;
const PASSWORD = process.env.E2E_PASSWORD;
const WORKER_EMAIL = process.env.E2E_WORKER_EMAIL;
const WORKER_PASSWORD = process.env.E2E_WORKER_PASSWORD;

async function signIn(page: Page, email: string, password: string) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Sign In', { exact: true })).toBeVisible({ timeout: 120_000 });
  await page.getByPlaceholder('Email').fill(email);
  await page.getByPlaceholder('Password').fill(password);
  await page.getByText('Sign In', { exact: true }).click();
}

async function openDocuments(page: Page) {
  await page.getByText('Profile', { exact: true }).first().click();
  await page.getByText('Documents', { exact: true }).first().click();
  await expect(page.getByText('Add a document', { exact: true })).toBeVisible({ timeout: 90_000 });
}

test.describe('document library', () => {
  test.skip(
    !WORKER_EMAIL || !WORKER_PASSWORD,
    'set E2E_WORKER_EMAIL and E2E_WORKER_PASSWORD to run the document-library specs'
  );

  test('a worker can reach the register and add to it', async ({ page }) => {
    // The reason this screen exists. The library was portal-only, and the
    // portal refuses workers outright — so the policies and procedures workers
    // are expected to follow lived somewhere they could not look.
    await signIn(page, WORKER_EMAIL!, WORKER_PASSWORD!);
    await openDocuments(page);

    await expect(
      page.getByText('Choose a file', { exact: true }),
      'a library nobody can contribute to is a filing cabinet with one key'
    ).toBeVisible();
  });

  test('the register lists what is in it, or says that it is empty', async ({ page }) => {
    await signIn(page, WORKER_EMAIL!, WORKER_PASSWORD!);
    await openDocuments(page);

    // Either state is correct; a blank screen with neither is not.
    const listed = page.getByLabel(/^Open /).first();
    const empty = page.getByText('No documents yet', { exact: true });
    await expect(listed.or(empty)).toBeVisible({ timeout: 90_000 });
  });
});

test.describe('investigation mode', () => {
  test.skip(!EMAIL || !PASSWORD, 'set E2E_EMAIL and E2E_PASSWORD to run the investigation-mode specs');

  test('allocating a serious snag asks how it will be investigated', async ({ page }) => {
    // The prompt lives in the allocate flow rather than behind its own button:
    // allocating is when a supervisor is already deciding who deals with this,
    // and asking in two places is how a snag gets an owner and no investigator.
    await signIn(page, EMAIL!, PASSWORD!);
    await page.getByText('Snags', { exact: true }).first().click();

    const badge = page
      .getByText('Incident', { exact: true })
      .or(page.getByText('Hazard', { exact: true }))
      .first();
    await expect(badge, 'the account needs a serious snag it can see').toBeVisible({ timeout: 90_000 });
    await badge.click();
    await expect(page.getByText('Health & Safety Report')).toBeVisible({ timeout: 90_000 });

    // Manage is a disclosure — settings shouldn't sit between the reader and
    // the work.
    await page.getByText('Manage', { exact: true }).first().click();
    await expect(page.getByText('MANAGE ISSUE', { exact: true })).toBeVisible({ timeout: 90_000 });
    // The row's value chip is the control, not its label — same shape as the
    // Type/Severity/Owner rows above it.
    await expect(page.getByText('Investigation', { exact: true })).toBeVisible();
    await page.getByText('SNAG guided', { exact: true }).click();

    // Each option states its consequence — picking the second changes what
    // closes the snag, which a bare label can't convey.
    await expect(page.getByText("SNAG's guided investigation", { exact: true })).toBeVisible();
    await expect(page.getByText('Our own process', { exact: true })).toBeVisible();
    await expect(page.getByText(/A second supervisor has to accept it/)).toBeVisible();
  });
});
