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

## Test data: the SNAG QA org

Write-path tests have to create snags, complete checklists, and resolve them, and
the schema is append-only by design — `snags` rows can't be deleted and five-year
retention is enforced in the database. So test data needs a **disposable
organisation**, not cleanup after the fact.

Snagv1 therefore has a dedicated **`SNAG QA`** organisation. RLS scopes every
query by `org_id`, so it is invisible to the real orgs, and anything tests write
there stays there harmlessly. It holds two accounts:

| Role | Purpose |
|---|---|
| `officer_admin` — *QA Admin* | portal access, exports, the admin-only paths |
| `worker` — *QA Worker* | proves the portal role gate actually refuses non-supervisors |

Passwords live in `apps/web/.env.local` (gitignored) and belong in GitHub Actions
secrets for CI. `supabase/seed/qa-accounts.sql` recreates the whole thing from
scratch and is idempotent.

Point tests at any *other* org only if you are happy for them to write there.

## Mobile

`apps/mobile` has no automated tests. Its React Native code can render under
`react-native-web` (`npm run web --workspace=apps/mobile`), which makes the same
Playwright setup usable for smoke coverage, but web rendering does not exercise
the native camera, image-picker, haptics, or clipboard paths — the parts most
worth testing. Device testing is manual via Expo Go for now.

## Network access

The app talks to Supabase over the public internet, so **whatever runs the tests
needs egress to `*.supabase.co`**. This is easy to get wrong silently, because the
app treats "Supabase unreachable" and "not logged in" identically:

- `requireSupervisorOrAdmin()` only checks `if (!user)`. A failed `getUser()` call
  returns `user: null`, so an outage redirects to `/login` exactly like an
  anonymous visit.
- `loginAction` maps *every* `signInWithPassword` error to "Incorrect email or
  password.", including a network failure.

The practical consequence for testing: the auth-gate specs pass whether the gate
works or the network is simply down. Before trusting a green run, confirm egress:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' \
  "$NEXT_PUBLIC_SUPABASE_URL/auth/v1/health" -H "apikey: $NEXT_PUBLIC_SUPABASE_ANON_KEY"
```

A `200` means the gate specs are meaningful. Anything else (or a `CONNECT tunnel
failed`) means they are passing vacuously, and the Tier 2 specs will fail to log
in no matter how correct the app is.

## Known gaps

- No favicon: there is no `public/` directory and no `src/app/icon.*`, so every
  page load 404s on the browser's implicit `/favicon.ico` request. The Tier 1
  specs filter that one un-attributable console line; adding an icon lets the
  filter go.
- No unit tests. There is no runner installed for `packages/supabase-queries`,
  which is where pure, fast tests would pay off most.
- No accessibility audit. `@axe-core/playwright` would slot into the Tier 1
  specs directly.
