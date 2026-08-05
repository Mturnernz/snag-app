import { test, expect } from '@playwright/test';

// /join/[token] — where an invite email lands.
//
// Worth stating what this covers, because the bug it comes from was invisible
// for the whole life of the feature: `invite_user` wrote an `invites` row and
// nothing else. No mail was ever sent, the token was selected by no query, and
// the app's join screen asked people to "paste the code your admin or
// supervisor emailed you". Every invite ever created was a dead end, and the
// only symptom was silence — the RPC succeeded, so the UI said "Invite sent".
//
// So these tests are deliberately about the *reachability* of the route rather
// than a happy-path acceptance: a page that 404s or bounces to login is the
// failure mode that actually happened, and it can't be seen from inside the app.
//
// Read-only and unauthenticated. No invite is created or consumed — accepting
// one would need a real pending token and would burn it on the first run.

// Well-formed but not a real invite. The page must still render (and explain
// itself) rather than erroring, since a cancelled invite produces exactly this.
const UNKNOWN_TOKEN = '00000000-0000-4000-8000-000000000000';

test.describe('invite landing (anonymous)', () => {
  test('is public — the people it exists for have no account yet', async ({ page }) => {
    // The whole point of sitting outside the (portal) group. Most invitees are
    // workers, and requireSupervisorOrAdmin() would bounce them to
    // /unauthorized before they could accept the thing that would have given
    // them a role.
    const res = await page.goto(`/join/${UNKNOWN_TOKEN}`);
    expect(res?.status(), 'the invite landing must be public').toBe(200);
    await expect(page).toHaveURL(/\/join\//);
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page).not.toHaveURL(/\/unauthorized/);
  });

  test('explains an invite it cannot find, rather than failing blankly', async ({ page }) => {
    await page.goto(`/join/${UNKNOWN_TOKEN}`);
    await expect(page.getByRole('heading', { name: /isn't valid|not valid/i })).toBeVisible();
    // The recovery route has to be named — the reader can't tell a mistyped
    // link from a cancelled invite, and either way the fix is the same.
    await expect(page.getByText(/send a new one/i)).toBeVisible();
  });

  test('404s a malformed token instead of passing it to PostgREST', async ({ page }) => {
    // A non-uuid reaching the RPC is a 400, which would surface as an opaque
    // error page for what is really a truncated link.
    const res = await page.goto('/join/not-a-token');
    expect(res?.status()).toBe(404);
  });

  test('is not indexable', async ({ page }) => {
    // One URL per invite, the token in the path is the credential, and the
    // links are only ever followed from an inbox.
    await page.goto(`/join/${UNKNOWN_TOKEN}`);
    const robots = await page.locator('meta[name="robots"]').getAttribute('content');
    expect(robots).toMatch(/noindex/);
    expect(robots).toMatch(/nofollow/);
  });
});
