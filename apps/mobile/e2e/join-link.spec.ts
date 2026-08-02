import { test, expect } from '@playwright/test';

// The org join QR landing: `?join=<code>` on the app host.
//
// Two things this covers that nothing else does, both of which shipped broken.
//
// The QR encoded the bare join code, so a phone camera got a string with
// nothing to tap — the poster only worked for someone already inside SNAG on
// its scanner screen, which is nobody its audience is made of. It encodes this
// link now.
//
// And resolving the code calls get_org_by_join_code *before* the account
// exists, which means as the anon role. That grant was collateral in a blanket
// revoke on 2026-07-12 and nothing caught it: the client rendered the resulting
// 42501 as "That code is not a valid Snag join code", so a live code looked
// like a typo and every new sign-up was blocked for three weeks. Reaching the
// org's name here is the assertion that the grant is still in place.
//
// Unauthenticated and writes nothing — it stops at the org name, before any
// account is created. It does need the browser to reach Supabase, unlike the
// rest of the unauthenticated specs, since the whole point is the round trip.

const CODE = process.env.E2E_JOIN_CODE;
const ORG_NAME = process.env.E2E_JOIN_ORG_NAME;

test.describe('join link landing', () => {
  test.skip(!CODE || !ORG_NAME, 'Set E2E_JOIN_CODE and E2E_JOIN_ORG_NAME to run.');

  test('a scanned join link opens sign-up on the named organisation', async ({ page }) => {
    await page.goto(`/?join=${CODE}`, { waitUntil: 'domcontentloaded' });

    // Straight into the stepper — the poster's audience has no account, so the
    // sign-in form would be the wrong door.
    await expect(page.getByText("What's your name?")).toBeVisible({ timeout: 120_000 });

    await page.getByPlaceholder('Your full name').fill('QR Scanner');
    await page.getByText('Continue', { exact: true }).click();

    // The code came with them, so "how would you like to find your
    // organisation" is skipped — they've answered it by scanning.
    await expect(page.getByText('Create your account')).toBeVisible();
    await expect(page.getByText(`You're joining ${ORG_NAME}.`)).toBeVisible();
  });

  test('an unknown code says so, rather than stranding them on a spinner', async ({ page }) => {
    await page.goto('/?join=ZZZZZZZZ', { waitUntil: 'domcontentloaded' });

    await expect(page.getByText("What's your name?")).toBeVisible({ timeout: 120_000 });
    await page.getByPlaceholder('Your full name').fill('QR Scanner');
    await page.getByText('Continue', { exact: true }).click();

    await expect(page.getByText(/no longer valid/)).toBeVisible();
  });
});
