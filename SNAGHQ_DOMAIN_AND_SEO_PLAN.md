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

**Status: 1–4 are done.** `www.snaghq.co.nz` serves the site, the apex 301s to it, DNS is
Netlify-managed, and `/go/snag/<uuid>` answers 200 — so the "deploy the portal before the function"
precondition is met. §5 carries the step-by-step for what is left.

1. ~~Buy/confirm `snaghq.co.nz`.~~ ✅
2. ~~**Netlify → `snag-app-website`** → add `www.snaghq.co.nz`, set primary, provision TLS.~~ ✅
   Let's Encrypt issued a wildcard, `*.snaghq.co.nz` + apex.
3. ~~**DNS** → repoint at Netlify, add the apex redirect.~~ ✅ Netlify-managed.
4. ~~**Verify the handoff.**~~ ✅ 200.
5. **`app.snaghq.co.nz`** → Netlify → project `snagv1` → Domain management → add, set primary. The
   wildcard already covers it. Leave `snagv1.netlify.app` in place so it 301s — **printed site QR
   codes encode it** (§5.1).
6. **Set `SNAG_PORTAL_URL` and `SNAG_FROM_ADDRESS`**, then redeploy `notify-snag` (§5.4).
7. **Provision `hello@snaghq.co.nz`** (§5.3). It is published in the marketing footer and bounces
   until this is done.
8. **Google Search Console** → add the property, submit `https://www.snaghq.co.nz/sitemap.xml`.
9. **Flow 2 — app store listing/ASO only.** Title, subtitle, keyword field, screenshots, and
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
- ~~**The canonical domain doesn't resolve yet.**~~ **Resolved.** `www.snaghq.co.nz` serves the site,
  the apex 301s to it, TLS is a Let's Encrypt wildcard, and `/go/snag/<uuid>` answers 200 — verified
  by request, not assumed. Every canonical and OG URL now points somewhere real. `app.snaghq.co.nz`
  is the remaining host; see §5.
- **Titles were not checked against live SERP truncation.** `/` renders at 59 characters, inside the
  usual ~60 limit, but Google measures pixels rather than characters and this is an estimate.
- **No OG image**, so link previews will render without a graphic until one is designed (§2.4).

---

## 5. Service setup — the third-party dependencies

Everything here is dashboard work. Nothing in this section can be done from the repo, and most of it
cannot be done through the MCP tooling either, so it is written out rather than assumed.

Hosts, for reference — three, and they are not interchangeable (see `CLAUDE.md` § Hosts):

| Host | Serves | Netlify project |
|---|---|---|
| `www.snaghq.co.nz` | `apps/web` — marketing + portal | `snag-app-website` |
| `app.snaghq.co.nz` | `apps/mobile` Expo web export | `snagv1` |
| `snagv1.netlify.app` | the app's former host — must keep redirecting | `snagv1` |

### 5.1 Netlify

**`app.snaghq.co.nz`** — project `snagv1` → Domain management → add as a custom domain, set primary.
No certificate wait; the wildcard issued for `snag-app-website` covers it.

**Do not remove `snagv1.netlify.app`.** Netlify will 301 it to the new primary, preserving path and
query, and that redirect is load-bearing twice over: **site QR codes encoding it have been printed
and put up on walls**, and every notification sent before the move carries it. Verify the redirect
keeps the query string, because the QR landing depends on `?report=<token>`:

```bash
curl -sI "https://snagv1.netlify.app/?report=test" | grep -i location
#   → https://app.snaghq.co.nz/?report=test
```

**Environment variables** — project `snag-app-website` → Site settings → Environment variables:

| Key | Value |
|---|---|
| `NEXT_PUBLIC_SNAG_APP_URL` | `https://app.snaghq.co.nz` |
| `NEXT_PUBLIC_SUPABASE_URL` | already set |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | already set |

Never point `NEXT_PUBLIC_SNAG_APP_URL` at the portal host — `/go` only uses it for visitors it has
already decided cannot use the portal, so that creates a redirect loop. `e2e/handoff.spec.ts` asserts
against exactly this.

### 5.2 Resend — sending domain

The domain object already exists (`snaghq.co.nz`, `ap-northeast-1`, click and open tracking off —
tracking rewrites links, and nothing should sit between a supervisor and an incident notification).
What remains is DNS and verification.

Add in Netlify DNS, zone `snaghq.co.nz`:

| Type | Name | Value | Priority |
|---|---|---|---|
| TXT | `resend._domainkey` | the DKIM public key from the Resend dashboard | — |
| MX | `send` | `feedback-smtp.ap-northeast-1.amazonses.com` | 10 |
| TXT | `send` | `v=spf1 include:amazonses.com ~all` | — |

Then **resend.com → Domains → snaghq.co.nz → Verify**. Records go green individually.

**API key** — Resend → API Keys. One must exist with send permission, and if it is domain-scoped it
must cover `snaghq.co.nz`. Its value is `RESEND_API_KEY` in Supabase. Check whether that secret is
already set before minting a new one: `sendEmail` skips silently when it is missing, logging to the
function console and returning normally, so the failure is invisible from the app.

### 5.3 Google Workspace — `hello@snaghq.co.nz`

1. **workspace.google.com** → start a trial → "I have a domain" → `snaghq.co.nz`.
2. **Verify ownership** — Google issues a root TXT record; add it in Netlify DNS.
3. **MX on the root (`@`)**. Current Google guidance is a single record, `smtp.google.com` priority
   `1`, replacing the older five-record ASPMX set. Use whatever the setup wizard shows — it is
   authoritative and this changed relatively recently.
4. **Create `hello@`**, as a user or as an alias on an existing account.
5. **DKIM** — Admin console → Apps → Google Workspace → Gmail → Authenticate email. Generate and
   publish `google._domainkey`. Easy to miss; Workspace does not do it for you.

Three things that look like conflicts and are not:

- **Two sets of MX records is correct.** Google's on the root, Resend's `feedback-smtp` on `send`.
  Different names, different jobs — Resend's only handles bounces.
- **Two SPF records on *different names* is correct; two on the *same* name is not.** Root gets
  `v=spf1 include:_spf.google.com ~all`, `send` gets `v=spf1 include:amazonses.com ~all`. Never
  merge them.
- **DKIM selectors don't collide** — `resend._domainkey` and `google._domainkey`.

Once both senders verify, add **DMARC**: TXT on `_dmarc`,
`v=DMARC1; p=none; rua=mailto:hello@snaghq.co.nz`. Stay at `p=none` and read the reports for a
couple of weeks before tightening. Going straight to enforcement with two freshly configured senders
is how an organisation silently drops its own incident notifications.

### 5.4 Supabase — project `wpkdpukpllxuyqqlxkxf` (Snagv1)

**Authentication → URL Configuration.** Nothing in either client passes `emailRedirectTo`, so *every*
confirmation and recovery link goes to **Site URL**:

- Site URL → `https://www.snaghq.co.nz` (sign-up happens on the marketing site and makes the person
  an officer admin, so the portal is where confirming should land them)
- Additional redirect URLs → `https://app.snaghq.co.nz/**`, `https://snagv1.netlify.app/**`,
  `http://localhost:8081/**`

A consequence worth knowing: someone who signs up *in the mobile app* also confirms onto the portal.
Pre-existing rather than caused by the move, and fixable later with an explicit `emailRedirectTo`
per client.

**Edge Functions → Secrets:**

| Secret | Value | Notes |
|---|---|---|
| `SNAG_PORTAL_URL` | `https://www.snaghq.co.nz` | where every notification link points |
| `SNAG_FROM_ADDRESS` | `SnagHQ <notifications@snaghq.co.nz>` | set only after Resend verifies |
| `RESEND_API_KEY` | from §5.2 | without it, no mail is sent and nothing says so |
| `SNAG_INTERNAL_SECRET` | existing | gates the function against the DB triggers; without it every call is 403 |

**Then redeploy `notify-snag`.** Order matters and the function's own header says so: confirm the
handoff answers on the target host *first*, because these links are only ever followed from an
inbox — a mismatch is invisible to the app, to CI, and to anyone not reading their email.

```bash
curl -o /dev/null -w '%{http_code}\n' https://www.snaghq.co.nz/go/snag/<any-uuid>
# 200 = the chooser, 307 = a signed-in supervisor, 404 = the portal build hasn't caught up
```

**The redeploy changes behaviour beyond the domain.** The deployed function is v14, which predates
the `/go` handoff entirely and mails `serious_created` to *every member of the snag's site*. The
repo version mails the nominated serious-incident owners, falling back to site members only if an
org has none. That is the intended design (`CLAUDE.md` § Who owns a serious incident) — but it
changes who is told about a hazard, so it is worth doing deliberately rather than as a side effect.

**Authentication → Policies → Leaked password protection** — decided "on" in
`PRODUCTION_READINESS.md` D2 and still outstanding. No API for it; dashboard only.

### 5.5 Checking DNS without `dig`

The sandbox has no DNS tooling and routes HTTP through a proxy, so DNS-over-HTTPS is the way to
verify records from a shell:

```bash
for r in "app.snaghq.co.nz:A" "resend._domainkey.snaghq.co.nz:TXT" \
         "send.snaghq.co.nz:TXT" "snaghq.co.nz:MX" "_dmarc.snaghq.co.nz:TXT"; do
  echo -n "${r} -> "
  curl -s "https://dns.google/resolve?name=${r%%:*}&type=${r##*:}" \
    | python3 -c "import sys,json;d=json.load(sys.stdin);print(', '.join(a.get('data','') for a in d.get('Answer',[])) or 'NO ANSWER')"
done
```
