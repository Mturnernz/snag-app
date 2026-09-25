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
  await page.getByLabel('Email', { exact: true }).fill(EMAIL!);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD!);
  // The bar renders before the place it files under has loaded, and a send in
  // that gap is refused as "No place yet". The rooms are read only once a place
  // is chosen, so their arrival is the signal that capture can file.
  const placeChosen = page.waitForResponse(
    (res) => res.url().includes('/rest/v1/locations') && res.ok(),
    { timeout: 90_000 }
  );
  await page.getByText('Sign in', { exact: true }).click();
  // The list is the initial route — there is no Add tab; capture is the bar at
  // the foot of this screen.
  await expect(page.getByPlaceholder('Capture new issue')).toBeVisible({ timeout: 90_000 });
  await placeChosen;
}

test('a save that never comes back still stops spinning and says so', async ({ page }) => {
  await signIn(page);

  // Accept the write and never answer it — a dead connection, not a refused
  // one. A refusal the app handles fine; silence is what wedged it.
  await page.route('**/rest/v1/rpc/create_snag', () => {
    /* deliberately never fulfilled */
  });

  // `showAlert` is a `window.alert` on web (react-native-web's Alert is a no-op
  // stub — see src/lib/alert.ts), so the failure arrives as a dialog rather
  // than as text on the page. Playwright dismisses dialogs automatically, so
  // the message has to be captured on the way past.
  const dialogs: string[] = [];
  page.on('dialog', (dialog) => {
    dialogs.push(dialog.message());
    dialog.dismiss().catch(() => {});
  });

  await page.getByPlaceholder('Capture new issue').fill('Stalled network probe');
  await page.getByLabel('Add to the list').click();

  // The deadline is 20s for a data call; allow for it plus the dialog.
  await expect.poll(() => dialogs.join('\n'), { timeout: 40_000 }).toMatch(/couldn't add/i);

  // And the bar is usable again rather than stuck mid-send, with the words put
  // back so nobody has to retype them.
  await expect(page.getByPlaceholder('Capture new issue')).toBeEnabled();
  await expect(page.getByPlaceholder('Capture new issue')).toHaveValue('Stalled network probe');
});
