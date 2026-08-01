import { test, expect } from '@playwright/test';
import { SUPERVISOR_STATE } from './auth-state';
import { SITE_URL } from '../src/lib/seo';

// /go/snag/[id] — the single destination every notification links to.
//
// SNAG has two clients for two jobs, and a notification can't know which its
// reader needs: `serious_created` goes to a whole site's members in one email,
// and RCAs are usually assigned to workers, who the portal refuses. So the
// decision moved out of the mail and into this page, per visitor.
//
// Read-only, and the signed-out half needs no credentials.
const SNAG_ID = '214083e1-74e0-4ca4-815e-3f8b309463d5';

test.describe('snag handoff (anonymous)', () => {
  test('offers the app rather than bouncing to login', async ({ page }) => {
    // The point of the route: it is outside the (portal) group, so
    // requireSupervisorOrAdmin() can't throw out the people it exists to help.
    const res = await page.goto(`/go/snag/${SNAG_ID}`);
    expect(res?.status(), 'the handoff must be public').toBe(200);
    await expect(page).toHaveURL(/\/go\/snag\//);

    await expect(page.getByRole('heading', { name: /open this snag/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /open in the snag app/i })).toBeVisible();
  });

  test('carries the step through to the app link', async ({ page }) => {
    await page.goto(`/go/snag/${SNAG_ID}?step=rca`);
    const href = await page.getByRole('link', { name: /open in the snag app/i }).getAttribute('href');
    expect(href, 'the app link should point at the section the mail was about').toContain('?step=rca');
  });

  test('sends people to the app, never back into the portal', async ({ page }) => {
    // The loop this route exists to avoid, and the one a domain sweep will
    // reintroduce: everyone who reaches this page has already been refused by
    // the portal, so an app link on the portal's own origin sends them to
    // /snags/<id> inside (portal) -> requireSupervisorOrAdmin() ->
    // /unauthorized -> "open the app" -> here again.
    //
    // Checked against SITE_URL, the portal's own canonical host, rather than
    // against the origin the test happens to be served from. Under `next dev`
    // that origin is localhost, so it differs from anything anyone could
    // plausibly get wrong — the check would pass while the bug shipped.
    await page.goto(`/go/snag/${SNAG_ID}`);
    const href = await page.getByRole('link', { name: /open in the snag app/i }).getAttribute('href');
    expect(href, 'the app link must be absolute').toMatch(/^https?:\/\//);
    expect(
      new URL(href!).origin,
      'the app link must not point back at the portal'
    ).not.toBe(new URL(SITE_URL).origin);
  });

  test('drops a step it does not recognise', async ({ page }) => {
    // Straight off a URL anyone can type, so it is validated rather than
    // passed through into either client.
    await page.goto(`/go/snag/${SNAG_ID}?step=not-a-real-step`);
    const href = await page.getByRole('link', { name: /open in the snag app/i }).getAttribute('href');
    expect(href).not.toContain('step');
  });

  test('offers a supervisor the portal, and remembers the snag through login', async ({ page }) => {
    await page.goto(`/go/snag/${SNAG_ID}`);
    await page.getByRole('link', { name: /log in to the portal/i }).click();

    await expect(page).toHaveURL(/\/login\?next=/);
    // The snag has to survive the login round trip, or the notification has
    // still lost the thing it was about.
    await expect(page.locator('input[name="next"]')).toHaveValue(`/snags/${SNAG_ID}`);
  });

  test('a malformed id is not found', async ({ page }) => {
    // Shape-checked only — the page deliberately never looks the snag up, so
    // that a public URL can't be used to probe which ids exist.
    const res = await page.goto('/go/snag/not-a-uuid');
    expect(res?.status()).toBe(404);
  });

  test('login refuses an off-site return path', async ({ page }) => {
    // ?next= is an open redirect if it is taken on trust — exactly the trick a
    // phishing mail wants from a link on a domain you recognise.
    await page.goto(`/login?next=${encodeURIComponent('https://evil.example/phish')}`);
    await expect(
      page.locator('input[name="next"]'),
      'a hostile next must not be echoed back into the form'
    ).toHaveCount(0);

    // And the action must reject it even when the field is forged, which is
    // the half that actually matters.
    await page.evaluate(() => {
      const form = document.querySelector('form')!;
      const input = document.createElement('input');
      input.type = 'hidden';
      input.name = 'next';
      input.value = '//evil.example/phish';
      form.appendChild(input);
    });
    await page.getByLabel('Email').fill('definitely-not-a-user@example.invalid');
    await page.getByLabel('Password').fill('not-the-password');
    await page.getByRole('button', { name: /log in/i }).click();

    await page.waitForURL(/\/login/);
    expect(page.url(), 'must never leave the site').toContain('localhost');
  });
});

test.describe('snag handoff (supervisor)', () => {
  test.skip(!process.env.E2E_EMAIL || !process.env.E2E_PASSWORD, 'set E2E_EMAIL and E2E_PASSWORD');
  test.use({ storageState: SUPERVISOR_STATE });

  test('sends a supervisor straight through to the snag', async ({ page }) => {
    // They asked for a snag; give them the snag. A supervisor should never see
    // the chooser.
    await page.goto(`/go/snag/${SNAG_ID}?step=rca`, { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(new RegExp(`/snags/${SNAG_ID}\\?step=rca`), { timeout: 45_000 });
    await expect(page.getByRole('heading', { name: /open this snag/i })).toBeHidden();
  });
});
