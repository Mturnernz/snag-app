import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// The staff portal's public face: the sign-in page, and the redirect that
// sends everybody without a session to it.
//
// The signed-in pages need a staff Google account and cannot run here; they
// were put through axe against a local replay of the schema when the portal
// was built. Scoped to WCAG 2.1 A/AA — a floor, not a certificate.

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

test('/sign-in has no WCAG A/AA violations', async ({ page }) => {
  await page.goto('/sign-in', { waitUntil: 'networkidle' });
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
});

test('a signed-out visitor is sent to sign in, from anywhere', async ({ page }) => {
  // The proxy is not the security boundary — every portal read goes through a
  // staff_* function that refuses anybody not on the staff list — but a
  // signed-out visitor should meet the front door, not a page that can only
  // say no.
  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(page.getByRole('button', { name: 'Sign in with Google' })).toBeVisible();

  await page.goto('/requests/00000000-0000-0000-0000-000000000000', { waitUntil: 'networkidle' });
  await expect(page).toHaveURL(/\/sign-in$/);
});

test('every response says not to index it', async ({ request }) => {
  const res = await request.get('/sign-in');
  expect(res.headers()['x-robots-tag']).toBe('noindex, nofollow');
});
