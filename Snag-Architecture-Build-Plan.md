# Snag — Architecture & Build Plan (Snagv1)

Read `MVP-SPEC.md` first for product intent and the golden rules. This
document covers how the Snagv1 system is put together and current
development priorities.

## Architecture decision (2026-07): the mobile app is the live product

**Updated 2026-07 — this supersedes the "rebuild `apps/web`" plan below and
the "leave it alone" note that used to apply to the mobile app.**

Earlier revisions of this document treated the Expo mobile app at the repo
root as a legacy prototype to leave alone, with the intent to rebuild
Snagv1's real frontend as a separate `apps/web` (Vite/React) console. That
plan was never executed — `apps/web` does not exist in this repo, and no
evidence of it being built elsewhere has surfaced. Meanwhile, the mobile
app kept being actively developed against this same live backend
(`wpkdpukpllxuyqqlxkxf`) and is demonstrably in real use (confirmed via
Storage/API logs while diagnosing a production bug).

**Going forward: the mobile app (`App.tsx`, `src/`) is Snagv1's live
product.** There is no separate web console, planned or in progress. A
prior strategic-alignment audit (`SNAG_STRATEGY_AUDIT.md`) found this
architecture ambiguity was itself contributing to effort drifting away from
the product's differentiation thesis (investigation depth) — resolving it
in writing here removes that ambiguity for future planning.

A desktop-usable supervisor view, if built, will be a responsive layout of
this same mobile/Expo codebase (Expo already supports a web build target —
see `expo start --web` — though no responsive-layout system exists yet),
not a separate app or framework. `apps/web` should not be resurrected
without a new, explicit decision superseding this one.

## History (why the repo looks like this)

Snagv1 was originally built June 2026 through milestones M1–M5 directly
against the Supabase project — migrations and edge functions were applied/
deployed remotely, but an early **web frontend source was never committed**
and was lost when its build environment was reclaimed; only the deployed
site at snagv1.netlify.app survived from that period. On 2026-07-03 the
full applied migration history and both edge function sources were
recovered from the live project into this repo (`supabase/migrations/*.sql`
marked SNAPSHOT, and `supabase/functions/*/index.ts`). This repo is the
source of truth for the backend: new migrations are authored here and
applied via MCP; edge functions are edited here and redeployed via MCP. The
mobile app (`src/`) is the source of truth for the client — see the
architecture decision above.

## System layout

```
snag-app/
├── App.tsx, src/, …                 # THE LIVE PRODUCT — Expo/React Native mobile app
├── supabase/
│   ├── migrations/                  # Recovered history (SNAPSHOT) + new migrations
│   ├── functions/
│   │   ├── notify-snag/             # Resend emails (internal-secret protected)
│   │   ├── export-investigation/    # Investigation-file PDF (pdf-lib)
│   │   └── award-points/            # LEGACY — belongs to an earlier, unrelated prototype
│   └── schema.sql                   # LEGACY — an earlier, unrelated prototype's schema
├── MVP-SPEC.md
└── Snag-Architecture-Build-Plan.md  # this file
```

`netlify.toml` at the repo root still points at `npx expo export --platform
web`, i.e. it deploys the mobile app's web export, not a separate app —
consistent with the architecture decision above, not a leftover.

## Backend (Supabase project `wpkdpukpllxuyqqlxkxf`, ap-southeast-2)

- **Tables**: organisations, sites, site_members, site_supervisors,
  site_default_owners, profiles, invites, snags (+ generated `lane`,
  `retained_until`), snag_views, checklist_completions, witness_statements,
  evidence_items, investigations (root cause), investigation_files,
  corrective_actions, snag_rca + rca_why_steps, snag_debriefs +
  debrief_findings/attendees/lessons, audit_log.
- **Write path**: security-definer RPCs only (~50 of them; see the
  migration files for exact signatures and permission logic). SELECT via
  RLS: org-scoped, and site-scoped for snags via `can_view_site`.
- **Storage** (all private, org-id path prefix + RLS on storage.objects):
  `snag-photos` (report photos), `snag-evidence` (investigation evidence),
  `investigation-files` (export PDFs; select-only for clients).
- **Notifications**: triggers/RPCs → `dispatch_snag_notification` /
  `dispatch_rca_notification` → pg_net POST (Vault secret header) →
  `notify-snag` edge function → Resend.
  Secrets: `SNAG_INTERNAL_SECRET`, `RESEND_API_KEY`, `SNAG_FROM_ADDRESS`,
  `SNAG_APP_URL`.

## Milestone history and current status (against the mobile app)

The W1–W6 milestones below were originally scoped for the never-built
`apps/web`. Re-mapped against what's actually shipped on mobile as of this
revision:

- **W0 — Recovery + docs**: done — migrations/edge sources recovered into
  this repo; this doc.
- **W1 — Investigation core**: **mostly done on mobile.** Snag list (lane/
  status/site/scope filters), snag detail with progress strip, first-
  response checklist, recategorise, witness statements, evidence upload,
  root cause, and resolve (niggles via `resolve_snag`, serious via
  `update_snag_status`) are all shipped (`IssueListScreen.tsx`,
  `IssueDetailScreen.tsx`, `InvestigationPanel.tsx`, `ManageIssuePanel.tsx`).
  **Not done**: corrective-action creation/completion has no mobile UI yet
  (the RPCs exist; see the Pre-Launch Development Proposal's Phase 1).
  Export button: `export-investigation` exists server-side, not yet
  triggered from mobile.
- **W2 — RCA + debriefs**: RCA assign → 5 Whys → submit → accept/reject is
  shipped on mobile (`RcaPanel.tsx`). **Debriefs are explicitly deferred**
  (full server table/RPC surface exists, zero mobile UI planned until pilot
  feedback identifies a specific need — see the Pre-Launch Development
  Proposal, Section 6).
- **W3 — Notifications + UX pass**: the underlying event dispatch
  (`dispatch_snag_notification` / `dispatch_rca_notification` →
  `notify-snag` → Resend) is live and already fires on RCA
  assign/submit/reject; there is no mobile deep-linking work to do (no
  routing scheme to link into). General UX polish is ongoing as normal
  product work, not tracked as a discrete milestone.
- **W4 — Defensibility**: `reassign_rca` / `cancel_rca` are deployed,
  audited, and notification-integrated server-side, but have **no mobile
  UI** — this is a tracked near-term gap (see the Pre-Launch Development
  Proposal, Phase 0). Export including RCA is not yet built.
- **W5 — Worksheet round-trip**: not started, not currently scoped.
- **W6 — Debrief quality**: not started; depends on W2's debrief UI, which
  is deferred.

Current development priorities live in `SnagPreLaunchDevelopmentProposalRev2`
(Phase 0/1 work: RCA reassign/cancel UI, corrective-action completion,
supervisor dashboard) rather than in a renumbered milestone list here.

## Deployment

- **Mobile/web export**: `netlify.toml` builds `npx expo export --platform
  web` from the repo root and publishes `dist` — this deploys the mobile
  app's web build, not a separate app. Native builds go through EAS
  (`eas.json`).
- **Edge functions**: edit under `supabase/functions/`, deploy via MCP
  `deploy_edge_function`, same slug.
- **Migrations**: author under `supabase/migrations/`, apply via MCP
  `apply_migration` with the identical content, then regenerate types and
  run advisors.

## Verification, every change

`npx tsc --noEmit` in the repo root; advisors (`get_advisors`) after any
migration; exercise the change in a running instance (`expo start`, or
`expo start --web` for the web export) before considering it done.
