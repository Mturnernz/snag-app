# Testing Snag

## Layout

| Tier | What it covers | Credentials | Writes data? |
|---|---|---|---|
| 0 | `apps/mobile/src/**/*.test.ts(x)` — badge colour rules, theme tokens, the CSP schemes the upload path depends on, the PWA manifest guardrails, and which URLs survive an auth transition on the web build (`webLocation.test.ts`). Jest, no browser, no network | none | no |
| 1 | `apps/mobile/e2e/auth.spec.ts` — the auth screen renders, sign-in and account creation are both reachable, password recovery is offered, and an incomplete form doesn't navigate | none | no |
| 1 | `apps/web/e2e/a11y.spec.ts` — axe-core against WCAG 2.1 A/AA on all three routes this host serves, in every viewport project | none | no |
| 2 | `apps/mobile/e2e/stalled-network.spec.ts` — a request that is issued and never answered must not leave the Add button spinning forever, and a stalled token refresh must not stop later requests being issued at all. The regression test for the bug in §Known gaps | `E2E_EMAIL`/`E2E_PASSWORD` | no |

Tier 0 runs anywhere and takes seconds. Tier 1 needs only a served bundle. Tier 2 signs in but
writes nothing.

The suite shrank with the product. Most of what used to be here tested the workplace
investigation flows — triage, RCA, corrective actions, the document-mode fork, the org document
register — and went with them. What's left is the platform behaviour that was expensive to learn
and is easy to break again.

## Running

```bash
npm run test:mobile        # tier 0 — jest
npm run test:e2e:mobile    # tiers 1-2 — Playwright against the Expo web build
npm run test:e2e           # apps/web
npm run typecheck
```

Playwright starts Metro itself (`webServer` in `apps/mobile/playwright.config.ts`) and reuses an
already-running one. Cold start plus the first unminified bundle is well over a minute, which is
why the timeouts look generous.

`apps/mobile/.env` must exist with `EXPO_PUBLIC_SUPABASE_*` or the bundle throws at module load
and every spec fails on a blank page.

## What the browser specs can't see

`apps/mobile` runs in the browser as well as on phones, and these specs only exercise the
browser. Three things are therefore untested here and need a device via Expo Go:

- **`expo-file-system`** has no web implementation, and its stub throws rather than no-oping.
- **Native photo capture.** `expo-image-picker` and `expo-image-manipulator` *do* run on web — the
  config used to claim otherwise, and treating the photo path as native-only is how the web build
  once shipped unable to upload a photo at all.
- **The CSP.** Both hosts send one, but `expo start`, jest and `tsc` see none of it, so a URL the
  code fetches can be missing from `connect-src` and nothing local will say so. The browser
  reports that as the same opaque `TypeError` a dead network gives, which the app then words as
  "no connection". `src/lib/csp.test.ts` pins the schemes the upload path depends on — including
  `blob:` in both `img-src` (a picked photo's preview) and `connect-src` (reading its bytes),
  since `'self'` covers neither.

## The database has its own coverage, and it isn't here

The `home` schema's RLS and RPCs were verified directly against Postgres, as a real signed-in
user inside a rolled-back transaction: the capture → triage → complete loop, the repeat
roll-forward, and isolation — a stranger sees zero rows in every table, is refused on every
write, and is refused the photo folder for both another household's prefix and a malformed one.

That's worth re-running after any migration touching policies or grants, and it is much faster
than reaching the same assertions through the UI. The shape of it is in the commit that added
`20260911093000`.

**One thing no test in this repo can check**: `home` must be listed under Supabase → Settings →
API → Exposed schemas. It's a platform setting, not a database one. When it's missing PostgREST
answers every call with `PGRST106` and the app reads as an account with no data — so
`SchemaNotExposedError` names it and `App.tsx` shows it rather than rendering an empty shell.

## Known gaps

**A stalled request used to wedge the whole client.** Phone connections don't fail cleanly — a
request goes out and is simply never answered. supabase-js puts no timeout on its own fetch, and
it resolves an access token before *every* request, so a stalled `/auth/v1/token` refresh left
`getSession()` pending forever. After that no call was ever issued at all: nothing reached the
server, so nothing was in the logs; nothing rejected, so no error was shown; the already-loaded
screen carried on rendering. The only symptom was a button that spun forever.

The fix is a deadline on every request (`fetchWithTimeout`) plus try/finally around the saves.
`stalled-network.spec.ts` pins both halves by doing what a bad connection does: accepting the
request and never answering it.
