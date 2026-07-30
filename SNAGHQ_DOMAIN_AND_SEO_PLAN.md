# SnagHQ — domain wiring, SEO pass, and the Docunation cleanup

**Date:** 30 July 2026
**Scope:** `apps/web` only, plus one line of `PRODUCT_REVIEW.md`.
**Branch:** `claude/snaghq-domain-seo-b0o08k`

Brand decision, settled: **Snag** is the mobile app. **SnagHQ** is `apps/web` — the marketing
route group and the auth-gated supervisor portal, one Next.js app, one Netlify site, one Supabase
project (`wpkdpukpllxuyqqlxkxf`). "Docunation" was an earlier candidate for the same surface and is
on hold.

This document carries the investigation (§1), the plan (§2), what was actually built (§3), and the
self-review against the four user flows (§4).

**Out of scope, and untouched:** all of `apps/mobile`; the `website` branch's Docunation Astro
site (not merged, not ported, not read as a copy source); the cross-org admin/ops surface; RLS
policies, RPCs, storage buckets, and the stale `claude/*` branches. No DNS or Netlify dashboard
change was attempted — those are listed as manual steps in §2.3 instead.

### Two premises in the brief that the code contradicts

Recorded because they'd otherwise look like omissions.

1. The brief describes the brand voice through tokens **"Ink, Signal Orange, Verified Green;
   Archivo/Inter/IBM Plex Mono."** None of those exist in this repo. `apps/web/src/app/globals.css`
   and `apps/mobile/src/constants/theme.ts` use primary `#2563EB`, `--color-serious`,
   `--color-success`; the fonts are **IBM Plex Sans + IBM Plex Mono** (`apps/web/src/lib/fonts.ts`).
   Those token names belong to the Docunation Astro site on the unmerged `website` branch, which is
   explicitly out of scope. All copy here is written in **this repo's** actual register — the plain,
   decisive voice already in `(marketing)/page.tsx` ("Every workplace hazard, tracked from photo to
   fix", "Built to survive scrutiny, not just look tidy").
2. The brief asks whether `snagv1.netlify.app` is a native-app-deep-link fallback. Partly — and the
   answer changes what to do with it. See §1.2.

---

## 1. Investigation

### 1.1 `docunation` — one hit, and it is not branding

`git grep -in docunation` across the full tree, plus a separate untracked/ignored sweep, returns
**exactly one line**:

| File:line | Text |
|---|---|
| `PRODUCT_REVIEW.md:65` | `**This is not theoretical.** In the Docunation org right now:` |

It is not product copy. It is the **name of a live `organisations` row in Snagv1**, introducing a
table of ten verified snag references (SNAG-00003 … SNAG-00028) that the review marks
`**[verified — queried live]**`.

A literal `Docunation → SnagHQ` replace would leave the document asserting a "SnagHQ org" that
does not exist in the database — so anyone re-running the query to check the finding would come up
empty, and a true audit record would become a false one. Anonymised instead (§2.1).

Nothing else references Docunation anywhere: no code, no comment, no env file, no CSS, no test, no
config.

### 1.2 Hostname trace

| Reference | Location | What it actually does |
|---|---|---|
| `https://www.snaghq.co.nz` | `supabase/functions/notify-snag/index.ts:33` — `SNAG_PORTAL_URL` default | **The portal.** Every notification link is `${PORTAL_URL}/go/snag/<id>[?step=]`. Already correct, and already documented as aspirational until DNS moves (lines 27–32). The var is a Supabase function secret, so it repoints with no redeploy. |
| `https://snagv1.netlify.app` | `apps/web/src/app/go/snag/[id]/page.tsx` — `NEXT_PUBLIC_SNAG_APP_URL` default | **The mobile app's own Expo web build — a different deployment.** Built by `apps/mobile/netlify.toml` (`npx expo export --platform web`) on a separate Netlify site. Used for the "Open in the SNAG app" button. |
| `https://snagv1.netlify.app` | `apps/web/.env.example:10` | Documents the same var. Its comment already says "the mobile app's web build". |
| `https://snagv1.netlify.app` | `apps/mobile/src/navigation/linking.ts:23`, `ManageSitesScreen.tsx:35`, `ManageOrganisationScreen.tsx:42` | Mobile deep-link prefixes and the site-QR encoder. **`apps/mobile` — out of scope, untouched.** |
| `snagv1.netlify.app` (prose) | `CLAUDE.md:354`, `MVP-SPEC.md:9`, `Snag-Architecture-Build-Plan.md:40` | Descriptive and accurate. Untouched. |
| `www.snaghq.co.nz` (prose) | `PRODUCTION_READINESS.md:248–258` (decision D1) | Already records the decision and its two manual steps. Untouched. |
| `hello@snag.app` | `(marketing)/layout.tsx:5` | Footer contact mailto, on a domain that isn't the canonical one. |
| `"Back to snag.app"` | `unauthorized/page.tsx:16` | Button label naming that same non-canonical domain. |
| `getsnag` | — | **No hits anywhere in the repo.** |

#### The `snagv1.netlify.app` finding — confirmed, with a correction

The brief's hypothesis was close but not exact, and the difference matters.

It is **not** a fallback for the portal, and it is **not** the native deep link either — the
`snag://snags/<id>` custom scheme is a separate, secondary link further down the same file. It is
the **web-build fallback for the app**: the destination offered to visitors that
`/go/snag/[id]` has already determined *cannot* use the portal (`canUsePortal === false`).

**Verdict: keep it, as a deliberately distinct target.** Repointing it at `www.snaghq.co.nz` would
send a worker to `www.snaghq.co.nz/snags/<id>`, which sits inside the `(portal)` route group;
`requireSupervisorOrAdmin()` bounces them to `/unauthorized`, which offers them the app — a loop
straight back to where they started. The two hostnames name two genuinely different deployments and
both are correct today. A clarifying comment was added at the constant so a future domain sweep
doesn't "fix" it into that loop.

### 1.3 SEO metadata before this change — confirmed by reading, not assumed

`grep -rn "export const metadata\|generateMetadata\|openGraph\|metadataBase\|robots\|sitemap" apps/web/src`
returned **one** line: `apps/web/src/app/layout.tsx:5`.

| Route | Title | Description | OpenGraph |
|---|---|---|---|
| root `layout.tsx` | `'SNAG'` | "Workplace issue reporting and safety investigation." | none |
| `/` | inherited | inherited | none |
| `/pricing` | inherited | inherited | none |
| `/privacy` | inherited | inherited | none |
| `/terms` | inherited | inherited | none |
| `/sign-up` | inherited | inherited | none |
| `/sign-up/check-email` | inherited | inherited | none |
| `(marketing)/layout.tsx` | no metadata export at all | — | — |

Also absent: `metadataBase`, any `alternates.canonical`, `app/sitemap.ts`, `app/robots.ts`,
`opengraph-image`. `app/icon.svg` existed (favicon only).

So: every marketing page served `<title>SNAG</title>` with one shared description, no canonical, no
social card, and nothing telling a crawler which pages to index. That is the whole reason flow 1
doesn't work.

---

## 2. The plan

### 2.1 Docunation removal list

One item, `PRODUCT_REVIEW.md:65`:

```diff
-**This is not theoretical.** In the Docunation org right now:
+**This is not theoretical.** In the live pilot org right now:
```

Neutral descriptor: removes the string from `main` while keeping the finding truthful. The
SNAG-000xx references and the `**[verified — queried live]**` marker are unchanged.

### 2.2 Hostname plan

**One canonical domain, `www.snaghq.co.nz`, for the whole of `apps/web`** — marketing and portal
together. No subdomain split: the two route groups already share a session, a Supabase client and
`middleware.ts`, and separating them would break the `/login?next=` round trip that
`/go/snag/[id]` relies on to return a supervisor to the snag they were mailed about.

| Change | File |
|---|---|
| `SITE_URL` constant + `metadataBase` | new `src/lib/seo.ts`, consumed by `app/layout.tsx` |
| `hello@snag.app` → `hello@snaghq.co.nz` | `(marketing)/layout.tsx` |
| `"Back to snag.app"` → `"Back to SnagHQ"` | `unauthorized/page.tsx` |
| `snagv1.netlify.app` | **kept**, with a comment explaining why (§1.2) |
| `SNAG_PORTAL_URL` / `notify-snag` | **no change** — default already correct |

**Visible wordmarks stay "SNAG".** Per the decision taken before implementation, SnagHQ lands in
titles, meta descriptions and OG `siteName` only. The rendered wordmark in the marketing
header/footer, login, `PortalNav`, `/go`, and `icon.svg` is untouched — smallest diff, no risk to
flows 3 and 4.

### 2.3 Manual steps — these cannot be done from this repo

1. **Buy/confirm `snaghq.co.nz`** and verify ownership with the registrar.
2. **Netlify → the `apps/web` site → Domain management** → add `www.snaghq.co.nz`, set it primary,
   let Netlify provision TLS.
3. **DNS** → repoint `www.snaghq.co.nz` at Netlify. `PRODUCTION_READINESS.md:256` records it
   currently resolving to `27.124.125.171`, which is not Netlify. Add the apex redirect too.
4. **Verify the handoff before touching the function**, as its own header instructs:
   `curl -o /dev/null -w '%{http_code}\n' https://www.snaghq.co.nz/go/snag/<any-uuid>` — 200 or 307
   is go, 404 means the portal build hasn't caught up.
5. **Then** set the `SNAG_PORTAL_URL` function secret and redeploy `notify-snag`.
6. **Provision the `hello@snaghq.co.nz` mailbox** before this reaches production. The code change
   lands first; without the mailbox it swaps a working contact address for a bouncing one.
7. **Google Search Console** → add the property, submit `https://www.snaghq.co.nz/sitemap.xml`.
8. **Flow 2 — app store listing/ASO only.** Title, subtitle, keyword field, screenshots, and
   description in App Store Connect / Play Console. No repo change (§4.2).

### 2.4 SEO metadata plan

Voice: this repo's own — plain, concrete, NZ spelling ("organisation"), no "streamline"/"empower"/
"seamless". Descriptions ~150–160 characters. A `%s | SnagHQ` template on the root layout so each
page only declares its own leaf.

| Route | Title (as rendered) | Meta description | Target search intent |
|---|---|---|---|
| root default | `SnagHQ — workplace health & safety reporting` | Report hazards from your phone. Investigate, verify, and close them with a record that holds up. Built for New Zealand HSWA 2015. | brand — "snaghq" |
| `/` | `Workplace health and safety software, New Zealand \| SnagHQ` | Workers report hazards from their phone in seconds. Supervisors triage, investigate, and close the loop — with a guided root-cause process for anything serious. | **primary** — "workplace health and safety software New Zealand", "hazard reporting app NZ" |
| `/pricing` | `Pricing \| SnagHQ` | Free for single-site teams — unlimited reports, investigations, and the full supervisor portal. Priced per organisation as you grow, never per seat. | "health and safety software pricing NZ"; the comparison search after a per-seat quote |
| `/sign-up` | `Create your organisation \| SnagHQ` | Set up your organisation in a minute. You'll be the first officer admin, and you can invite supervisors and workers once you're in. | conversion — bottom of funnel |
| `/privacy` | `Privacy Policy \| SnagHQ` | How SnagHQ handles your organisation's data. Full policy in progress — get in touch and we'll answer directly in the meantime. | trust / procurement lookups |
| `/terms` | `Terms of Service \| SnagHQ` | The terms covering use of SnagHQ. Full terms in progress — get in touch before signing up and we'll answer directly. | trust / procurement lookups |
| `/sign-up/check-email` | `Check your email \| SnagHQ` | *(inherits)* — `noindex, follow` | none; a transient state mid-sign-up |
| `/login` | `Log in \| SnagHQ` | *(inherits)* — `noindex, follow` | none; an entry point, not a landing page |
| `/unauthorized` | `Access restricted \| SnagHQ` | *(inherits)* — `noindex, nofollow` | none |
| `/go/snag/[id]` | `Open this snag \| SnagHQ` | *(inherits)* — `noindex, nofollow` | **must not be indexed** — one URL per snag id, reached only from an inbox |
| `(portal)/*` | `Dashboard`/`Snags`/`Reports`/`Documents`/`Snag` `\| SnagHQ` | *(inherits)* — `noindex, nofollow` at the layout | none |

**No OG share image in this pass.** A share graphic is design work, not an SEO fix, and a metadata
entry pointing at a file that doesn't exist ships a 404 on every page — which `e2e/public.spec.ts`
would correctly fail on. Noted as follow-up.

---

## 3. What was built

15 files: 3 new, 12 changed. `+218 / −7` excluding this document.

**New**

- `apps/web/src/lib/seo.ts` — `SITE_URL`, `absoluteUrl(path)`, and `canonical(path)` which returns
  `{ alternates, openGraph.url }` together so the two can't drift apart.
- `apps/web/src/app/sitemap.ts` — the five indexable public routes, absolute `<loc>`s.
- `apps/web/src/app/robots.ts` — allow `/`, disallow the portal paths, `/go/`, `/login`,
  `/unauthorized`, `/sign-up/check-email`; absolute `Sitemap:` line.

**Changed** — root `layout.tsx` (metadataBase, title template, OG defaults, `lang="en-NZ"`); the
six marketing routes; `login`, `unauthorized`, `go/snag/[id]`; `(portal)/layout.tsx` plus five
portal page titles; `PRODUCT_REVIEW.md`.

### Three defects caught by verifying rather than asserting

Each of these was in the approved plan, shipped, and then found by actually inspecting the rendered
output. Recorded because the plan's own comments asserted the opposite in two cases.

1. **`<loc>` in `sitemap.ts` was relative** — `<loc>/</loc>`. `metadataBase` does **not** reach
   sitemap.ts; relative paths are emitted verbatim, and a sitemap with relative locs is rejected
   wholesale rather than partially. The failure would have been every URL, silently, in a file
   nothing else reads. My original comment claimed metadataBase covered it; it was wrong. Fixed
   with `absoluteUrl()`.
2. **The `Sitemap:` line in `robots.txt` was relative** — same cause, same fix. That directive is
   specified as a full URL and crawlers ignore a relative one.
3. **`og:url` was the homepage on every page.** Setting `openGraph.url` on the root layout means
   every child inherits it verbatim, so `/pricing` shared into Slack or LinkedIn claimed to be `/`
   and the two collapsed into one entity. Fixed by removing the root default and giving each page
   its own via `canonical()`.

All three are verified fixed in §4.

---

## 4. Self-review against the four flows

Method: rebuild, then read the actual rendered output rather than trusting the source; then run the
existing e2e suite. Where I could not verify something, it says so rather than being asserted.

**Suite result: 33 passed, 6 skipped, 0 failed** (`public`, `a11y`, `handoff`, `auth-gate` — light,
dark, and mobile-viewport projects). The 6 skips are the authenticated specs, which need
`E2E_EMAIL`/`E2E_PASSWORD`; those credentials are not available in this environment. That limits
flows 3 and 4 to diff-level review — see §4.3 and §4.4, where it is stated rather than papered over.

A note on how the suite was run, because the first attempt looked like a regression and wasn't. Run
against a production `next start` build, `public.spec.ts` fails 6 tests on aborted RSC prefetches.
I stashed the entire change, rebuilt unmodified `main`, and got **the identical 6 failures** — it is
an artefact of running a production build against a suite whose `webServer` uses `next dev` (where
link prefetch is off), not of this diff. Re-run the intended way, everything passes.

### 4.1 Flow 1 — search → landing → sign-up ✅ verified

The one flow this PR is meant to change.

- **Metadata is live on the landing page.** `curl` of `/` returns
  `<title>Workplace health and safety software, New Zealand | SnagHQ</title>`, the distinct
  description, `og:site_name=SnagHQ`, `og:locale=en_NZ`, `og:type=website`, and
  `<link rel="canonical" href="https://www.snaghq.co.nz">`. Six distinct titles and six distinct
  descriptions across the marketing routes, verified route by route.
- **`og:url` and canonical agree, per page, absolute** — `/pricing` → both
  `https://www.snaghq.co.nz/pricing`; likewise `/privacy`, `/terms`, `/sign-up`. This is defect 3
  above, re-verified after the fix.
- **`sitemap.xml` and `robots.txt`** serve absolute URLs — five `<loc>`s from
  `https://www.snaghq.co.nz/` down, and `Sitemap: https://www.snaghq.co.nz/sitemap.xml`. Defects 1
  and 2, re-verified.
- **The path to sign-up still works.** `apps/web/src/app/(marketing)/layout.tsx` is unchanged apart
  from `CONTACT_EMAIL`; the header's `<LinkButton href="/sign-up">Get started</LinkButton>` and the
  hero's `<LinkButton href="/sign-up">Start reporting</LinkButton>` in `(marketing)/page.tsx` are
  untouched. `public.spec.ts` passes on all six public routes (200, expected heading, no console
  errors, no failed subresource, no horizontal overflow) and its "marketing pages are reachable from
  the landing page" navigation test passes.
- **No accessibility regression** — `a11y.spec.ts` clean on all six public routes plus the handoff,
  in light, dark, and mobile-viewport.
- **`/sign-up` is indexable and `/sign-up/check-email` is not**, which is the intended asymmetry:
  the form is a real destination, the "check your email" interstitial is not.

### 4.2 Flow 2 — app store → download the Snag mobile app ✅ confirmed, no code change needed, stated explicitly

**Confirmed: nothing in this repo needs to change for flow 2, and nothing was changed for it.**

Discoverability in the App Store and Play Store is driven by the store listing — app name,
subtitle, keyword field, category, screenshots, description — which lives in App Store Connect and
Google Play Console, not in source. `apps/mobile/app.json` carries the bundle identity, but editing
it would (a) be a change to `apps/mobile`, which the brief prohibits, and (b) not affect store
search ranking. Web SEO and app-store ASO are separate indexes; `sitemap.ts`/`robots.ts` have no
bearing on either store.

Listed as manual step 8 in §2.3 so it isn't lost. I did not invent a code change to make this flow
look addressed.

### 4.3 Flow 3 — portal document upload → attach → open on mobile ⚠️ reviewed by diff; not exercised end to end

Unchanged, and here is the evidence rather than the assertion:

- **No file in the upload/attach path was edited.** `git diff --stat` touches no
  `(portal)/documents/actions.ts`, no `(portal)/snags/[id]/document-actions.ts`, no
  `packages/supabase-queries`, no `supabase/` migration, RPC, bucket or policy, and nothing in
  `apps/mobile`.
- **The two shared things I did edit are head-only.** `app/layout.tsx` is shared by every route in
  the app; the change is confined to the `metadata` export plus `lang="en"` → `lang="en-NZ"` on
  `<html>`. The component body (`<body>{children}</body>`) is byte-identical, so nothing about how
  portal pages render changed. `(portal)/layout.tsx` gained a `metadata` export above the
  component; `PortalLayout` itself, including `requireSupervisorOrAdmin()`, is untouched.
- **No shared component was edited.** Nothing in `src/components/`, no `*.module.css`, no
  `globals.css`, no `middleware.ts`, no `src/lib/auth.ts`.
- `apps/web` type-checks clean (`tsc --noEmit`) and builds clean; all 19 routes still generate.

**What I could not do:** run `documents.spec.ts` or `investigation-document.spec.ts`, which are the
specs that actually exercise this round trip. They skip without `E2E_EMAIL`/`E2E_PASSWORD`, which
this environment doesn't have. **Recommend running both against a real session before merge.** I
believe the flow is unaffected and the reasoning above is why, but I have not observed it working.

### 4.4 Flow 4 — portal login → dashboard / snags / reports ⚠️ partly verified; auth-gated portion by diff

- **Verified by test:** `auth-gate.spec.ts` passes in full — `/snags`, `/reports`, `/documents` all
  still redirect an anonymous visitor to `/login`; a snag detail page is still not readable
  anonymously; `/reports/export` and `/reports/export-csv` still refuse GET and anonymous POST; and
  "the unauthorized page explains itself" passes, which matters because I changed that page's button
  copy. `public.spec.ts`'s login-form and bad-credentials tests pass. `handoff.spec.ts`'s anonymous
  cases pass, including the one asserting `/login?next=` still carries the snag path through — the
  `/go` page was edited, so this was the specific risk.
- **`login/actions.ts`, `src/lib/auth.ts`, `src/lib/nextPath.ts`, `middleware.ts` — untouched.** The
  edit to `login/page.tsx` is a `metadata` export above the component.
- **One deliberate deviation from the approved plan, and it is a regression I caused.** Giving the
  root layout a marketing `title.default` meant every portal tab would read
  "SnagHQ — workplace health & safety reporting". I added five one-line `title` exports
  (`Dashboard`, `Snags`, `Reports`, `Documents`, `Snag`) and a `robots: { index: false, follow: false }`
  on `(portal)/layout.tsx`. The plan said `(portal)` would be untouched; fixing a regression I
  introduced seemed better than shipping it, but flagging it since it widens the diff beyond what
  was approved.
- **Not verified:** the signed-in portal pages themselves. `portal.spec.ts` and the portal half of
  `a11y.spec.ts` skip without credentials. The changes to those five files are a single metadata
  export each, added above the default export and changing no rendered markup — but again, I have
  not watched a dashboard load.

### 4.5 Things I am not fully certain about

Stated rather than smoothed over.

- **The two authenticated e2e suites did not run** (§4.3, §4.4). This is the biggest gap in this
  review. Flows 3 and 4 are reviewed by diff and by build, not observed.
- **`hello@snaghq.co.nz` does not exist yet.** The code change lands ahead of the mailbox. If the
  domain isn't ready, hold that one line — it's `(marketing)/layout.tsx:8`, self-contained.
- **`lang="en"` → `lang="en-NZ"`** is a small change I made beyond the letter of the plan, for
  consistency with `og:locale: en_NZ` and NZ search targeting. It's a valid BCP-47 tag and the axe
  a11y suite passes on it, but it does alter a root-level attribute that every page inherits, and
  it could in principle affect a screen reader's voice selection.
- **`metadataBase` is hardcoded** rather than read from an env var, so Netlify deploy previews will
  canonicalise to production. That's the correct trade-off for a single canonical domain (a preview
  that self-canonicalises is worse), but if you want previews to self-reference it needs an env-var
  design, and I'd rather ask than guess.
- **The canonical domain doesn't resolve yet** (`PRODUCTION_READINESS.md` D1). Nothing in this PR
  changes that — it only makes the repo agree with the decision already recorded. Until DNS moves,
  every canonical and OG URL points at a host that isn't serving.
- **Titles were not checked against live SERP truncation.** `/` renders at 59 characters, inside the
  usual ~60 limit, but Google measures pixels rather than characters and this is an estimate.
- **No OG image**, so link previews will render without a graphic until one is designed (§2.4).
