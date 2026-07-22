# SNAG `apps/web` — Plan (Marketing + Supervisor Portal)

Status: **built and deployed — all §10 open decisions resolved.** Started as a merge of the
Supabase-side investigation (`SNAG_WEB_APP_SUPABASE_FINDINGS.md`, pulled 2026-07-23 from the live
`Snagv1` project) with a repo-side investigation done in Claude Code (Step 1 + Step 2 plan below).
The monorepo conversion, `apps/web` scaffold, and all four open decisions have since been
implemented, merged to `main`, and deployed as two separate Netlify sites. What's left is scoped
explicitly at the end of §10, not left ambiguous.

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

1. **Date-range / trend RPC — ✅ resolved (decision D3), built.** `get_org_stats`/`get_site_breakdown`
   were snapshot-only; `get_org_snag_trend(p_org_id, p_start_date, p_end_date, p_bucket)` was added
   (`supabase/migrations/20260722210000_org_snag_trend_rpc.sql`, applied to Snagv1) — counts by
   status, bucketed by week or month. Wired into the reports page as a 90-day weekly trend chart.
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

**✅ Resolved (decision D2): general org document library, built.** The brief's "upload documents"
was ambiguous between snag-scoped evidence (already covered by `snag-evidence`/`investigation-files`,
no new work needed) and a general org-wide library (H&S policies, compliance certificates, induction
packs — not tied to any single snag). Chose the latter. Added:

- A sixth bucket, `org-documents`, same `{org_id}/...` policy pattern as the existing five —
  select open to any org member, insert/delete restricted to `supervisor`/`officer_admin`.
- `org_documents` table (id, org_id, uploaded_by, file_path, title, category, created_at), RLS
  scoped to `org_id = current_org_id()` for reads.
- `create_org_document(p_file_path, p_title, p_category)` / `delete_org_document(p_document_id)`
  RPCs (role-gated, audit-logged) — writes go through these, not direct table access, per the
  repo's "RPC-only writes" convention.
- All in `supabase/migrations/20260722200000_org_documents.sql`, applied to Snagv1.
- `apps/web/src/app/(portal)/documents/` now a real page: upload (file + title + category),
  list, delete — no longer a stub.

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
- **✅ Resolved (decision D4): leave the RN-web Netlify site running for now.** Two web surfaces
  exist side by side — the RN-web export (`AdminDashboardScreen`/`ReportsScreen` on wide
  viewports) and the new `apps/web` portal. Deliberately not consolidated yet: `apps/web` is
  currently read-heavy (dashboard/snags/reports/documents) and doesn't yet support the mutation
  actions (assign, resolve, recategorise, etc.) supervisors rely on today, so pulling the RN-web
  site off the public domain now would be a regression, not a cleanup. Revisit once `apps/web`
  reaches real feature parity, not before.
- `.github/workflows/eas-build.yml` (mobile EAS builds) needs its working directory updated for
  the `apps/mobile` move; unaffected otherwise.

---

## 8. Migration list

Per the repo's convention (standalone, snake_case, timestamped, one concern per file):

1. **✅ Applied** — `20260722200000_org_documents.sql` — `org_documents` table + RLS, the
   `org-documents` bucket + policies, `create_org_document`/`delete_org_document` RPCs (decision
   D2). One migration rather than the table/bucket split originally floated here, matching the
   actual precedent (`20260719140000_governance_export.sql` does table+bucket+policy+RPC in one
   file too — the RCA enum split was for a Postgres-specific reason, not a general rule).
2. **✅ Applied** — `20260722210000_org_snag_trend_rpc.sql` — `get_org_snag_trend` (decision D3).
3. **Nothing needed** for org sign-up, snag list/detail, dashboard snapshot, or the existing
   export pattern — all reuse existing RPCs/views/policies as documented in Sections 3–6.

Both migrations above were applied directly to the live Snagv1 project (`wpkdpukpllxuyqqlxkxf`)
via the Supabase MCP; `mcp__Supabase__get_advisors` was checked afterward and only surfaced the
same generic, already-present-elsewhere advisories (e.g. the anonymous-sign-in warning every
`current_org_id()`-scoped table gets, since anon sign-in is enabled project-wide for QR public
reporting) — nothing new.

---

## 9. Non-goals (carried forward, unchanged)

No CRM/lead-scoring schema. No changes to `apps/mobile`'s *logic* (only its path, per Section 1).
No changes to in-progress RCA/debrief work (`reassign_rca`/`cancel_rca`, `RcaPanel.tsx`). No new
auth system. No code written yet — this document only.

---

## 10. Open decisions — all resolved

1. **✅ Approved and built** — the monorepo conversion (Section 1): `apps/mobile/`,
   `packages/shared-types`, `packages/supabase-queries`, npm workspaces. Shipped in two PRs
   (#16 monorepo conversion, #17 `apps/web` scaffold), both merged to `main` and deployed.
2. **✅ Decided: general org document library** (Section 5) — built, migration applied, real
   upload/list/delete UI shipped (not the stub).
3. **✅ Decided: build the trend RPC now** (Section 4) — `get_org_snag_trend` built, migration
   applied, wired into the reports page as a 90-day weekly chart.
4. **Decided at the time: leave the RN-web Netlify deployment running** (Section 7) — was
   blocked on `apps/web` not having mutation actions. That gap is now largely closed (see below),
   so this is worth revisiting, but flipping the public domain over is a product/rollout call for
   whoever owns that decision, not something to do unilaterally as a follow-on to a code change.

**Mutation actions were added after the decisions above were first resolved** — the snag detail
page (`apps/web/(portal)/snags/[id]/`) now supports: status changes (flag/in-progress/resolve,
niggle via `resolve_snag`, serious via the server-side investigation gate on `update_snag_status`),
owner assignment, recategorise, comments, notifiable-event toggle, merge (checkbox multi-select on
the snags list) and unmerge; the full investigation flow (checklist, witness statements, evidence
upload, root cause); the full RCA flow (assign, 5-whys, submit, accept/reject, reassign/cancel);
the full debrief flow (start, findings, lessons, attendees, complete); and CAPA (create, complete,
verify). CSV/raw-data export (Section 4, gap 2) was also built —
`apps/web/(portal)/reports/export-csv/` flattens `snags_with_details` client-side (no new view
needed, confirming the plan's guess) and logs the export via `record_governance_export`, same
pattern as the PDF.

**Genuinely still not ported from mobile**, flagged rather than silently missing: work group
assignment on a snag, multi-PCBU notifying-org nomination, @mentions in comments, and voting.
None of these block the D4 revisit above — they're secondary to the core
triage/investigate/resolve loop — but they mean "parity" is close, not absolute.
