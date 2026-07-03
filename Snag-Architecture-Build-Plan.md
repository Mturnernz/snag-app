# Snag — Architecture & Build Plan (Snagv1)

Read `MVP-SPEC.md` first for product intent and the golden rules. This
document covers how the Snagv1 system is put together and the milestone
order for the current phase (rebuild the web app in-repo, then P2).

## History (why the repo looks like this)

Snagv1 was originally built June 2026 through milestones M1–M5 directly
against the Supabase project — migrations and edge functions were applied/
deployed remotely, but the **web frontend source was never committed** and
was lost when its build environment was reclaimed; only the deployed site
at snagv1.netlify.app survived. On 2026-07-03 the full applied migration
history and both edge function sources were recovered from the live project
into this repo (`supabase/migrations/*.sql` marked SNAPSHOT, and
`supabase/functions/*/index.ts`). From now on **this repo is the source of
truth**: new migrations are authored here and applied via MCP; edge
functions are edited here and redeployed via MCP.

The Expo mobile app at the repo root is an earlier prototype against a
different, now-inactive Supabase project ("Snag"). Leave it alone.

## System layout

```
snag-app/
├── App.tsx, src/, …                 # LEGACY mobile prototype (inactive backend)
├── apps/
│   └── web/                         # Snagv1 web app (Vite + React + TS) — being rebuilt
│       ├── netlify.toml             # Netlify site: base dir = apps/web
│       └── src/
│           ├── App.tsx              # Routes + auth guards
│           ├── lib/supabase.ts      # Client for the Snagv1 project
│           ├── lib/errors.ts        # friendlyError — no DB text reaches users
│           ├── lib/database.types.ts# Generated via MCP — never hand-edit
│           ├── hooks/               # useSession, useSnag, useMembers, useRca, useDebriefs
│           └── pages/               # SnagListPage, SnagDetailPage, RcaPage, DebriefListPage, DebriefPage, LoginPage, InvitePage
├── supabase/
│   ├── migrations/                  # Recovered history (SNAPSHOT) + new migrations
│   ├── functions/
│   │   ├── notify-snag/             # Resend emails (internal-secret protected)
│   │   ├── export-investigation/    # Investigation-file PDF (pdf-lib)
│   │   └── award-points/            # LEGACY — belongs to the old mobile project
│   └── schema.sql                   # LEGACY — old mobile project's schema
├── MVP-SPEC.md
└── Snag-Architecture-Build-Plan.md  # this file
```

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

## Current-phase milestones (one commit/PR each)

- **W0 — Recovery + docs** (this commit): snapshot migrations + edge
  sources into the repo; these docs.
- **W1 — Web app core**: scaffold `apps/web` against Snagv1; generated
  types; login + `/invite/:token` acceptance; snag list (lane filters);
  SnagDetail `/snags/:id` (+ `/snag/:id` redirect for old email links):
  progress strip, first-response checklist, recategorise + notifiable,
  witness statements, evidence upload, root cause, corrective actions,
  resolve/confirm (niggles) / mark sorted (serious), export button.
- **W2 — RCA + debriefs**: `/snags/:id/rca` (assign → 5 Whys with chaining
  pre-fill → submit → accept/send-back), `/snags/:id/debriefs` +
  `/snags/:id/debriefs/:debriefId` (hot 3-prompt findings, attendees from
  profiles, lessons, complete), summary cards on SnagDetail.
- **W3 — Notifications + UX pass**: notify-snag handles `rca_assigned` /
  `rca_submitted` / `rca_rejected` deep-linking `/snags/{id}/rca`; links
  move to `/snags/{id}`; P2.2 UX sweep (one primary action, progressive
  disclosure, confirms, friendly errors, inviting empty states).
- **W4 — Defensibility**: export includes RCA + debriefs; migrations for
  `cancelled` rca_status + `reassign_rca` / `cancel_rca` (cancel returns
  the snag `rca_pending` → `sorted`); supervisor UI.
- **W5 — Worksheet round-trip**: `worksheet` (AcroForm PDF) +
  `worksheet-import` (evidence-first, parse, review-before-commit client
  flow) edge functions.
- **W6 — Debrief quality**: lesson → corrective action shortcut; soft
  warning completing a formal debrief without an accepted RCA.

## Deployment

- **Web**: Netlify site (snagv1) should be linked to this repo with base
  directory `apps/web` (build `npm run build`, publish `dist`), deploy
  previews on, env `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`.
- **Edge functions**: edit under `supabase/functions/`, deploy via MCP
  `deploy_edge_function`, same slug.
- **Migrations**: author under `supabase/migrations/`, apply via MCP
  `apply_migration` with the identical content, then regenerate types and
  run advisors.

## Verification, every milestone

`npm run typecheck` + `npm run build` in `apps/web`; advisors after any
migration; click through the deploy preview; PR lists manual steps.
Definition-of-done proofs per milestone are listed in the plan/PRs.
