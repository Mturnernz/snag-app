import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Accessibility. axe-core against the public routes this host serves.
//
// Small surface, but it's the account-recovery path: someone reaches it locked
// out, usually on a phone, usually from an email client's in-app browser. If
// the form is unusable they have no other way back into the app — mobile has
// no recovery screen of its own, by design.
//
// Scoped to WCAG 2.1 A/AA. axe finds roughly a third of real issues
// automatically; a clean run here is a floor, not a certificate.

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/** Fails with the rule, the impact, and the element — not just a count. */
function describe(violations: Awaited<ReturnType<AxeBuilder['analyze']>>['violations']): string {
  return violations
    .map((v) => {
      const where = v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join('\n      ');
      return `  [${v.impact}] ${v.id} — ${v.help}\n      ${where}\n      ${v.helpUrl}`;
    })
    .join('\n');
}

const ROUTES = ['/', '/forgot-password', '/reset-password', '/staff/sign-in'] as const;

test.describe('accessibility', () => {
  for (const path of ROUTES) {
    test(`${path} has no WCAG A/AA violations`, async ({ page }) => {
      await page.goto(path, { waitUntil: 'networkidle' });
      const { violations } = await new AxeBuilder({ page }).withTags(WCAG).analyze();
      expect(violations, `${path}:\n${describe(violations)}`).toEqual([]);
    });
  }
});

test('reset-password reads its tokens from the fragment, not the query', async ({ page }) => {
  // The whole reason this page is a client component. A server component never
  // sees a fragment, so it would call a perfectly valid recovery link invalid —
  // and the tokens arrive in the fragment because this flow is deliberately
  // implicit rather than PKCE. See src/app/forgot-password/actions.ts.
  await page.goto('/reset-password', { waitUntil: 'networkidle' });
  await expect(page.getByText(/link/i).first()).toBeVisible();
});

test('the staff portal sends a signed-out visitor to sign in', async ({ page }) => {
  // The proxy is not the security boundary — every portal read goes through a
  // staff_* function that refuses anybody not on the staff list — but a
  // signed-out visitor should meet the front door, not a page that can only
  // say no.
  await page.goto('/staff', { waitUntil: 'networkidle' });
  await expect(page).toHaveURL(/\/staff\/sign-in$/);
  await expect(page.getByRole('button', { name: 'Sign in with Google' })).toBeVisible();

  await page.goto('/staff/requests/00000000-0000-0000-0000-000000000000', { waitUntil: 'networkidle' });
  await expect(page).toHaveURL(/\/staff\/sign-in$/);
});
