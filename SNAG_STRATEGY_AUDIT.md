# Snag Strategic Alignment Audit

Scope: this repo's mobile app (`src/`, `App.tsx`) against the Snagv1 Supabase backend
(`wpkdpukpllxuyqqlxkxf`). Analysis only — no code changed.

## Before the four questions: a documentation contradiction that matters

`Snag-Architecture-Build-Plan.md` and `MVP-SPEC.md` (both frozen at this repo's single
bulk-import commit, never touched since) instruct: *"The Expo mobile app at the repo
root is an earlier prototype against a different, now-inactive Supabase project...
Leave it alone."* Their plan is for the real Snagv1 product to be this same backend
plus a separate `apps/web` (Vite/React) console, which would carry the investigation-depth
build-out end to end (RCA UI, debriefs, corrective actions, PDF worksheet round-trip —
milestones W1 through W6).

**`apps/web` does not exist in this repository.** There is no evidence it was ever
built here. Meanwhile `CLAUDE.md` — the environment's own current project
instructions — describes this mobile app as the live product, and it demonstrably is:
real devices are hitting the real backend through it (confirmed via Storage logs while
fixing the photo-upload bug earlier this week), and it has 52 tracked commits of
continuous development.

Net effect: the "rebuild investigation depth on a separate web app" plan appears to have
been abandoned or silently superseded, without anyone updating the docs, and without the
investigation-depth work actually resuming anywhere else. That ambiguity is worth
resolving directly with whoever owns this decision before reading the rest of this audit
as a verdict on "the team" — it may really be a verdict on "the only place this work is
currently happening."

## 1. Investment audit

The repo's tracked history starts at one large bulk-import commit (`4bed810`) that
bundled in the already-existing baseline — including the checklist/witness/evidence/
root-cause investigation UI (`InvestigationPanel.tsx`) and all the RCA/debrief database
migrations. That baseline isn't attributable "recent effort" — it's day-zero state.
What's measurable is the **52 commits since then.**

Of those 52 commits, exactly **one** extends investigation depth:
`6032d53 — "Add RCA (5 Whys) delegation to the mobile app"` (+442 lines, new
`RcaPanel.tsx`). A second commit touches investigation code but isn't depth work — a
7-line photo-upload robustness fix inside `InvestigationPanel.tsx`.

By line-count churn (insertions + deletions, excluding the baseline-import commit):

| | Lines changed |
|---|---|
| Total, post-baseline | 10,083 |
| Investigation/RCA/debrief-related | 452 |
| **Share going to investigation depth** | **~4.5%** |

The other ~95.5% — by commit count, 50 of 52 commits — went to: multi-org membership
and org-switching (4+ commits), onboarding/sign-up redesigns (3 commits, including a
full stepper rebuild), work groups, snag merging, bulk actions, a mentions inbox, a
leaderboard feature that was then removed, a first-time onboarding tutorial, filter-bar
redesigns, and a dedicated "warmth & motion pass" (spring animations, haptics). All
real product work, none of it deepening the serious-lane moat.

**Rough proportion: roughly 1 in 20 units of recent build effort has gone toward
widening the investigation-depth gap; the rest has gone toward general platform
breadth, onboarding polish, and niggle-lane UX** — on an app the team's own last
written architecture decision says should have been left alone while that gap-widening
work happened elsewhere.

## 2. Depth gap check

Walked end to end: `InvestigationPanel.tsx`, `RcaPanel.tsx`, `IssueDetailScreen.tsx`,
`src/lib/supabase.ts`, and every investigation-cluster migration.

**Fully built and working (mobile):**
- First-response checklist (5 steps), witness statements (write-once, no edit/delete —
  correctly immutable), evidence capture with photos, free-text root cause — all live,
  all gating the resolve action, with a real-time progress-pill display
  (`InvestigationPanel`'s `ProgressPill` row).
- Formal RCA (5 Whys): assign → answer/draft → submit → accept or reject-with-note.
  Fully wired (`RcaPanel.tsx` ↔ `assignRca`/`saveRcaWhy`/`submitRca`/`acceptRca`/
  `rejectRca`), status-consistent with the current `resolved` terminal state.
- Server-side resolve gate (`update_snag_status`): checklist ≥5, ≥1 witness, ≥1
  evidence, root cause recorded, zero open corrective actions — all enforced, not
  optional, with a specific human-readable reason surfaced per missing condition.

**Designed and scaffolded server-side, but not wired into the app at all:**
- `reassign_rca(rca_id, new_assignee_id)` and `cancel_rca(rca_id)` — clean,
  audited, notification-dispatching, site-scoped RPCs (migration
  `20260703000200_rca_reassign_cancel.sql`), correctly updated for the current
  `resolved` status naming by the later `retire_sorted_status` migration. **Zero
  references anywhere in `src/`.** Today, if an RCA assignee leaves or goes quiet, the
  snag is stuck at `rca_pending` with no in-app way out.
- `create_corrective_action(snag_id, description, owner_id, due_date)` and
  `complete_corrective_action(action_id)` — real RPCs, real table. The app only ever
  *reads* an open-action count (to gate resolve) — there is no create or complete call
  anywhere in `src/lib/supabase.ts`. **A corrective action can block a snag from
  resolving, but nothing in the app can ever open one.**
- Debriefs — a full table + RPC surface exists server-side per
  `20260629214558_debrief_tables_and_rpcs.sql` (259 lines: hot/formal debriefs,
  attendees, findings, lessons). `grep`-confirmed: zero mentions anywhere in `src/`.
  Not even a stub screen.
- PDF/AcroForm investigation export (`export-investigation` edge function,
  `record_investigation_export`) — exists, but is not reachable from the mobile app.

**Missing even server-side — what a genuinely rigorous flow would still need:**
- **Root-cause categorisation.** `investigations.root_cause_text` is one free-text
  field. There's no taxonomy (equipment failure / process gap / training / human
  factors / environmental) to roll up trends across incidents — which is usually
  the actual payoff of doing RCA at scale, not just per-incident record-keeping.
- **A dedicated investigation timeline.** Checklist steps, witness adds, evidence
  adds, and RCA events all write to the generic `audit_log`, shown as one
  chronological stream mixed with ordinary comments. There's no consolidated
  "case history" view sequencing the investigation itself.
- **Multi-stakeholder sign-off.** RCA accept/reject is single-approver. No support
  for e.g. an H&S officer *and* a site manager both signing off before a serious
  incident is considered closed.
- **Severity-scaled investigation requirements.** The same 5-condition gate applies
  uniformly to every serious snag, Moderate through Critical. A more rigorous system
  would plausibly demand more (formal RCA, debrief) only above a severity threshold.

## 3. Drift check

**No open branches** besides the current one — nothing mid-flight to check there.

**One genuinely good sign:** `MVP-SPEC.md`'s "Out of scope" section explicitly lists
**"QR reporting"** and **"critical-risk registers"** as deliberately excluded. That's
real discipline — someone already said no to HazardCo-shaped scope in writing. (Note:
the QR codes that *do* exist in this app are for org join/switch — onboarding
plumbing, not attendance/induction sign-in. Not the same thing, not drift.)

**The real drift, and it's structural, not feature-level:** nothing in the 52 tracked
commits chases induction packs, QR sign-in, or compliance-document generation
directly. But per the Investment Audit above, ~95% of tracked effort went into general
platform and niggle-lane breadth — multi-org switching, onboarding redesigns (twice),
work groups, a leaderboard that was built and then removed, a dedicated animation/haptics
pass — while the team's own last recorded strategic decision (`Snag-Architecture-
Build-Plan.md`) was to *stop* touching this app and build the investigation-depth
moat somewhere else. That somewhere else doesn't exist. So the honest read isn't
"chasing HazardCo's features" — it's that **the moat-widening work isn't happening
anywhere, while general breadth-building continues on the surface the docs say to
leave alone.** If the differentiation thesis is real, that's the drift to fix, and it's
a bigger problem than any single feature choice: whoever owns roadmap prioritisation
is currently spending it on the opposite of the stated bet, one build-decision at a
time, without a document anywhere reflecting that this is what's happening.

## 4. Next-wedge recommendation

**Wire `reassign_rca` and `cancel_rca` into `RcaPanel.tsx`.**

Concretely: two thin wrappers in `src/lib/supabase.ts` (matching the existing
`assignRca`/`acceptRca`/`rejectRca` pattern exactly) calling the already-deployed,
already-audited, already-notification-integrated RPCs, plus two actions in
`RcaPanel.tsx` (a reassign picker reusing the existing `assignees`/`SiteAssignee`
pattern already in that file, and a cancel confirm reusing the existing
`rejectModalOpen`-style pattern). No schema change, no new RPC, no new table — the
server side of this was finished in migration `20260703000200` and hardened in
`20260703000300`.

Why this over anything else:
- It's the single most concrete hole in the *one* feature that already widens the
  gap. Right now a real-world failure mode — an RCA assignee who leaves, changes
  role, or just stops responding — permanently strands a snag at `rca_pending` with
  no in-app recovery. A workflow that can get stuck forever on a personnel change
  isn't yet "more rigorous than any competitor's equivalent flow"; it's rigorous
  until someone leaves.
- It's already the team's own stated intent — `Snag-Architecture-Build-Plan.md`'s W4
  milestone literally names this exact pair of RPCs and "supervisor UI" for them.
  This isn't a new idea, it's finishing a decision already made and half-built.
- Smallest possible lift for the leverage: no new screen, extends a panel that
  already exists and is already the flagship differentiator, ships in isolation
  without touching the niggle lane or anything else.

**Natural second wedge, larger lift, same zero-architecture-change property:** wire
`create_corrective_action` / `complete_corrective_action` into a small panel on serious
snags. It closes a stranger gap than the RCA one — corrective actions can *block*
resolution today with no in-app way to ever create one — but needs a proper mini-CRUD
UI (create form with owner + due-date pickers, a list, a complete action) rather than
two buttons on an existing panel, so it's the right follow-on, not the first move.
