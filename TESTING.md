# Testing SNAG

## Layout

| Tier | What it covers | Credentials | Writes data? |
|---|---|---|---|
| 1 | `apps/web/e2e/public.spec.ts` — every public route, both themes, three viewports, no horizontal overflow, no failed subresources | none | no |
| 1 | `apps/web/e2e/auth-gate.spec.ts` — portal routes redirect anonymously; export routes reject GET and refuse anonymous POST | none | no |
| 2 | `apps/web/e2e/portal.spec.ts` — dashboard/snags/reports render, sidebar navigation, sign-out revokes access, worker role is refused | `E2E_EMAIL`/`E2E_PASSWORD` | no |
| 3 | not yet written — report → triage → investigate → resolve | test-org account | **yes** |

Tier 1 runs anywhere. Tier 2 is read-only, so it is safe against an environment
with real data. Tier 3 mutates and needs a disposable org — see below.

## Running

```bash
npm install                 # repo root — installs every workspace
npm run typecheck           # apps/web + apps/mobile
npm run test:e2e            # Tier 1 (+ Tier 2 if credentials are set)
```

`playwright.config.ts` starts `next dev` itself and reuses an already-running
server, so an interactive session won't have its server torn down by a test run.

First run on a new machine needs the browser binary:

```bash
cd apps/web && npx playwright install chromium
```

Useful flags:

```bash
npx playwright test --ui                      # interactive runner
npx playwright test --project=chromium-dark   # one project
npx playwright test e2e/auth-gate.spec.ts     # one file
npx playwright show-report                    # last HTML report
```

### Environment

`apps/web/.env.local` needs `NEXT_PUBLIC_SUPABASE_URL` and
`NEXT_PUBLIC_SUPABASE_ANON_KEY` (see `.env.example`). Test credentials go in the
shell or the same file:

```bash
E2E_EMAIL=…            # a supervisor or officer_admin account
E2E_PASSWORD=…
E2E_WORKER_EMAIL=…     # optional — enables the role-gate spec
E2E_WORKER_PASSWORD=…
```

Specs that lack their credentials skip rather than fail, so a partial setup
still gives a green, honest run.

### Sandboxes with a pre-installed Chromium

If the machine ships a Chromium that doesn't match the build Playwright wants,
point at it instead of downloading:

```bash
PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome npx playwright test
```

## CI

`.github/workflows/ci.yml` runs typecheck, `next build`, and Playwright on every
PR and on `main`. It needs these repository secrets:

- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` — required
- `E2E_EMAIL`, `E2E_PASSWORD`, `E2E_WORKER_EMAIL`, `E2E_WORKER_PASSWORD` — optional

The anon key is safe as a repository secret but is not actually a secret: it is
shipped to every browser and is only as strong as the RLS policies behind it.
Never put the service-role key in CI.

## Tier 3 and test data

Tier 3 has to create snags, complete checklists, and resolve them — it cannot run
against an org whose records anyone relies on, and the schema is append-only by
design (`snags` rows can't be deleted, five-year retention enforced in the
database). So write-path tests need a **disposable organisation**, not cleanup
after the fact.

Options, cheapest first:

1. **A dedicated test org inside Snagv1.** RLS scopes every query by `org_id`, so
   a `SNAG QA` org is invisible to real orgs. No new infrastructure. Its rows
   live forever, which is fine for an org nobody reports on.
2. **A staging Supabase project.** Full isolation, but the migrations in
   `supabase/migrations/` are marked "SNAPSHOT — do NOT re-apply", so standing up
   a second schema is real work.
3. **A Supabase branch.** Cleanest isolation, but it is a paid feature.

Until one of those exists, keep the suite at Tiers 1–2.

## Mobile

`apps/mobile` has no automated tests. Its React Native code can render under
`react-native-web` (`npm run web --workspace=apps/mobile`), which makes the same
Playwright setup usable for smoke coverage, but web rendering does not exercise
the native camera, image-picker, haptics, or clipboard paths — the parts most
worth testing. Device testing is manual via Expo Go for now.

## Known gaps

- No favicon: there is no `public/` directory and no `src/app/icon.*`, so every
  page load 404s on the browser's implicit `/favicon.ico` request. The Tier 1
  specs filter that one un-attributable console line; adding an icon lets the
  filter go.
- No unit tests. There is no runner installed for `packages/supabase-queries`,
  which is where pure, fast tests would pay off most.
- No accessibility audit. `@axe-core/playwright` would slot into the Tier 1
  specs directly.
