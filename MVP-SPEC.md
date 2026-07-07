# Snag — MVP Specification (Snagv1)

Snag's promise: **report in 30 seconds, everyone knows, sorted — with a
defensible record for serious events.**

The live product is the **Snagv1** system: the Supabase project
`wpkdpukpllxuyqqlxkxf` (backend, source of truth) plus the web app in
`apps/web`, deployed at **snagv1.netlify.app**. The Expo mobile app at the
repo root is an earlier prototype against a now-inactive Supabase project;
it is NOT part of Snagv1.

## Golden rules (apply to ALL work on this system)

1. **Migrations only.** Schema changes are timestamped files in
   `supabase/migrations/`, applied to the Snagv1 project via the Supabase
   MCP (`apply_migration`) with identical content committed here. Never edit
   an applied migration; never change the remote schema any other way.
   Regenerate `apps/web/src/lib/database.types.ts` and run the Supabase
   advisors after every migration. Files marked "SNAPSHOT … Do NOT re-apply"
   are the recovered history of already-applied migrations.
2. **RLS everywhere.** Every table has row level security. Clients get
   SELECT via org/site-scoped policies; **all writes go through
   security-definer RPCs** that permission-check and write `audit_log`.
   There are deliberately no insert/update/delete policies on record tables.
3. **Append-only evidence.** Witness statements are locked on creation;
   evidence items are never updated or deleted. Do not add policies or RPCs
   that would allow it.
4. **Snags can never be deleted** (trigger-enforced, and DELETE is revoked).
   Records carry a `retained_until` of created + 5 years; the delete block
   is unconditional beyond even that.
5. **Secrets via env/Vault.** The internal notify secret lives in Supabase
   Vault (`snag_internal_secret`); Resend key etc. live in edge-function
   secrets. Never commit secret values — snapshot files redact them.
6. **One PR per milestone**, plain-English summary, working deploy preview,
   list of manual steps (edge deploys, secrets).
7. **Flag scope creep** — stop and flag rather than silently building
   beyond the current milestone.

## Roles

| Role | Powers |
|---|---|
| `worker` | Report snags; see snags at sites they are members of; resolve niggles they own; escalate their own niggle; complete an RCA assigned to them |
| `supervisor` | Site-scoped (via `site_supervisors`): triage/recategorise, run guided investigations, assign/accept/reject RCAs, run debriefs, confirm niggles, export the investigation file |
| `officer_admin` | Org-wide everything, plus sites/members/invites administration |

The brief's "supervisor" = `supervisor`; "admin" = `officer_admin`.

## The two lanes

Every snag has a kind — `fixit`, `improvement` (→ **niggle** lane) or
`hazard`, `incident` (→ **serious** lane; requires a severity:
`minor`/`moderate`/`injury`/`critical`).

- **Niggle lane**: `flagged → in_progress → resolved → sorted`. Default
  owner auto-assignment per site; owner resolves with a note; supervisor
  (or delegated approver) confirms → sorted. Reporter may escalate a
  niggle for attention (notification, not recategorisation).
- **Serious lane**: `flagged → in_progress → sorted` gated by the guided
  investigation: all 5 first-response checklist steps (make safe, preserve
  scene, capture evidence, identify witnesses, find root cause), ≥1 witness
  statement, ≥1 evidence item, a recorded root cause, and no open
  corrective actions. After sorting, a supervisor can assign an **RCA**
  (5 Whys) to anyone in the org: `sorted → rca_pending`, assignee completes
  and submits (this writes the combined root cause), supervisor accepts
  (→ back to `sorted`) or rejects with a note (stays `rca_pending`,
  reopens). **Debriefs** (hot or formal) can be run on any serious snag at
  any time, capturing findings, attendees (org profiles), and lessons.
- **Notifiable events** are flagged with `is_notifiable` and highlighted.

## Notifications (Resend via `notify-snag` edge function)

Fired from DB triggers/RPCs through `dispatch_snag_notification` /
`dispatch_rca_notification` (pg_net + Vault internal secret). Events today:
`serious_created`, `niggle_assigned`, `niggle_escalated`, `snag_sorted`.
The dispatchers already fire `rca_assigned` / `rca_submitted` /
`rca_rejected` — the edge function must handle them (P2 gap).

## Defensible record

`export-investigation` produces the investigation-file PDF for a serious
snag (supervisor/admin only), stores it in the `investigation-files` bucket,
records it in `investigation_files` + `audit_log`, and returns a signed URL.
It must contain the complete record — including RCA and debriefs (P2 gap).

## UX north star (every screen)

1. One primary action per screen (`.btn-primary`, signal orange).
2. Show status before controls — progress strip first, then this user's
   next step expanded, everything else collapsed.
3. Plain language, no database leakage — every error through `friendlyError`.
4. Minimum taps, no dead ends; every state says what happens next and who's
   holding it.

## Out of scope

Overdue-action digest emails, attendee acknowledgement flows, offline-first
capture, QR reporting, critical-risk registers, renaming work, and the
legacy mobile prototype at the repo root.
