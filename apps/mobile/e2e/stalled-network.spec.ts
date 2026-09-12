import { test, expect, type Page } from '@playwright/test';

// A stalled request must not wedge the app.
//
// This is the regression test for a bug that reached production and was
// invisible from every angle. Phone connections don't fail cleanly — a request
// goes out and is simply never answered. supabase-js puts no timeout on its own
// fetch, and it resolves an access token before *every* request, so a stalled
// `/auth/v1/token` refresh left `getSession()` pending forever. After that no
// call was ever issued at all: nothing reached the server, so there was nothing
// in the logs; nothing rejected, so no error was shown; the already-loaded
// screen carried on rendering. The only symptom was a Save button that spun
// forever.
//
// The fix is a deadline on every request (`fetchWithTimeout` in lib/supabase.ts)
// plus try/finally around the saves, so the spinner always stops and the user is
// always told something. This spec pins both halves by doing what a bad
// connection does: accepting the request and never answering it.
//
// The flow it exercises moved with the pivot — it used to stall a witness
// statement, and now stalls capture — but the failure mode and the guarantee
// are unchanged: a save that cannot complete must end, visibly.
const EMAIL = process.env.E2E_EMAIL;
const PASSWORD = process.env.E2E_PASSWORD;

test.skip(!EMAIL || !PASSWORD, 'Set E2E_EMAIL and E2E_PASSWORD to run the authenticated specs.');

async function signIn(page: Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Sign in', { exact: true })).toBeVisible({ timeout: 120_000 });
  await page.getByPlaceholder('Email').fill(EMAIL!);
  await page.getByPlaceholder('Password').fill(PASSWORD!);
  await page.getByText('Sign in', { exact: true }).click();
  // Capture is the initial route.
  await expect(page.getByText('What needs doing?')).toBeVisible({ timeout: 90_000 });
}

test('a save that never comes back still stops spinning and says so', async ({ page }) => {
  await signIn(page);

  // Accept the write and never answer it — a dead connection, not a refused
  // one. A refusal the app handles fine; silence is what wedged it.
  await page.route('**/rest/v1/rpc/create_snag', () => {
    /* deliberately never fulfilled */
  });

  await page.getByPlaceholder('Toilet seat is broken').fill('Stalled network probe');
  await page.getByText('Add to the list', { exact: true }).click();

  // The deadline is 20s for a data call; allow for it plus the dialog.
  await expect(page.getByText(/couldn't save/i)).toBeVisible({ timeout: 40_000 });

  // And the form is usable again rather than stuck mid-submit.
  await expect(page.getByPlaceholder('Toilet seat is broken')).toBeEnabled();
});
