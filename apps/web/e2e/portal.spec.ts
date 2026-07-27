import { test, expect } from '@playwright/test';

// Authenticated, READ-ONLY portal coverage. These specs log in and look; they
// never create, resolve, or delete a snag, so they are safe to point at an
// environment with real data in it.
//
// Set these to enable the suite (see TESTING.md):
//   E2E_EMAIL / E2E_PASSWORD          a supervisor or officer_admin account
//   E2E_WORKER_EMAIL / E2E_WORKER_PASSWORD   a worker account (optional)
const EMAIL = process.env.E2E_EMAIL;
const PASSWORD = process.env.E2E_PASSWORD;
const WORKER_EMAIL = process.env.E2E_WORKER_EMAIL;
const WORKER_PASSWORD = process.env.E2E_WORKER_PASSWORD;

async function login(page: import('@playwright/test').Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: /log in/i }).click();
}

test.describe('portal (supervisor/admin)', () => {
  test.skip(!EMAIL || !PASSWORD, 'set E2E_EMAIL and E2E_PASSWORD to run authenticated specs');

  test.beforeEach(async ({ page }) => {
    await login(page, EMAIL!, PASSWORD!);
    // Signing in is a server action plus a Supabase round-trip, so it needs more
    // than the default expect timeout on a loaded machine — otherwise the whole
    // authenticated suite flakes on timing rather than on behaviour.
    await expect(page, 'login should land on the dashboard').toHaveURL(/\/dashboard/, {
      timeout: 45_000,
    });
  });

  test('dashboard renders stats without errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    // Stat tiles are the dashboard's core content — an empty shell means the
    // queries failed silently rather than the org genuinely having no data.
    await expect(page.locator('main')).not.toBeEmpty();
    expect(errors).toEqual([]);
  });

  test('dashboard shows no query-failure banners', async ({ page }) => {
    // The dashboard renders per-section error text instead of throwing, so a
    // broken query degrades quietly and every other assertion still passes.
    // Regression guard: get_site_breakdown once raised 'column reference
    // "site_id" is ambiguous' for every org, and the page just showed a red line.
    const body = await page.locator('main').innerText();

    expect(body, 'dashboard rendered a query-failure message').not.toMatch(
      /Couldn'?t load|could not load|unknown error|is ambiguous/i
    );
  });

  test('snags list renders and a row opens its detail page', async ({ page }) => {
    await page.goto('/snags');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    const firstLink = page.locator('main a[href^="/snags/"]').first();
    if ((await firstLink.count()) === 0) {
      test.info().annotations.push({ type: 'note', description: 'no snags visible to this account' });
      return;
    }

    await firstLink.click();
    // Longer than the default: this is usually the first request to
    // /snags/[id] in a run, and the dev server compiles the route on demand.
    // At 10s it failed on the compile rather than on the navigation.
    await expect(page).toHaveURL(/\/snags\/[0-9a-f-]{36}/, { timeout: 45_000 });
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  // The snag detail page had no coverage beyond "the row opens it". These
  // three assert the properties it was actually getting wrong, and all of them
  // are state-aware: which snags an org has is not something a read-only spec
  // gets to choose, so each looks for its subject and annotates out if the org
  // has nothing in that state.
  test.describe('snag detail', () => {
    /** Opens snags until one matches, or annotates and returns null. */
    async function findSnagWhere(
      page: import('@playwright/test').Page,
      predicate: (body: string) => boolean,
      what: string,
    ): Promise<string | null> {
      await page.goto('/snags');
      const links = await page.locator('main a[href^="/snags/"]').evaluateAll(
        (els) => els.map((e) => (e as HTMLAnchorElement).getAttribute('href')!)
      );
      for (const href of links.slice(0, 12)) {
        await page.goto(href);
        const body = await page.locator('main').innerText();
        if (predicate(body)) return body;
      }
      test.info().annotations.push({ type: 'note', description: `no snag with ${what} visible to this account` });
      return null;
    }

    test('an undecided serious snag asks the notifiable question both ways', async ({ page }) => {
      // The portal used to offer one button, "Mark notifiable". Recording "no"
      // — which update_snag_status requires before resolving — meant flagging
      // a notifiable event and retracting it.
      const body = await findSnagWhere(page, (b) => /Notifiable: undecided/.test(b), 'an undecided notifiable decision');
      if (!body) return;

      await expect(page.getByText('Does this need reporting to WorkSafe?')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Yes — notifiable' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'No', exact: true })).toBeVisible();
    });

    test('Resolve is stated as blocked rather than offered', async ({ page }) => {
      // Same property the mobile screen asserts: while the gate is closed the
      // page names the outstanding condition instead of offering an action the
      // server will refuse with a raw Postgres exception.
      const body = await findSnagWhere(page, (b) => /Resolve is blocked/.test(b), 'a blocked resolve gate');
      if (!body) return;

      expect(body, 'the blocked line should name what is outstanding').toMatch(
        /Resolve is blocked — (decide|finish|add|record|close)/i
      );
      await expect(page.getByRole('button', { name: /^Resolve$/ })).toBeHidden();
    });

    test('caption-only evidence is visible, not silently dropped', async ({ page }) => {
      // Mobile's evidence sheet accepts a caption with no photo, and
      // add_evidence_item stores an empty media path for it. The portal
      // rendered thumbnails only, so those items vanished while the heading
      // above them still counted them.
      const body = await findSnagWhere(
        page,
        (b) => /Evidence \((\d+)\)/.test(b) && !/Evidence \(0\)/.test(b),
        'any evidence recorded',
      );
      if (!body) return;

      const count = Number(body.match(/Evidence \((\d+)\)/)![1]);
      const rendered = await page.locator('[data-evidence-item]').count();
      expect(
        rendered,
        `the heading counts ${count} evidence item(s); every one of them must render`
      ).toBe(count);
    });
  });

  test('reports page loads and does not auto-fire an export', async ({ page }) => {
    // Guards the same prefetch-safety property as the auth-gate specs, but from
    // the page that links to the exports: merely visiting must not POST.
    const exportCalls: string[] = [];
    page.on('request', (req) => {
      if (req.method() === 'POST' && /\/reports\/export/.test(req.url())) {
        exportCalls.push(req.url());
      }
    });

    await page.goto('/reports');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.mouse.wheel(0, 3000);
    await page.waitForTimeout(1000);

    expect(exportCalls, 'visiting /reports must not trigger an export').toEqual([]);
  });

  test('sidebar navigates between portal sections', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'mobile-viewport', 'sidebar is a drawer under 900px');

    for (const [name, url] of [
      [/snags/i, /\/snags/],
      [/reports/i, /\/reports/],
      [/dashboard/i, /\/dashboard/],
    ] as const) {
      await page.getByRole('link', { name }).first().click();
      await expect(page).toHaveURL(url);
    }
  });

  test('signing out revokes portal access', async ({ page }) => {
    // Under 900px the sidebar is a closed drawer, so Sign out isn't reachable
    // until it's opened (PortalNav's "Open menu" button).
    const menuButton = page.getByRole('button', { name: /open menu/i });
    if (await menuButton.isVisible().catch(() => false)) {
      await menuButton.click();
    }

    await page.getByRole('button', { name: /sign out|log out/i }).first().click();
    await page.waitForURL(/\/(login)?$/);

    // The session cookie must actually be gone, not just navigated away from.
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe('portal (worker role)', () => {
  test.skip(
    !WORKER_EMAIL || !WORKER_PASSWORD,
    'set E2E_WORKER_EMAIL and E2E_WORKER_PASSWORD to run the role-gate spec'
  );

  test('a worker is sent to /unauthorized, not the dashboard', async ({ page }) => {
    await login(page, WORKER_EMAIL!, WORKER_PASSWORD!);
    await expect(page).toHaveURL(/\/unauthorized/);
    await expect(page).not.toHaveURL(/\/dashboard/);
  });
});
