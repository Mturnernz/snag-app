import { test, expect } from '@playwright/test';
import { SUPERVISOR_STATE } from './auth-state';

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

  // The session comes from the setup project rather than a per-test login —
  // see e2e/auth.setup.ts for why.
  test.use({ storageState: SUPERVISOR_STATE });

  test.beforeEach(async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page, 'the stored session should still be good').toHaveURL(/\/dashboard/, {
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
  // assert the properties the restructure actually claims, and all of them are
  // state-aware: which snags an org has is not something a read-only spec gets
  // to choose, so each looks for its subject and annotates out if the org has
  // nothing in that state.
  test.describe('snag detail', () => {
    // These walk the snag list looking for a subject, so each one is several
    // page loads rather than one — and against a dev server the first visit to
    // a route pays for compiling it. The default 30s budget was failing on
    // that rather than on anything the page does.
    test.describe.configure({ timeout: 120_000 });

    /** Every snag link on /snags, newest first. */
    async function snagHrefs(page: import('@playwright/test').Page): Promise<string[]> {
      await page.goto('/snags');
      return page.locator('main a[href^="/snags/"]').evaluateAll(
        (els) => els.map((e) => (e as HTMLAnchorElement).getAttribute('href')!)
      );
    }

    /**
     * A snag URL with the triage prompt suppressed.
     *
     * An untriaged serious snag opens onto a non-dismissible `<dialog>`, and
     * answering it is a write these specs must not make — with the modal up,
     * everything behind it is inert and nothing else on the page can be
     * inspected. `?triaged=1` is the same "asked and answered for this visit"
     * flag the triage action redirects with, so this suppresses the prompt
     * rather than working around it. The prompt has its own spec below.
     */
    function snagUrl(href: string, step?: string): string {
      return `${href}?triaged=1${step ? `&step=${step}` : ''}`;
    }

    /** Opens each snag until one matches, and leaves the page on it. */
    async function findSnag(
      page: import('@playwright/test').Page,
      matches: (body: string) => boolean,
      what: string,
      step?: string,
    ): Promise<string | null> {
      for (const href of (await snagHrefs(page)).slice(0, 8)) {
        await page.goto(snagUrl(href, step));
        const body = await page.locator('main').innerText();
        if (matches(body)) return href;
      }
      test.info().annotations.push({ type: 'note', description: `no snag with ${what} visible to this account` });
      return null;
    }

    test('sections start collapsed and the next step opens the one it names', async ({ page }) => {
      // The restructure's central claim. Before it, every section was expanded
      // at once and a serious snag was one column of about a dozen forms.
      const href = await findSnag(page, (b) => /Resolve — blocked/.test(b), 'an open resolve gate');
      if (!href) return;

      const open = page.locator('details[open]');
      expect(await open.count(), 'nothing should be expanded before you ask for it').toBe(0);

      // The CTA is a link carrying ?step=…, so following it must expand
      // exactly one section — the one the card named. Followed by URL rather
      // than clicked: the CTA's own href has no ?triaged=1, so on an
      // unallocated snag a click would land behind the triage modal and make
      // this assert something else.
      const cta = await page.locator('main a[href*="?step="]').first().getAttribute('href');
      expect(cta, 'the next-step card should link to the section it names').toBeTruthy();
      await page.goto(`${cta}&triaged=1`);
      await expect(page.locator('details[open]')).toHaveCount(1);
    });

    test('an undecided serious snag asks the notifiable question both ways', async ({ page }) => {
      // The portal used to offer one button, "Mark notifiable". Recording "no"
      // — which update_snag_status requires before resolving — meant flagging
      // a notifiable event and retracting it.
      const href = await findSnag(
        page,
        (b) => /Notifiable: undecided/.test(b),
        'an undecided notifiable decision',
        'notifiable',
      );
      if (!href) return;

      await expect(page.getByText('Does this need reporting to WorkSafe?')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Yes — notifiable' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'No', exact: true })).toBeVisible();
    });

    test('Resolve is stated as blocked rather than offered', async ({ page }) => {
      // Same property the mobile screen asserts: while the gate is closed the
      // page names what is outstanding instead of offering an action the
      // server will refuse with a raw Postgres exception.
      const href = await findSnag(page, (b) => /Resolve — blocked/.test(b), 'a blocked resolve gate');
      if (!href) return;

      const body = await page.locator('main').innerText();
      expect(body, 'the locked row should count what is left').toMatch(
        /Resolve — blocked, \d+ steps? remaining/
      );
      await expect(page.getByRole('button', { name: /^Resolve( this snag)?$/ })).toBeHidden();

      // And Manage must agree rather than contradict it.
      await page.goto(snagUrl(href, 'manage'));
      await expect(page.getByText(/Resolve is blocked — /)).toBeVisible();
    });

    test('every counted evidence item renders', async ({ page }) => {
      // Mobile's evidence sheet accepts a caption with no photo, and
      // add_evidence_item stores an empty media path for it. The portal
      // rendered thumbnails only, so those items vanished while the section
      // header above them still counted them.
      const href = await findSnag(
        page,
        (b) => /Evidence\s+\d+ items?/.test(b),
        'any evidence recorded',
        'evidence',
      );
      if (!href) return;

      const header = await page.locator('#evidence summary').innerText();
      const count = Number(header.match(/(\d+) items?/)![1]);
      expect(count).toBeGreaterThan(0);
      expect(
        await page.locator('[data-evidence-item]').count(),
        `the header counts ${count} evidence item(s); every one of them must render`
      ).toBe(count);
    });

    test('the 5 Whys are asked one at a time', async ({ page }) => {
      // Ten inputs at once misrepresented the method: why #2 is asked *of the
      // answer to* #1, and a form showing all five invites five parallel
      // guesses at the same question.
      const href = await findSnag(
        page,
        (b) => /Why \d of 5 · asked of:/.test(b),
        'an analysis in progress',
        'rca',
      );
      if (!href) return;

      // Exactly one why is offered, and it states what it is asked of.
      await expect(page.getByText(/Why \d of 5 · asked of:/)).toHaveCount(1);
      await expect(page.locator('#rca input[name="whyIndex"]')).toHaveCount(1);
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

  test('the help guide renders, and only the reader\'s sections', async ({ page }) => {
    await page.goto('/help');
    await expect(page.getByRole('heading', { level: 1, name: /help/i })).toBeVisible();

    // Sections are <details>, so their titles are in the accessibility tree
    // whether open or closed — a closed section is still findable.
    await expect(page.getByText('Triage — allocating a serious snag')).toBeVisible();

    // A Site Lead has no Manage Organisation screen, so the day-one setup
    // checklist is Manager-only. This is the role filter, not a rendering
    // detail: it's the whole reason the guide is data rather than a document.
    const role = await page.getByText(/you're a (Site Lead|Manager)/i).textContent();
    if (role && /Site Lead/i.test(role)) {
      await expect(page.getByText('Day one — setting up your organisation')).toHaveCount(0);
    }

    // The handouts have to actually be there — they're generated by
    // `npm run guide` and committed, so a missing one is a 404 nobody notices
    // until a customer clicks it.
    const pdf = await page.request.get('/snag-onboarding-guide.pdf');
    expect(pdf.status(), 'run `npm run guide` and commit the PDFs').toBe(200);
  });

  test('signing out revokes portal access', async ({ page }) => {
    // Its own session, deliberately: signOut revokes the token server-side,
    // and doing that to the shared one would log every later spec out.
    await page.context().clearCookies();
    await login(page, EMAIL!, PASSWORD!);
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 45_000 });

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
