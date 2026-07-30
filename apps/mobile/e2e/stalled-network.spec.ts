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
const EMAIL = process.env.E2E_EMAIL;
const PASSWORD = process.env.E2E_PASSWORD;

async function openWitnessSheet(page: Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Sign In', { exact: true })).toBeVisible({ timeout: 120_000 });
  await page.getByPlaceholder('Email').fill(EMAIL!);
  await page.getByPlaceholder('Password').fill(PASSWORD!);
  await page.getByText('Sign In', { exact: true }).click();

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

  await page.getByText('Witnesses', { exact: true }).first().click();
  await page.getByText('Add a witness', { exact: true }).last().click();
  await expect(page.getByText('Who saw it?', { exact: true })).toBeVisible({ timeout: 30_000 });

  // Both fields, or Save is disabled and the click is a no-op — which looks
  // exactly like the bug under test and would pass it for the wrong reason.
  await page.getByPlaceholder('Their name').fill('Stalled-network probe');
  await page.getByPlaceholder(/Heard the reverse alarm/).fill('Never reaches the server.');
}

test.describe('a stalled request', () => {
  test.skip(!EMAIL || !PASSWORD, 'set E2E_EMAIL and E2E_PASSWORD to run the stalled-network specs');
  // The auth deadline is 15s, so this has to outlast it.
  test.describe.configure({ timeout: 180_000 });

  test('does not leave the save button spinning forever', async ({ page }) => {
    await openWitnessSheet(page);

    // Nothing is answered from here on — the request is accepted and hangs,
    // which is what a phone losing signal mid-request actually looks like.
    await page.route('**/rest/v1/rpc/add_witness_statement', () => {});

    await page.getByText('Save statement', { exact: true }).click();

    // The toast is asserted first because it self-dismisses after 2s — waiting
    // on the button and then looking for it races that timer.
    await expect(
      page.getByText(/could not|failed|error|abort/i).first(),
      'a save that gave up has to say so — a silently reset button reads as success'
    ).toBeVisible({ timeout: 120_000 });

    // And the label comes back: while `saving` is true the Button renders a
    // spinner instead, which is the exact state the user was stuck in.
    await expect(
      page.getByText('Save statement', { exact: true }),
      'the button must return to its label rather than spin indefinitely'
    ).toBeVisible({ timeout: 30_000 });
  });

  test('does not stop later requests being issued at all', async ({ page }) => {
    // The nastier half of the original bug: one stalled *auth* call poisoned
    // the client, because every later request waits on the same getSession().
    // Nothing after it was ever sent.
    await openWitnessSheet(page);

    await page.route('**/auth/v1/token**', () => {});
    await page.evaluate(() => {
      for (const k of Object.keys(localStorage)) {
        if (!k.includes('auth-token')) continue;
        const v = JSON.parse(localStorage.getItem(k)!);
        v.expires_at = Math.floor(Date.now() / 1000) - 60;
        localStorage.setItem(k, JSON.stringify(v));
      }
    });

    await page.getByText('Save statement', { exact: true }).click();

    await expect(
      page.getByText('Save statement', { exact: true }),
      'a stalled token refresh must not wedge the client'
    ).toBeVisible({ timeout: 120_000 });
  });
});
