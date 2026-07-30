# SNAG Architecture Audit

**Date:** 2026-07-30 · **Branch audited:** `claude/snag-architecture-audit-dqe6qd` (identical tree to `origin/main`, `0622f07`) · **Investigation only — nothing was modified.**

---

## Verdict

**On `main`, the repo matches the intended design** — one `apps/web` Next.js app with a public `(marketing)` route group and an auth-gated `(portal)` route group; no standalone portal app or portal deployment exists. **The drift is in git, not in the tree**: an unmerged long-lived branch named `website` carries a *third* client — a separate Astro marketing site at `apps/marketing`, branded "Docunation", built from the pre-monorepo layout, with its own `netlify.toml` that instructs someone to create a Netlify site whose **production branch is `website`**. If that site was ever created in the Netlify dashboard, a second marketing system is live off a branch that is 85 commits behind `main` and cannot receive any fix made since 2026-07-13.

---

## 1. Monorepo structure

`package.json` (root) declares npm — not pnpm — workspaces:

```json
{
  "name": "snag",
  "private": true,
  "workspaces": ["apps/*", "packages/*"]
}
```

Everything under `apps/` and `packages/` on `main`:

```
apps/
├── mobile/        @snag/mobile   — Expo SDK 54 / RN 0.81
└── web/           @snag/web      — Next.js 16 (App Router)
packages/
├── shared-types/       @snag/shared-types      (src/index.ts only)
└── supabase-queries/   @snag/supabase-queries  (src/index.ts only)
```

**No app folder beyond `mobile` and `web`. No `portal` folder anywhere in the working tree, and none in `main`'s history** — `git log --all -- apps/portal` returns nothing.

Note for the record: the planning-session description said "pnpm monorepo". It is npm workspaces (`package-lock.json` at root, no `pnpm-workspace.yaml`). Cosmetic, but it means `pnpm -r` commands in any doc or runbook are wrong.

## 2. `apps/web` internals — route group structure

The split is clean and real. Full route tree:

```
apps/web/src/app/
├── layout.tsx                          # root layout (fonts, globals.css)
├── globals.css  icon.svg
├── (marketing)/                        # PUBLIC — no auth gate
│   ├── layout.tsx  layout.module.css   # header/footer, links to /login, /sign-up
│   ├── page.tsx    page.module.css     # landing
│   ├── pricing/page.tsx
│   ├── privacy/page.tsx
│   ├── terms/page.tsx
│   └── sign-up/
│       ├── page.tsx   actions.ts       # createOrganisationAndOwner
│       └── check-email/page.tsx
├── (portal)/                           # AUTH-GATED — supervisor/officer_admin
│   ├── layout.tsx                      # calls requireSupervisorOrAdmin()
│   ├── actions.ts                      # signOutAction, switchOrgAction
│   ├── dashboard/page.tsx
│   ├── snags/page.tsx  actions.ts
│   ├── snags/[id]/page.tsx  + actions.ts, capa-actions.ts,
│   │                          debrief-actions.ts, document-actions.ts,
│   │                          investigation-actions.ts, rca-actions.ts
│   ├── reports/page.tsx  export/route.ts  export-csv/route.ts
│   └── documents/page.tsx  actions.ts
├── login/          page.tsx  actions.ts    # shared on-ramp, outside both groups
├── unauthorized/   page.tsx                # where workers land
└── go/snag/[id]/   page.tsx                # notification handoff, deliberately
                                            # outside (portal)
```

The gate is enforced once, at the group layout — `apps/web/src/app/(portal)/layout.tsx:6`:

```tsx
const { email, activeMembership, memberships } = await requireSupervisorOrAdmin();
```

and `apps/web/src/lib/auth.ts:18-32` does the two redirects (unauthenticated → `/login`, `role === 'worker'` → `/unauthorized`). `apps/web/middleware.ts` refreshes the session cookie on every non-static request. **One app, two groups, one gate — as designed.**

## 3. Git / branch structure

Local:

```
* claude/snag-architecture-audit-dqe6qd
  main
  remotes/origin/claude/snag-architecture-audit-dqe6qd
  remotes/origin/main
```

`git ls-remote --heads origin` shows **19 remote branches**. Merged-into-`main` status, with divergence (`main-only / branch-only` commits) and tip date:

| Branch | Merged? | main↔branch | Tip |
|---|---|---|---|
| `main` | — | — | `0622f07` |
| `website` | **NO** | 85 / 1 | 2026-07-13 |
| `claude/check-netlify-deploy-RLYrr` | NO | 89 / 23 | 2026-03-19 |
| `claude/optimize-snag-photo-save-XR4g3` | NO | 89 / 23 | 2026-03-19 |
| `claude/snag-performance-audit-Ps99H` | NO | 89 / 27 | 2026-03-23 |
| `claude/document-review-implement-igblx4` | NO | 89 / 35 | 2026-07-04 |
| `claude/snag-ui-redesign-audit-bbwquh` | NO | 89 / 33 | 2026-07-06 |
| `claude/snag-shortfalls-resolution-recode-kd52tg` | NO | 89 / 44 | 2026-07-08 |
| `claude/snag-serious-lane-refresh-0kozrb` | NO | 0 / 1 | 2026-07-30 (current, off tip) |
| `claude/snag-document-library-access-tcgtik` | NO | 0 / 2 | 2026-07-30 (current, off tip) |
| 8 other `claude/*` branches | MERGED | — | — |

The **workflow is trunk-based**: `apps/web` was built entirely on `main` through short-lived `claude/*` branches merged via PRs (`541c987 Scaffold apps/web` → `cbeaba1` → `36c12e8` → `eabe2c7` → `9a4f644`, all reachable from `main`; PRs #16–#21 all from `claude/snag-web-app-plan-xnw4fj`). Recent history is linear squash-merges (`#24`, `#25`, `#26`, `#27`).

The exception is `website`, and it is not a stale duplicate of merged work — it contains a commit that exists nowhere else:

```
$ git merge-base origin/main origin/website
52c7b02 Paginate the Snags list; aggregate org stats server-side

$ git log -1 --format='%ci %s' origin/website
2026-07-13 00:22:36 +0000  Add SNAG marketing site v1 (apps/marketing)

$ git log --oneline --all -- apps/marketing
8271c71 Add SNAG marketing site v1 (apps/marketing)     # only on `website`
```

Its root tree is **pre-monorepo** (`App.tsx`, `src/`, `netlify.toml` at the repo root — the layout `main` abandoned when it became a workspaces monorepo), so it cannot be fast-forwarded or trivially merged; a merge would collide with the entire restructure.

## 4. Deployment config

Two `netlify.toml` files exist on `main`, one per app — **two Netlify sites, both fed from `main`**, distinguished only by the "Base directory" set in the Netlify dashboard (not in the repo).

`apps/mobile/netlify.toml` — static Expo web export:

```toml
[build]
  command = "npx expo export --platform web"
  publish = "dist"
[build.environment]
  NODE_VERSION = "22"
[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200
```

`apps/web/netlify.toml` — Netlify's built-in Next.js runtime, no explicit build/publish:

```toml
# This is a SEPARATE Netlify site from apps/mobile's — its "Base directory"
# must be set to apps/web in the Netlify dashboard.
[build.environment]
  NODE_VERSION = "22"
```

A **third** config exists on the `website` branch only — `apps/marketing/netlify.toml`, which asks for a site pinned to that branch:

```toml
# Netlify site for the marketing site.
# Create a NEW Netlify site pointing at this repo with:
#   - Production branch: website
#   - Base directory:    apps/marketing
[build]
  command = "npm run build"     # astro build
  publish = "dist"
```

Whether that site exists is not answerable from the repo — Netlify site inventory lives in the dashboard. **This is the single highest-value thing to check outside the codebase.**

Known/implied hostnames, which do not agree with one another:

| URL | Where it comes from | Points at |
|---|---|---|
| `https://www.snaghq.co.nz` | `supabase/functions/notify-snag/index.ts:33` (default for `SNAG_PORTAL_URL`) | portal (`apps/web`) |
| `https://snagv1.netlify.app` | `apps/web/src/app/go/snag/[id]/page.tsx:27`, `apps/web/.env.example` | mobile web build (`apps/mobile`) |
| `getsnag.co.nz` (placeholder) | `apps/marketing/src/config.ts` comment + `netlify.toml` comment, `website` branch | orphaned Astro site |

`notify-snag/index.ts:16-33` also warns the portal must be deployed *before* the function, since every notification link is `<portal>/go/snag/<id>`.

CI (`.github/workflows/ci.yml`) runs on `push: [main]` and all PRs: typecheck both workspaces, mobile unit, mobile E2E, web E2E, web build. **Nothing in CI touches `apps/marketing`** — the `website` branch has no CI coverage for its own contents on `main`'s workflow, and its branch-local workflow predates the current one.

## 5. Supabase client usage

There are exactly **two** client instantiation sites, one per app, both reading env vars — **no hardcoded project URL anywhere in the repo** (`grep -rn "supabase\.co" apps packages supabase` over `.ts/.tsx/.js/.json/.toml` returns zero hits).

| App | File | Constructor | Env vars |
|---|---|---|---|
| mobile | `apps/mobile/src/lib/supabase.ts:13-14` | `createClient` (`@supabase/supabase-js`) + AsyncStorage + `fetchWithTimeout` deadlines | `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY` |
| web (browser) | `apps/web/src/lib/supabase/client.ts:6-9` | `createBrowserClient` (`@supabase/ssr`) | `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| web (server) | `apps/web/src/lib/supabase/server.ts:8-10` | `createServerClient`, cookie-backed | same |
| web (middleware) | `apps/web/src/lib/supabase/middleware.ts:10-12` | `createServerClient`, cookie refresh | same |

Three constructors in `apps/web` is the documented `@supabase/ssr` pattern (browser / RSC+actions / middleware), not duplication.

**Both point at the same project.** The evidence is threefold: `apps/web/.env.example` names it explicitly —

```
# ... must be the Snagv1 project, wpkdpukpllxuyqqlxkxf, not the inactive prototype project
```

— `CLAUDE.md:114`, `SNAG_WEB_APP_PLAN.md:149`, `PRODUCTION_READINESS.md:18` all name `wpkdpukpllxuyqqlxkxf`; and CI feeds the **same secrets** to both apps (`.github/workflows/ci.yml`, mobile job):

```yaml
EXPO_PUBLIC_SUPABASE_URL: ${{ secrets.NEXT_PUBLIC_SUPABASE_URL }}
EXPO_PUBLIC_SUPABASE_ANON_KEY: ${{ secrets.NEXT_PUBLIC_SUPABASE_ANON_KEY }}
```

The orphaned `apps/marketing` on `website` has **no Supabase usage at all** (`git grep -i supabase 8271c71 -- apps/marketing` → no hits), so it is not a third client against a wrong project — it is a static brochure. Runtime values in each Netlify site's dashboard were not verifiable from here; the repo cannot prove production is pointed where `.env.example` says.

## 6. Shared packages

`packages/supabase-client` **does not exist**; the equivalent is `packages/supabase-queries`. Each package is a single source file consumed directly as TypeScript (`"main": "src/index.ts"`, no build step):

```
packages/shared-types/{package.json,tsconfig.json,src/index.ts}
packages/supabase-queries/{package.json,tsconfig.json,src/index.ts}   # deps: @snag/shared-types
```

**`apps/web` genuinely imports both — 29 import sites, not a duplicate.** Every portal page, every server action, and the marketing sign-up flow go through them:

```
apps/web/src/lib/auth.ts:2                          getMemberships, type Membership   @snag/supabase-queries
apps/web/src/app/(portal)/dashboard/page.tsx:2      getOrgStats, getSiteBreakdown
apps/web/src/app/(portal)/reports/page.tsx:1        getOrgStats, getOrgSnagTrend
apps/web/src/app/(portal)/documents/page.tsx:1      getOrgDocuments, getOrgDocumentUrl
apps/web/src/app/(portal)/snags/[id]/page.tsx:9,14  (queries + shared-types)
apps/web/src/app/(marketing)/sign-up/actions.ts:5   createOrganisationAndOwner
apps/web/src/app/go/snag/[id]/page.tsx:2            SNAG_STEP_KEYS, SnagStepKey       @snag/shared-types
apps/web/src/components/{Badge,TriageDialog,PortalNav}.tsx                            (both)
… + capa/debrief/document/investigation/rca action files
```

No local re-declaration of `Snag`, `SnagStatus`, `Membership` etc. in `apps/web` — the only `@supabase/*` imports outside `src/lib/supabase/` are none.

Mobile consumes the same packages by re-export rather than directly:
- `apps/mobile/src/types/index.ts` is four lines: `export * from '@snag/shared-types';`
- `apps/mobile/src/lib/supabase.ts:5` imports `* as queries` and re-exports each bound to its own client (`export const getOrgStats = (orgId) => queries.getOrgStats(supabase, orgId)` — ~60 such wrappers).

Two clients, one query layer, one type layer. **This part of the design held.**

## 7. Document / template flow

### Upload (portal)

`apps/web/src/app/(portal)/documents/actions.ts:9-38`:

```ts
const BUCKET = 'org-documents';
const { activeMembership } = await requireSupervisorOrAdmin();
const path = `${activeMembership.org_id}/${Date.now()}-${file.name}`;
await supabase.storage.from(BUCKET).upload(path, file, { upsert: false });
const { error: recordError } = await createOrgDocument(supabase, path, title, category);
if (recordError) { await supabase.storage.from(BUCKET).remove([path]); … }   // orphan cleanup
```

Storage object first, then metadata row via the RPC, with rollback if the row fails. Delete is the inverse order (RPC first, then object) and re-reads `file_path` from the row rather than trusting the form field — `documents/actions.ts:41-79`.

### Attach to an investigation

`apps/web/src/app/(portal)/snags/[id]/document-actions.ts` has three actions:
- `attachInvestigationDocumentAction` — attaches something already in the library
- `uploadInvestigationDocumentAction` — `uploadOrgDocumentFile` → `createOrgDocument(…, 'investigation')` → `attachInvestigationDocument`; the file lands in the **org-wide library**, not a per-snag store
- `acceptInvestigationDocumentAction` — `accept_investigation_document`

Mobile does the same three through `apps/mobile/src/components/InvestigationDocumentPanel.tsx` (`getOrgDocuments`, `createOrgDocument`, `uploadOrgDocumentFromUri`, `attachInvestigationDocument`, `acceptInvestigationDocument`), plus a standalone library screen at `apps/mobile/src/screens/DocumentLibraryScreen.tsx`.

### Read-back (both clients, one query)

`packages/supabase-queries/src/index.ts:353-386` — `getInvestigationState` joins the document through the FK:

```ts
client.from('investigations').select(`
  root_cause_text, mode, lead_investigator_id,
  document_id, document_attached_by, document_accepted_by, document_accepted_at,
  document:org_documents!investigations_document_id_fkey ( title, file_path )
`).eq('snag_id', snagId).maybeSingle()
```

and `getOrgDocumentUrl` (`:643`) mints a 1-hour signed URL from the private bucket. Both clients call the same two functions.

### Buckets, RPCs, view

| Concern | Object |
|---|---|
| Bucket | `org-documents` (private) — investigation documents live here too, **not** in `snag-evidence` |
| Other buckets (unchanged) | `snag-photos`, `snag-evidence` |
| Table | `org_documents` (`org_id`, `uploaded_by`, `file_path`, `title`, `category`) |
| Write RPCs | `create_org_document`, `delete_org_document`, `attach_investigation_document`, `accept_investigation_document` |
| Read | direct `select` on `org_documents` (RLS-scoped) + the `investigations` join above |

### RLS — same policies, no portal-specific duplicates

All of it is defined once in `supabase/migrations/20260722200000_org_documents.sql` and amended in place by later migrations. There is exactly one policy per verb:

```sql
create policy "org members can view their org's documents"
  on public.org_documents for select using (org_id = public.current_org_id());
-- no insert/update/delete policy: RPC-only writes, per the project convention

create policy "org members can view their org's documents bucket"   on storage.objects for select …
create policy "supervisors and admins can upload …"                 on storage.objects for insert …   -- REPLACED, below
create policy "supervisors and admins can delete …"                 on storage.objects for delete …
```

`20260729000000_worker_document_upload_and_independent_acceptance.sql` **drops and replaces** the insert policy rather than adding a parallel one:

```sql
drop policy if exists "supervisors and admins can upload to their org's documents buck" on storage.objects;
create policy "org members can upload to their org's documents bucket"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'org-documents'
              and (storage.foldername(name))[1] = (public.current_org_id())::text);
```

and drops the role check from `create_org_document` at the same time. Gating on the investigation side follows the doing/directing split described in `CLAUDE.md`: `attach_investigation_document` uses `require_investigation_access` (`20260729000100:161`), while `accept_investigation_document` uses `require_serious_snag` (supervisor/admin). The independent-acceptance rule added in `…000000` was reverted by `20260729000200`.

Every policy is org-folder-scoped via `current_org_id()`, the same predicate used by `governance_reports` and the other buckets. **No portal-only policy, no portal-only table, no second bucket.**

---

## Drift & risk

**1. `apps/marketing` on the `website` branch — a second marketing system, unmerged and un-CI'd.** *(highest)*
An entire Astro 5 + Tailwind 4 site (43 files: 10 pages, a blog with content collections, 7 components, social-card renderer, `og.png` assets) sitting on a branch 85 commits behind `main`, whose only commit is `8271c71` (2026-07-13). It duplicates by function what `apps/web/(marketing)` now serves — landing, pricing, privacy, terms — and adds pages `apps/web` doesn't have (`features`, `contact`, `blog/*`, `thanks`, `docunation`). Three specific hazards:
- Its `netlify.toml` instructs a site pinned to **production branch `website`**. If that site exists, it is publishing from a branch nobody merges to, and no fix on `main` reaches it.
- It uses a **different stack** (Astro + Tailwind) from `apps/web`'s hand-rolled CSS-Modules design system, and a **different brand** (`name: 'Docunation'`, `package.json` name `docunation-marketing`, `contactEmail: hello@docunation.example`) — so it cannot be lifted into `apps/web` without a rewrite or a framework decision.
- Its parent tree is **pre-monorepo** (root `App.tsx`/`src/`), so it cannot be merged; only cherry-picked or re-created.

**2. Three candidate production hostnames, none of which agree.** `www.snaghq.co.nz` (portal default in `notify-snag`, DNS "aspirational" per its own comment), `snagv1.netlify.app` (mobile web build), `getsnag.co.nz` (placeholder on the orphaned branch). Every notification link resolves through `SNAG_PORTAL_URL` and fails silently — the function's own header says a 404 there is invisible to the app and to CI.

**3. Six abandoned `claude/*` branches, 23–44 commits of unmerged work each, 89 commits behind `main`.** Tips from 2026-03-19, 03-19, 03-23, 07-04, 07-06, 07-08. Titles suggest real fixes were done on them (`Fix issue submission hang and admin tab loading`, `perf: UserProfileContext … eliminate ~15 duplicate auth queries`, `Public organisations: report without joining, plus RLS view fix`). Whether those fixes were later redone on `main` is not determinable from branch names — but if any weren't, the work is lost in place rather than merged. (Two further branches, `claude/snag-serious-lane-refresh-0kozrb` and `claude/snag-document-library-access-tcgtik`, are 1–2 commits off today's tip and are ordinary in-flight work, not drift.)

**4. Deployment topology lives only in the Netlify dashboard.** Both `netlify.toml` files depend on a "Base directory" set out-of-band; the repo cannot tell you how many sites exist, which branch each tracks, or what `NEXT_PUBLIC_SUPABASE_URL` each has. Everything in §4 and the runtime half of §5 is unverifiable from here.

**5. The org-document path convention is written out three times.** `packages/supabase-queries/src/index.ts:636` (`uploadOrgDocumentFile`), `apps/mobile/src/lib/supabase.ts:904` (`uploadOrgDocumentFromUri` — a genuine fork, since RN needs `readForUpload`), and inline in `apps/web/src/app/(portal)/documents/actions.ts:24`, which re-declares `const BUCKET = 'org-documents'` and rebuilds `${org_id}/${Date.now()}-${file.name}` by hand instead of calling the shared helper it already imports elsewhere (`document-actions.ts:47` does use it). Small, but it is the one place `apps/web` has quietly re-implemented a shared package.

**6. `/documents` upload is gated tighter on web than in SQL.** `uploadDocumentAction` calls `requireSupervisorOrAdmin()`, while `create_org_document` and the storage insert policy were deliberately widened to any org member in `20260729000000` so a worker running a document-mode investigation can file it. Not a live bug — the `(portal)` group refuses workers at the route level regardless — but the two layers now express different intents, and mobile is the only client honouring the wider one.

**7. Documented-vs-actual mismatches worth noting.** The stack is **npm workspaces, not pnpm**; `packages/supabase-client` does not exist (it is `packages/supabase-queries`). Both are naming drift in the surrounding docs rather than in the code.
