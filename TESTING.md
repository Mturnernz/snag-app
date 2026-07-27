# Testing SNAG

## Layout

| Tier | What it covers | Credentials | Writes data? |
|---|---|---|---|
| 0 | `apps/mobile/src/**/*.test.ts(x)` — offline queue behaviour, badge colour rules, theme tokens, and the shared serious-lane resolve gate (its ordering pinned against `update_snag_status`). Jest, no browser, no network | none | no |
| 1 | `apps/web/e2e/public.spec.ts` — every public route, both themes, three viewports, no horizontal overflow, no failed subresources | none | no |
| 1 | `apps/web/e2e/handoff.spec.ts` — `/go/snag/[id]` is public, offers the app, carries a valid `?step=` and drops an invalid one, remembers the snag through login, 404s a malformed id, and refuses an off-site `?next=`. Its supervisor pass-through spec is Tier 2 | none (one spec needs `E2E_EMAIL`) | no |
| 1 | `apps/web/e2e/auth-gate.spec.ts` — portal routes redirect anonymously; export routes reject GET and refuse anonymous POST | none | no |
| 1 | `apps/mobile/e2e/auth.spec.ts` — auth screen renders, password masked, bad credentials rejected, both join paths reachable | none | no |
| 2 | `apps/web/e2e/portal.spec.ts` — dashboard/snags/reports render, no query-failure banners, sidebar navigation, sign-out revokes access, worker role refused, plus the snag detail page: sections start collapsed and the next step opens the one it names, the notifiable question offers both answers, Resolve is stated as blocked, every counted evidence item renders, the 5 Whys are asked one at a time | `E2E_EMAIL`/`E2E_PASSWORD` | no |
| 2 | `apps/mobile/e2e/report.spec.ts` — worker signs in, report screen shows both lanes and the right org, tab bar, snags list | `E2E_WORKER_EMAIL`/`E2E_WORKER_PASSWORD` | no |
| 2 | `apps/mobile/e2e/deep-link.spec.ts` — `/snags/:id` opens that snag from a cold load, `?step=` expands one section and leaves the rest collapsed, an unknown step is ignored, and navigating writes the URL back | `E2E_EMAIL`/`E2E_PASSWORD` | no |
| 2 | `apps/mobile/e2e/incident.spec.ts` — the serious-incident screen: next step above the fold, no empty photo block, Resolve stated as blocked, every collapsed card reports its state, the evidence sheet is usable, WorkSafe criteria stay behind their disclosure, composer starts collapsed | `E2E_EMAIL`/`E2E_PASSWORD` **and a serious snag the account can see** | no |
| 3 | `apps/mobile/e2e/write-path.spec.ts` — reports a serious incident, then satisfies each resolve-gate condition in turn (notifiable decision → checklist → witness → evidence → root cause) and resolves it, asserting the gate blocks until the last one is met | `E2E_WRITE_PATH=1` + `E2E_EMAIL`/`E2E_PASSWORD` | **yes** |

Tier 0 runs anywhere and takes seconds. Tier 1 needs only a served bundle. Tier 2
is read-only, so it is safe against an environment with real data. Tier 3 mutates
and needs the disposable org described below.

### Running Tier 3

It is opt-in and skips by default, so `npm test` never writes even on a machine
that has credentials:

```bash
E2E_WRITE_PATH=1 npx playwright test --tsconfig tsconfig.e2e.json e2e/write-path.spec.ts
```

Three fences, because `snags` rows cannot be deleted:

1. **Opt-in.** Without `E2E_WRITE_PATH=1` the spec skips.
2. **Org-checked at runtime.** Before its first write the spec reads the org the
   Report tab says it is reporting into and fails loudly unless it matches
   `E2E_WRITE_ORG` (default `SNAG QA`). A mistyped `E2E_EMAIL` should not
   quietly file test incidents into a customer's org.
3. **Disposable org.** Every run leaves a permanent snag. That is fine in
   `SNAG QA` and nowhere else — including partial runs, since a spec that fails
   halfway still leaves the snag it got as far as creating.

It is deliberately not in CI for the same reason: a per-PR write path would
accumulate records in a shared org on every push.

Its assertions are worth stating, since the point is the gate rather than the
clicking: Resolve is shown blocked with a count that decreases as conditions are
met; the notifiable decision is named first, matching `update_snag_status`'s own
ordering; Manage states the same blocking reason the Next-step card does; and
the card only flips to `Ready to resolve` once every condition is satisfied.
Evidence is captured caption-only — `expo-image-picker` has no web
implementation, and `add_evidence_item` accepts an empty media path.

## Running

```bash
npm install            # repo root — installs every workspace
npm run typecheck      # apps/web + apps/mobile
npm test               # everything: Tier 0, then web e2e, then mobile e2e
```

Or individually:

```bash
npm run test:mobile      # Tier 0 — Jest units
npm run test:e2e         # web Playwright (Tier 1 + 2)
npm run test:e2e:mobile  # mobile Playwright (Tier 1 + 2)
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

### One sign-in per run

`e2e/auth.setup.ts` is a setup project that logs in once and saves the session
to `e2e/.auth/` (gitignored); the portal specs reuse it via `storageState`.

This matters more than it looks. Logging in per test was ~40 sign-ins a run
across the three browser projects, which Supabase Auth rate-limits — and the
failure is invisible, because `loginAction` maps *every* `signInWithPassword`
error to "Incorrect email or password." The symptom was a spec partway through
the run finding itself back on `/login` for no reason anything on the page
could explain. It also cut the suite from 9.2 to 3.8 minutes.

One consequence worth knowing: any spec that signs out needs its own session,
because `signOut` ends the session it is called on. The sign-out spec logs in
separately for exactly that reason.

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

`apps/mobile` has Jest units (see Tier 0) plus browser specs: the app bundles and
runs under `react-native-web`, so the same Playwright setup drives it.

```bash
npm run web --workspace=apps/mobile     # Metro + react-native-web on :8081
```

Verified working this way, logged in as a real account: the auth screen, sign-in,
onboarding, and the full report-a-snag screen (photo picker, type toggle, serious
-incident lane, tab bar) — with no JS errors.

Only 10 of the ~55 files under `src/` touch a native module, and 6 of those are
`expo-haptics`, which no-ops harmlessly on web. The genuine gaps are
`expo-camera` (QR scan), `expo-image-picker`/`expo-image-manipulator`
(`PhotoPicker`), and `expo-file-system`. Those still need a device via Expo Go.

Note that rendering under react-native-web is real coverage but not equivalent
coverage: layout, styling, navigation, and data flow transfer well; native
modules and platform-specific behaviour do not.

`ScanJoinCodeScreen` pulls `jsQR` from `cdn.jsdelivr.net` at runtime, so QR
scanning needs that domain reachable.

### Behind a TLS-terminating proxy (sandboxed agent sessions)

The web app calls Supabase **server-side**, so Node handles the proxy and
everything works with `NODE_USE_ENV_PROXY=1` (already set by
`playwright.config.ts`). The mobile app calls Supabase **from the browser**, and
Chromium may not be able to negotiate TLS through such a proxy at all —
`ERR_CONNECTION_RESET` on every HTTPS host, including ones that are definitely
allowlisted. Installing the proxy CA into `~/.pki/nssdb` does not fix it.

`apps/mobile/scripts/supabase-relay.mjs` works around that without weakening any
certificate checking: the browser talks plain HTTP to localhost, and Node makes
the real, fully-verified TLS hop to Supabase.

```bash
NODE_USE_ENV_PROXY=1 node scripts/supabase-relay.mjs   # listens on :8090
```

Then point the bundle at it. Metro inlines `EXPO_PUBLIC_*` at bundle time and
**a shell variable will not override `.env`** — exporting one silently does
nothing. Expo loads `.env.local` before `.env`, so put the override there and
leave `.env` alone:

```bash
echo 'EXPO_PUBLIC_SUPABASE_URL=http://localhost:8090' >> apps/mobile/.env.local
npx expo start --web --clear     # --clear matters; the old bundle is cached
```

`.env.local` is gitignored, and deleting that line restores normal behaviour.
This is local test scaffolding only — never a deployment path, and unnecessary on
a machine with direct egress.

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

## Pinned React version

The root `package.json` has an `overrides` block pinning `react`, `react-dom`, and
`react-test-renderer` to `19.1.0`. Both apps already depend on `19.1.0` exactly,
but a transitive peer range is enough for npm to hoist a newer `react` to the
root while `react-dom` stays put — and a mismatched pair breaks the
react-native-web bundle at runtime with `Incompatible React versions`, which
surfaces as a blank page rather than a build error. Keep the three in lockstep
when upgrading.

## Known gaps

- `packages/supabase-queries` is only partly covered: `seriousResolveGate` has
  unit tests (`apps/mobile/src/lib/resolveGate.test.ts` — it runs in the mobile
  Jest project because that is where a runner already exists), but the query
  wrappers themselves don't. They each take a `SupabaseClient`, so they are
  straightforward to test against a stub — the cheapest coverage still on the
  table.
- No accessibility audit. `@axe-core/playwright` would slot into the Tier 1
  specs directly.
- Native mobile paths are untested: `expo-camera` (QR scan),
  `expo-image-picker`/`-manipulator` (`PhotoPicker`), `expo-file-system`. These
  need a device via Expo Go.
- Tier 3 covers the serious lane only. The niggle lane's own path (report →
  assign → `resolve_snag`) and the RCA/debrief flows are still uncovered.
- The web portal's snag detail page is a separate implementation from the
  mobile screen. It now has three read-only specs (the notifiable question, the
  stated resolve gate, evidence rendering), but its RCA, debrief, and corrective
  -action sections are still uncovered.
