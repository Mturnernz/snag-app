import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { SUPERVISOR_STATE } from './auth-state';

// Accessibility. axe-core against the routes a person actually lands on.
//
// This is a workplace health-and-safety product. Its users are on sites, in
// gloves, on cracked phone screens, in bad light — and the portal is read by
// whoever happens to be the safety officer that month. Contrast and focus
// order are not decoration here.
//
// Scoped to WCAG 2.1 A/AA, which is what "accessible" means in practice and
// what NZ government procurement asks for. axe finds roughly a third of real
// issues automatically; a clean run here is a floor, not a certificate.

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

const PUBLIC_ROUTES = ['/', '/pricing', '/privacy', '/terms', '/login', '/sign-up'] as const;

test.describe('accessibility (public)', () => {
  for (const path of PUBLIC_ROUTES) {
    test(`${path} has no WCAG A/AA violations`, async ({ page }) => {
      await page.goto(path, { waitUntil: 'networkidle' });
      const { violations } = await new AxeBuilder({ page }).withTags(WCAG).analyze();
      expect(violations, `${path}:\n${describe(violations)}`).toEqual([]);
    });
  }

  test('the snag handoff has no WCAG A/AA violations', async ({ page }) => {
    // Reached straight from an email, often by the person least set up to
    // deal with a broken page.
    await page.goto('/go/snag/214083e1-74e0-4ca4-815e-3f8b309463d5', { waitUntil: 'networkidle' });
    const { violations } = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    expect(violations, `/go/snag/[id]:\n${describe(violations)}`).toEqual([]);
  });
});

test.describe('accessibility (portal)', () => {
  test.skip(!process.env.E2E_EMAIL || !process.env.E2E_PASSWORD, 'set E2E_EMAIL and E2E_PASSWORD');
  test.use({ storageState: SUPERVISOR_STATE });

  for (const path of ['/dashboard', '/snags', '/reports'] as const) {
    test(`${path} has no WCAG A/AA violations`, async ({ page }) => {
      await page.goto(path, { waitUntil: 'networkidle' });
      const { violations } = await new AxeBuilder({ page }).withTags(WCAG).analyze();
      expect(violations, `${path}:\n${describe(violations)}`).toEqual([]);
    });
  }

  test('the snag detail page has no WCAG A/AA violations', async ({ page }) => {
    // The densest screen in the portal, and the one with the collapsible
    // sections — <details> is accessible for free, but only if the summary
    // content stays inside it.
    await page.goto('/snags');
    const first = page.locator('main a[href^="/snags/"]').first();
    if ((await first.count()) === 0) {
      test.info().annotations.push({ type: 'note', description: 'no snags visible to this account' });
      return;
    }
    await first.click();
    await expect(page).toHaveURL(/\/snags\/[0-9a-f-]{36}/, { timeout: 45_000 });

    const { violations } = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    expect(violations, `snag detail:\n${describe(violations)}`).toEqual([]);
  });
});
