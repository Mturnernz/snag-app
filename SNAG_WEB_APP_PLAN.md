# SNAG `apps/web` — Plan (Marketing + Supervisor Portal)

Status: **draft for review — no code written yet.** Merges the Supabase-side investigation
(`SNAG_WEB_APP_SUPABASE_FINDINGS.md`, pulled 2026-07-23 from the live `Snagv1` project) with a
repo-side investigation done in Claude Code. Covers all of Step 1, then the Step 2 plan.

---

## 0. Read this first — the repo is not the monorepo the brief assumed

The originating brief assumed an existing monorepo (`pnpm-workspace.yaml`, `apps/mobile`,
`apps/web`, shared `packages/`). **That does not exist.** What's actually in the repo root today:

- A single flat Expo/React Native app — `App.tsx`, `src/`, `package.json`, `tsconfig.json` all
  live at the repo root. No `apps/`, no `packages/`, no `pnpm-workspace.yaml`, no `turbo.json`,
  no `workspaces` field in `package.json`. Dependencies are managed with plain **npm**
  (`package-lock.json`), not pnpm.
- **This app is already deployed to the web.** `netlify.toml` at the root runs
  `npx expo export --platform web` and publishes `dist/` — i.e. there is already a live Netlify
  site serving the *entire* RN app (react-native-web), including auth, the admin dashboard, and
  reports — not just mobile.
- There's already a first step toward a "web portal" experience inside that RN codebase:
  `src/hooks/useBreakpoint.ts` (a 768px breakpoint) is consumed by `AdminDashboardScreen.tsx` to
  render a wider layout on web/tablet. `ReportsScreen.tsx` already renders org stats and calls
  `exportGovernanceReport()` (the governance PDF edge function). So "supervisor views stats and
  pulls a report on the web" is not a green-field feature — a version of it ships today via RN-web.
- `packages/shared-types` and `packages/supabase-client` (Step 1 item 4) **don't exist.**
  `src/types/index.ts` and `src/lib/supabase.ts` are ordinary local modules inside the single app,
  not extracted packages. `src/lib/supabase.ts` also isn't directly reusable by a Next.js app as-is
  — it hardcodes `AsyncStorage` and `Platform.OS` branching for React Native's auth storage.

**Consequence:** "add `apps/web`" is really two projects — (a) turn this into a proper monorepo
so a Next.js app has somewhere to live and something to share, and (b) decide what happens to the
RN-web build that's already live on Netlify today. Section 1 and Section 8 below lay out a
recommendation for both; they're the biggest deviation from the original brief and are flagged as
**open decisions**, not settled facts — everything else in this plan can be built either way.

The rest of Step 1 (items 2, 3, 5 — schema, RPCs, storage) was already answered accurately by the
Supabase-side investigation; it's carried forward largely as-is in Sections 3–6, with the
report/export pattern (item 7) cross-checked against `ReportsScreen.tsx`'s actual usage.

---

## 1. Monorepo conversion (new — required before `apps/web` can exist)

**Recommendation: convert to an npm-workspaces monorepo**, not pnpm/turborepo — the repo already
uses npm (`package-lock.json`), and introducing a second package manager is unrelated churn.
npm workspaces is enough for two apps and two small shared packages.

```
snag/
├── package.json                 # root: "workspaces": ["apps/*", "packages/*"], shared devDeps
├── package-lock.json
├── apps/
│   ├── mobile/                  # current root app, moved here verbatim
│   │   ├── App.tsx
│   │   ├── src/                 # unchanged internals — only the containing path moves
│   │   ├── app.json, eas.json, babel.config.js, tsconfig.json
│   │   └── package.json         # unchanged deps, name: "@snag/mobile"
│   └── web/                     # new — see Section 2
├── packages/
│   ├── shared-types/            # extracted from apps/mobile/src/types/index.ts
│   └── supabase-queries/        # extracted read/write helpers from apps/mobile/src/lib/supabase.ts
├── supabase/                    # unchanged — migrations/functions stay at repo root, shared by both apps
└── CLAUDE.md, MVP-SPEC.md, etc. # unchanged
```

- The move of the mobile app into `apps/mobile/` is a **mechanical file relocation** — imports
  inside `src/` stay relative and unchanged; only `tsconfig.json`'s path alias base and CI/Netlify
  working directories need updating. No RN logic changes. This is why it's compatible with the
  brief's "no changes to `apps/mobile`" non-goal in spirit, even though the brief assumed that
  path already existed.
- `packages/shared-types`: a direct extraction of `src/types/index.ts` (enums, row interfaces,
  label maps). Both apps import from `@snag/shared-types` instead of relative paths.
- `packages/supabase-queries`: the **platform-agnostic** RPC/query wrapper functions currently in
  `src/lib/supabase.ts` (`getOrgStats`, `getSiteBreakdown`, `getSnagRca`, `getInvestigationState`,
  etc.) — everything that takes a `SupabaseClient` and returns typed data, with no
  `AsyncStorage`/`Platform.OS`/`expo-file-system` dependency. Client *construction* (the
  `createClient(...)` call with its RN-vs-web auth storage config) stays per-app:
  - `apps/mobile/src/lib/supabase.ts` keeps constructing the client the way it does today
    (AsyncStorage, `EXPO_PUBLIC_*` env vars) and re-exports the shared query functions.
  - `apps/web` constructs its own client with `@supabase/ssr` (Section 7) and imports the same
    shared query functions, calling them with its own client instance.
  Storage-upload helpers (`uploadSnagPhoto`, `getSnagPhotoUrl`) stay mobile-only for now —
  `expo-file-system` doesn't belong in a shared package, and the portal's document upload
  (Section 5) needs a browser-native version anyway.
- Root `package.json` gains a `workspaces` array; each app/package gets a `name` field
  (`@snag/mobile`, `@snag/web`, `@snag/shared-types`, `@snag/supabase-queries`). CI
  (`.github/workflows/eas-build.yml`) and `netlify.toml` need their working-directory /
  install-command updated to account for the new nesting (see Section 8).

This is real, if mechanical, work and touches every mobile source file's *path* even though not
its *content* — flagging it plainly as the first thing to sign off on before anything else here
proceeds.

---

## 2. `apps/web` folder structure (Next.js App Router)

```
apps/web/
├── package.json                 # name: "@snag/web"; next, react, @supabase/ssr, @supabase/supabase-js
├── next.config.js
├── tsconfig.json
├── .env.example                 # NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY
├── middleware.ts                # refreshes Supabase session cookie on every request (see Section 4)
├── src/
│   ├── app/
│   │   ├── layout.tsx           # root layout — no auth requirement here
│   │   ├── (marketing)/         # public route group
│   │   │   ├── layout.tsx       # marketing nav/footer
│   │   │   ├── page.tsx         # landing page
│   │   │   ├── pricing/page.tsx
│   │   │   └── sign-up/
│   │   │       ├── page.tsx           # email/password + org name form
│   │   │       └── actions.ts         # server action: auth.signUp → create_organisation_and_owner
│   │   ├── login/page.tsx       # shared login (portal entry point), not under either group
│   │   └── (portal)/            # auth-gated route group
│   │       ├── layout.tsx       # session check + role gate (supervisor/officer_admin only), org switcher
│   │       ├── dashboard/page.tsx        # get_org_stats / get_site_breakdown snapshot
│   │       ├── snags/
│   │       │   ├── page.tsx              # list — snags_with_details
│   │       │   └── [id]/page.tsx         # detail — snag + RCA/debrief/CAPA/comments/evidence
│   │       ├── reports/
│   │       │   ├── page.tsx              # governance report UI (mirrors ReportsScreen.tsx)
│   │       │   └── export/route.ts       # route handler: generate CSV, upload, record_*_export
│   │       └── documents/
│   │           ├── page.tsx              # document library (see Section 5 — scope open question)
│   │           └── upload/route.ts
│   ├── components/              # web-only UI (not shared with RN — different rendering primitives)
│   └── lib/
│       ├── supabase/
│       │   ├── client.ts        # browser client (@supabase/supabase-js + @supabase/ssr browser helpers)
│       │   ├── server.ts        # server client (@supabase/ssr, reads/writes cookies)
│       │   └── middleware.ts    # session-refresh helper used by middleware.ts
│       └── auth.ts               # requireSupervisorOrAdmin() guard used by (portal)/layout.tsx
```

Route groups match the brief's ask directly: `(marketing)` is public, `(portal)` is gated. `login`
sits outside both since it's the on-ramp between them.

---

## 3. Auth strategy — reuse existing `auth.users` / RLS, no new auth system

- Same Supabase project (`Snagv1`, `wpkdpukpllxuyqqlxkxf`), same `auth.users`, same anon key —
  confirmed by the Supabase-side investigation.
- Use **`@supabase/ssr`** (the standard Next.js App Router package), not the RN client's
  AsyncStorage-based setup — sessions live in cookies, refreshed by `middleware.ts` on every
  request per Supabase's documented Next.js pattern.
- **Sign-in**: `supabase.auth.signInWithPassword` — identical call to what
  `signInWithEmail` in `apps/mobile/src/lib/supabase.ts` already does; a worker or supervisor with
  an existing mobile account can log into the web portal with the same credentials, no migration.
- **Role gate**: `(portal)/layout.tsx` runs a server-side check before rendering any portal route
  — read the caller's role via `get_my_memberships()` (already exists, returns `role` +
  `is_active` per org) and redirect to `/login` (unauthenticated) or a "not authorized" page
  (authenticated `worker` role — the portal is supervisor/officer_admin only, matching the
  brief's "supervisor portal" framing). `officer_admin` already gets org-wide visibility for free
  via `can_view_site()`; no new visibility policy needed.
- **Org switching**: reuse `set_active_org(p_org_id)` exactly as mobile's `OrgSwitcherHeader` does
  — same RPC, same `user_active_org` row, so switching org in the portal and switching in the app
  stay consistent for a user who does both.
- No new session table, no new role model, no separate portal-only login.

---

## 4. Data access plan

**Reused as-is (no new backend work):**

| Need | Source |
|---|---|
| Org switcher | `get_my_memberships()` |
| Member list | `get_org_members()` |
| Dashboard snapshot | `get_org_stats(org_id)`, `get_org_snag_summary(org_id)`, `get_site_breakdown(org_id)` |
| Assignment dropdowns | `get_site_assignees(site_id)` |
| Snag list / detail | `snags_with_details` view (direct `select`, RLS-scoped) — same table mobile's `IssueListScreen`/`IssueDetailScreen` read |
| RCA / debrief / investigation / CAPA / comments / evidence | Direct table `select`s, RLS-scoped — same tables `getSnagRca`, `getSnagDebriefs`, `getInvestigationState`, `getCorrectiveActions` already read in `apps/mobile/src/lib/supabase.ts`. These functions move into `packages/supabase-queries` (Section 1) and `apps/web` calls them unchanged. |
| Governance report export | `export-governance-report` edge function (same as `ReportsScreen.tsx`'s `exportGovernanceReport`) → signed URL |
| Investigation file export | `export-investigation` edge function (same as `exportInvestigation`) → signed URL |

**Genuine gaps — new read-only additions:**

1. **Date-range / trend RPC** — `get_org_stats`/`get_site_breakdown` are snapshot-only. If the
   reporting screen needs a period comparison (e.g. "this quarter vs last," a monthly trend
   chart), that needs a new RPC, e.g. `get_org_snag_trend(p_org_id, p_start_date, p_end_date)`
   bucketed by week/month. **Open question for whoever reviews this plan:** does the reporting
   screen need trend/comparison, or is the current snapshot (which `ReportsScreen.tsx` already
   renders) enough for v1? Recommend deferring this RPC until the reporting UI is scoped, rather
   than building it speculatively.
2. **CSV/raw-data export** — for a "wide table, one row per snag" export, `snags_with_details`
   may already be sufficient to join client-side; a flattened view
   (snag + site + org + RCA/debrief status in one row) is optional and only worth adding if the
   join becomes unwieldy in practice. Not building it up front.

**Export pattern to reuse (confirmed against `ReportsScreen.tsx` and the edge functions):**
generate the file → upload to the matching existing bucket under `{org_id}/...` → call
`record_investigation_export(p_snag_id, p_file_path)` or
`record_governance_export(p_file_path, p_period_start, p_period_end)` to log it. No new export
RPC needed for CSV — reuse `record_governance_export` for the "log that a raw-data export
happened" step; only the file-generation code (CSV builder) is new, and it's app code, not a
migration.

---

## 5. Storage plan

Reuse the existing five private, org-folder-scoped buckets exactly as-is — same
`{org_id}/...` path convention, same policy shape (`(storage.foldername(name))[1] = current_org_id()::text`):

`snag-photos`, `snag-evidence`, `investigation-files`, `governance-reports`, `work-group-images`.

**Open question:** the brief's "upload documents" is ambiguous between two different things:

- **Snag/investigation-scoped documents** (extra evidence, investigation attachments) → already
  covered, use `snag-evidence` / `investigation-files` with the existing `add_evidence_item` /
  `record_investigation_export` RPCs. No new bucket or migration.
- **A general org document library** (H&S policies, compliance certificates, induction packs —
  not tied to any single snag) → **does not exist today.** This would need a new bucket
  (e.g. `org-documents`, same `{org_id}/...` policy pattern) plus a metadata table
  (`org_documents`: id, org_id, uploaded_by, file_path, title, category, created_at) with RLS
  scoped to `org_id = current_org_id()`, and a small set of RPCs/policies for
  upload-record/list/delete.

Recommend resolving this with whoever owns the portal requirements before scoping the
`documents/` route in Section 2 — the folder structure above stays valid either way, but the
second interpretation needs a migration (see Section 6) and the first doesn't.

---

## 6. Public route scope

- **Landing page, pricing**: static marketing content, no backend calls beyond maybe a contact
  form (out of scope for backend work here).
- **Org sign-up**: Supabase Auth sign-up (`auth.signUp`) → **`create_organisation_and_owner(p_org_name, p_name)`**
  — already exists, makes the calling (now-authenticated) user `officer_admin` owner of a new org.
  No new RPC needed for this flow.
- Do **not** build this as, or confuse it with, the existing **public QR hazard-reporting**
  feature (`is_public`/`public_intake_site_id`, `get_site_by_public_token`,
  `create_public_snag_by_token`) — that's an unrelated, already-shipped anonymous
  incident-reporting feature (mirrored in mobile's `PublicQrReportScreen.tsx`), not org sign-up.
- `join_org_via_code` / `get_org_by_join_code` and `invite_user`/`accept_invite`/`get_invite_preview`
  also already exist if the portal ever needs a "join existing org" or invite-acceptance web page
  — not required for v1 scope per the brief, noting for completeness.

---

## 7. Deployment plan

- **New, separate Netlify site** for `apps/web`, base directory `apps/web`, build command
  `next build`, framework auto-detected as Next.js (or `@netlify/plugin-nextjs`).
- Env vars: same Supabase URL and anon key as mobile, renamed to Next.js's public-var convention
  — `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Pull the actual values from the
  mobile Netlify site's/`.env`'s current settings rather than re-typing them, to guarantee they
  match `wpkdpukpllxuyqqlxkxf`.
- **Existing root `netlify.toml`** (RN-web export) needs its build command/publish path updated
  for the `apps/mobile` move regardless (`cd apps/mobile && npx expo export --platform web`,
  `publish = "apps/mobile/dist"`), independent of whether `apps/web` ships.
- **Open decision, not a build detail:** two web surfaces will exist briefly — the existing
  RN-web Netlify site (which already renders `AdminDashboardScreen`/`ReportsScreen` on wide
  viewports) and the new Next.js portal. Recommend: once `apps/web`'s portal reaches parity with
  what `AdminDashboardScreen`/`ReportsScreen` already do on web, stop pointing the RN-web Netlify
  site at a public domain for supervisor use (keep it, if at all, as an internal/QA build) so
  there's one supervisor-facing web surface, not two. This is a product/rollout call, not
  something to decide inside this plan — flagging it so it doesn't get missed.
- `.github/workflows/eas-build.yml` (mobile EAS builds) needs its working directory updated for
  the `apps/mobile` move; unaffected otherwise.

---

## 8. Migration list

Per the repo's convention (standalone, snake_case, timestamped, one concern per file):

1. **Deferred, not built now** — `<timestamp>_org_snag_trend_rpc.sql` (`get_org_snag_trend`) —
   only once the reporting UI confirms it needs period/trend data (Section 4, gap 1).
2. **Deferred, conditional** — `<timestamp>_org_documents_table.sql` +
   `<timestamp>_org_documents_storage_policy.sql` — only if "upload documents" means a general
   document library, not snag-scoped evidence (Section 5). Two migrations (table+RLS, then
   storage policy) to match the existing split style (e.g. `rca_status_enum` before
   `rca_tables_and_rpcs`).
3. **Nothing needed** for org sign-up, snag list/detail, dashboard snapshot, or the existing
   export pattern — all reuse existing RPCs/views/policies as documented in Sections 3–6.

No migrations are proposed as part of this plan itself — both above are scoped but intentionally
not written until the open questions they depend on are answered, per the brief's "do not start
implementation until reviewed."

---

## 9. Non-goals (carried forward, unchanged)

No CRM/lead-scoring schema. No changes to `apps/mobile`'s *logic* (only its path, per Section 1).
No changes to in-progress RCA/debrief work (`reassign_rca`/`cancel_rca`, `RcaPanel.tsx`). No new
auth system. No code written yet — this document only.

---

## 10. Open decisions requiring sign-off before implementation starts

1. **Approve the monorepo conversion** (Section 1) — moving the current root app to
   `apps/mobile/`, introducing `packages/shared-types` and `packages/supabase-queries`, adding
   npm workspaces. This is the prerequisite everything else sits on top of.
2. **What "upload documents" means** (Section 5) — snag-scoped evidence (no new migration) vs. a
   general org document library (needs a new bucket + table + policies).
3. **Whether reporting needs trend/date-range data** (Section 4) — determines whether
   `get_org_snag_trend` gets built now or deferred.
4. **Fate of the existing RN-web Netlify deployment** once the portal reaches parity
   (Section 7) — product/rollout decision, not a blocker for starting the build.
