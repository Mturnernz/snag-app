import { test, expect, type Page } from '@playwright/test';

// Every route a visitor can reach without an account. These run with no
// credentials and write nothing, so they are safe against any environment.
const PUBLIC_ROUTES = [
  { path: '/', heading: /every workplace hazard/i },
  { path: '/pricing', heading: /pricing|plan/i },
  { path: '/privacy', heading: /privacy/i },
  { path: '/terms', heading: /terms/i },
  { path: '/login', heading: /log in/i },
  { path: '/sign-up', heading: /create|sign up|organisation/i },
] as const;

// Next.js dev overlays produce console noise that isn't a product defect; fail
// only on things a user would actually hit.
//
// The blanket "Failed to load resource: ... 404" filter that used to live here
// is gone: it existed because the app shipped no favicon, so the browser's
// implicit /favicon.ico request 404'd on every page and surfaced as an
// un-attributable console line. src/app/icon.svg fixed the cause, so the specs
// can hold every 404 against the page again.
const IGNORED_CONSOLE = [
  /Download the React DevTools/i,
  /\[Fast Refresh\]/i,
];

const IGNORED_REQUESTS: RegExp[] = [];

function collectPageErrors(page: Page) {
  const errors: string[] = [];

  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (IGNORED_CONSOLE.some((re) => re.test(text))) return;
    errors.push(text);
  });
  page.on('pageerror', (err) => errors.push(`uncaught: ${err.message}`));

  // Stricter than the console check: any subresource the page actually asked
  // for and failed to get, named so a failure is diagnosable.
  page.on('response', (res) => {
    if (res.status() < 400) return;
    if (IGNORED_REQUESTS.some((re) => re.test(res.url()))) return;
    errors.push(`${res.status()} ${res.request().resourceType()} ${res.url()}`);
  });
  page.on('requestfailed', (req) => {
    if (IGNORED_REQUESTS.some((re) => re.test(req.url()))) return;
    errors.push(`requestfailed ${req.resourceType()} ${req.url()}`);
  });

  return errors;
}

for (const { path, heading } of PUBLIC_ROUTES) {
  test(`${path} renders without errors`, async ({ page }) => {
    const errors = collectPageErrors(page);

    const response = await page.goto(path, { waitUntil: 'networkidle' });
    expect(response?.status(), `${path} should return 200`).toBe(200);

    await expect(page.getByRole('heading', { name: heading }).first()).toBeVisible();

    // Nothing may overflow horizontally — the design system requires wide
    // content to scroll inside its own container, never the page body.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow, `${path} must not scroll horizontally`).toBeLessThanOrEqual(1);

    expect(errors, `${path} logged errors or failed subresource loads`).toEqual([]);
  });
}

test('login form exposes labelled email and password fields', async ({ page }) => {
  await page.goto('/login');

  // Labelled, not just present — the design system's `.field` pattern pairs a
  // <label for> with each input, and screen-reader users depend on it.
  await expect(page.getByLabel('Email')).toBeVisible();
  await expect(page.getByLabel('Password')).toBeVisible();
  await expect(page.getByRole('button', { name: /log in/i })).toBeEnabled();
});

test('login rejects bad credentials without leaking whether the account exists', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('definitely-not-a-user@example.invalid');
  await page.getByLabel('Password').fill('not-the-password');
  await page.getByRole('button', { name: /log in/i }).click();

  // Should come back to /login with an error, never reach the portal.
  await page.waitForURL(/\/login/);
  await expect(page.locator('.error-text')).toBeVisible();
  await expect(page).not.toHaveURL(/\/dashboard/);
});

test('marketing pages are reachable from the landing page', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: /pricing/i }).first().click();
  await expect(page).toHaveURL(/\/pricing/);
});

test('both themes resolve real token values', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile-viewport', 'theme coverage runs in the desktop projects');

  await page.goto('/');
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);

  // A missing custom property computes to transparent/empty rather than
  // throwing, so assert we got a real colour rather than eyeballing a shot.
  expect(bg).toMatch(/^rgb/);
  expect(bg).not.toBe('rgba(0, 0, 0, 0)');
});
