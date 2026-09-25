import { test, expect, type Page } from '@playwright/test';

// Coming back to the tab must not look like signing in.
//
// This is the regression test for a bug reported from a phone: on step three of
// the House walkthrough, "Take a photo of the rating plate" opened the camera,
// and coming back landed on the List tab with the photo gone.
//
// Nothing to do with the camera. auth-js calls `_recoverAndRefresh` whenever a
// hidden tab becomes visible, and a session that is valid and not near expiry is
// re-announced as `SIGNED_IN` — GoTrueClient.js, the plain `else` at the end of
// `_recoverAndRefresh`, "no need to persist currentSession again, as we just
// loaded it from local storage". The same event, for the same person, who never
// left. Opening the camera is simply the commonest way to hide the tab.
//
// App.tsx could not tell that from a login, so it did two things: reset the
// address bar to `/`, which linking.ts deliberately leaves unmapped, and set
// `loading`, which gates the entire tree — unmounting NavigationContainer,
// HouseholdProvider and whatever sheet was open. The remounted navigator then
// fell through to `initialRouteName`, the list. The photo lived in component
// state, because nothing is written until the last step, so it went too.
//
// The fix is `planAuthEvent` (src/lib/authEvents.ts): an auth event is a sign-in
// only if the user changed. This spec does what the camera does — hides the tab
// and brings it back — and asserts the app stays where it was.
const EMAIL = process.env.E2E_EMAIL;
const PASSWORD = process.env.E2E_PASSWORD;

test.skip(!EMAIL || !PASSWORD, 'Set E2E_EMAIL and E2E_PASSWORD to run the authenticated specs.');

async function signIn(page: Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Sign in', { exact: true })).toBeVisible({ timeout: 120_000 });
  await page.getByPlaceholder('Email').fill(EMAIL!);
  await page.getByPlaceholder('Password').fill(PASSWORD!);
  await page.getByText('Sign in', { exact: true }).click();
  await expect(page.getByPlaceholder('Capture a new job')).toBeVisible({ timeout: 90_000 });
}

/**
 * What opening the camera does to the page, without opening the camera.
 *
 * Playwright has no API for backgrounding a tab, and `page.bringToFront` won't
 * do it with a single page open — but `visibilityState` is what auth-js reads,
 * so overriding it and firing the event is the same input the browser gives it.
 *
 * **Dispatch on `window`, not `document`.** GoTrueClient's
 * `_handleVisibilityChange` registers with `window.addEventListener`, and a
 * hand-made `Event` does not bubble unless asked, so a `document` dispatch
 * reaches nothing and the test passes against the bug it is meant to catch.
 * That is exactly what happened while writing this one.
 */
async function leaveAndComeBack(page: Page) {
  await page.evaluate(() => {
    const set = (state: string) =>
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => state,
      });
    set('hidden');
    window.dispatchEvent(new Event('visibilitychange'));
    set('visible');
    window.dispatchEvent(new Event('visibilitychange'));
  });
  // Long enough for a reload to have unmounted the tree and remounted it, which
  // is the failure this is watching for.
  await page.waitForTimeout(3_000);
}

test('the walkthrough survives the tab going away and coming back', async ({ page }) => {
  await signIn(page);

  await page.getByText('House', { exact: true }).first().click();
  // The House tab is a grid of rooms, and a room's + is on its own page. The
  // tile's label carries the room's count ("Kitchen, 3 of 7"), which depends on
  // what this account has recorded, so it is matched on the name alone.
  await page.getByRole('button', { name: /^Kitchen, \d/ }).click();
  await page.getByLabel('Add something to Kitchen').click();
  await expect(page.getByText('What is it?')).toBeVisible({ timeout: 30_000 });

  await leaveAndComeBack(page);

  // Both halves of the bug. It was reported from step three, the one with the
  // camera on it, but the unmount takes the whole sheet whichever step is
  // showing — and step two needs no selection to reach, so it is the steadier
  // thing to assert on.
  await expect(page.getByText('What is it?')).toBeVisible();
  // The navigator must not have fallen back to its initial route.
  await expect(page.getByPlaceholder('Capture a new job')).toBeHidden();
});

test('a typed snag is not lost when the tab comes back', async ({ page }) => {
  await signIn(page);

  // The same unmount took everything else with it, and the compose bar is where
  // it costs most — the whole point of the bar is that it holds what you typed.
  await page.getByPlaceholder('Capture a new job').fill('Gutters need clearing');

  await leaveAndComeBack(page);

  await expect(page.getByPlaceholder('Capture a new job')).toHaveValue('Gutters need clearing');
});
