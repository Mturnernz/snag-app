import { test, expect } from '@playwright/test';

// The (portal) route group is supervisor/officer_admin only, enforced by
// requireSupervisorOrAdmin() in (portal)/layout.tsx. These specs assert the
// boundary holds for an anonymous visitor — the case that matters most, and
// the one that needs no credentials to check.
const PORTAL_ROUTES = [
  '/dashboard',
  '/snags',
  '/reports',
  '/documents',
];

for (const path of PORTAL_ROUTES) {
  test(`${path} redirects an anonymous visitor to /login`, async ({ page }) => {
    await page.goto(path);
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole('heading', { name: /log in/i })).toBeVisible();
  });
}

test('a snag detail page is not readable anonymously', async ({ page }) => {
  // A guessed/leaked UUID must not render — the gate is on the route group, so
  // this should redirect before any snag data is fetched.
  await page.goto('/snags/00000000-0000-0000-0000-000000000000');
  await expect(page).toHaveURL(/\/login/);
});

// Route handlers sit inside (portal) but a layout does not run for a route
// handler, so these do not inherit the layout's gate — each calls
// requireSupervisorOrAdmin() itself. Both are POST-only on purpose: they write
// (a storage object plus an audit row), and as GETs, next/link prefetching
// could fire an export just by scrolling the Reports page (PRODUCT_REVIEW.md
// §6.3). So GET must be rejected outright, and POST must refuse anonymously.
const EXPORT_ROUTES = ['/reports/export', '/reports/export-csv'];

const REFUSAL_STATUSES = [301, 302, 303, 307, 308, 401, 403, 404];

for (const path of EXPORT_ROUTES) {
  test(`${path} does not accept GET`, async ({ request }) => {
    // Guards the prefetch-safety property, not just auth: if this ever starts
    // answering GET, a prefetch could trigger a write again.
    const res = await request.get(path, { maxRedirects: 0 });
    expect(res.status(), `${path} must not answer GET`).toBe(405);
  });

  test(`${path} refuses an anonymous POST`, async ({ request }) => {
    const res = await request.post(path, { maxRedirects: 0 });
    expect(
      REFUSAL_STATUSES.includes(res.status()),
      `${path} returned ${res.status()} to an anonymous POST — it must not serve data`
    ).toBe(true);

    // A redirect must head for the login page, not back into the portal.
    if (res.status() >= 300 && res.status() < 400) {
      expect(res.headers()['location'] ?? '').toMatch(/login/i);
    }
  });
}

test('the unauthorized page explains itself', async ({ page }) => {
  await page.goto('/unauthorized');
  await expect(page.locator('body')).toContainText(/access|permission|not authorised|not authorized|supervisor/i);
});
