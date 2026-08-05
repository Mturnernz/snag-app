# SNAG — Claude Code Instructions

This file tells Claude Code everything it needs to know to work effectively on this project.

## What is SNAG?

A React Native / Expo mobile app for workplace issue reporting, plus (as of the `apps/web`
initiative) a Next.js marketing site and supervisor portal. Workers photograph and report
problems (broken equipment, health & safety hazards, niggles). Managers can triage, assign,
and resolve issues. Both clients are built on the same Supabase project for auth, database,
and file storage.

## Tech Stack

| Layer | Choice |
|---|---|
| Mobile framework | Expo SDK 54 (React Native 0.81, React 19), `apps/mobile` |
| Web framework | Next.js (App Router), `apps/web` — see `SNAG_WEB_APP_PLAN.md` |
| Language | TypeScript (strict mode) |
| Navigation (mobile) | React Navigation v6 — bottom tabs + native stack |
| Backend | Supabase (Auth, Postgres, Storage) — one project, shared by both apps |
| State | React hooks (no external state library yet) |
| Monorepo | npm workspaces (`apps/*`, `packages/*`) |

## Project Structure

This is an **npm-workspaces monorepo** — run `npm install` once at the repo root, not inside
individual apps/packages. See `SNAG_WEB_APP_PLAN.md` for the full rationale (the repo used to be
a single flat Expo app; it was converted to make room for `apps/web`).

```
snag/
├── package.json                   # workspace root: "workspaces": ["apps/*", "packages/*"]
├── apps/
│   ├── mobile/                    # the Expo app — was the repo root before the monorepo conversion
│   │   ├── App.tsx                # Entry point — NavigationContainer + SafeAreaProvider
│   │   ├── metro.config.js        # monorepo-aware resolver (watchFolders + nodeModulesPaths)
│   │   ├── src/
│   │   │   ├── constants/theme.ts # ALL design tokens — colours, spacing, typography, radii
│   │   │   ├── lib/supabase.ts    # Supabase client, auth helpers, storage upload
│   │   │   ├── types/index.ts     # re-exports @snag/shared-types (see packages/ below)
│   │   │   ├── navigation/index.tsx
│   │   │   ├── screens/           # IssueListScreen, ReportIssueScreen, IssueDetailScreen, ProfileScreen, ...
│   │   │   └── components/        # IssueCard, StatusBadge, PriorityBadge, CategoryBadge, ...
│   │   └── .env.example           # Copy to apps/mobile/.env — EXPO_PUBLIC_SUPABASE_* vars
│   └── web/                       # Next.js app — marketing site + supervisor portal
│       ├── middleware.ts          # refreshes the Supabase session cookie on every request
│       ├── src/app/
│       │   ├── (marketing)/       # public: landing, pricing, sign-up
│       │   ├── login/             # shared login — the on-ramp into the portal
│       │   └── (portal)/          # auth-gated: dashboard, snags, reports, documents (stub)
│       ├── src/lib/supabase/      # client.ts (browser), server.ts (RSC/actions), middleware.ts
│       ├── src/lib/auth.ts        # requireSupervisorOrAdmin() — role gate for (portal) routes
│       └── .env.example           # Copy to apps/web/.env.local — NEXT_PUBLIC_SUPABASE_* vars
├── packages/
│   ├── shared-types/               # @snag/shared-types — the canonical TS types (moved from
│   │                                # apps/mobile/src/types/index.ts); apps/mobile re-exports it
│   └── supabase-queries/           # @snag/supabase-queries — RPC/query wrappers shared by both
│                                    # apps, each taking its own SupabaseClient (see the package's
│                                    # own header comment). apps/mobile re-exports these bound to
│                                    # its client; apps/web calls them directly.
├── supabase/
│   ├── migrations/                # Real Snagv1 schema history (source of truth — see below)
│   ├── functions/                 # Deployed edge functions (notify-snag, export-investigation, ...)
│   └── schema.sql                 # Stale prototype scaffold — do not run against Snagv1
└── SNAG_WEB_APP_PLAN.md           # apps/web initiation plan — read before touching apps/web
```

**Working on the mobile app?** Everything under "Common Tasks" below still applies — just
resolve paths relative to `apps/mobile/`, e.g. `src/screens/NewScreen.tsx` means
`apps/mobile/src/screens/NewScreen.tsx`.

## Design System — apps/mobile (DO NOT deviate from these)

All tokens are in `src/constants/theme.ts`. Never hardcode colours, spacing, or shadow values inline — always reference a token, including for one-off "success"/"copied" states (`Colors.success`/`successBg`) and the health & safety / incident-lane identity colour (`Colors.serious`/`seriousBg`).

- **Background**: `#F9FAFB` (near-white)
- **Surface / cards**: `#FFFFFF`
- **Border**: `#E5E7EB` (1px) — used on flat/nested surfaces (rows inside lists)
- **Elevation**: use the `Shadow` scale (`sm`/`md`/`lg`) for standalone surfaces instead of borders — `sm` for list cards, `md` for standalone cards (stats, invite code, comments), `lg` for hero/sticky bars and modals/dialogs. An elevated card drops its border; don't combine both on the same surface.
- **Primary accent**: `#2563EB` (Tailwind blue-600)
- **Text**: primary `#111827`, secondary `#4B5563`, muted `#6B7280` — the two lower tiers
  are deliberately darker than the Tailwind greys they look like: at WCAG AA (4.5:1) there
  is no room for a lighter muted on this background. `apps/web/e2e/a11y.spec.ts` fails if
  either regresses.
- **Card radius**: 12px | **Button radius**: 8px | **Chip radius**: 4px
- **Icons**: `@expo/vector-icons` (Ionicons) via the shared `Icon` component — never emoji/unicode glyphs. `-outline` variants by default; filled reserved for the active tab, active vote, and the serious-lane header icon. Size from the `IconSize` scale.
- **Priority badges**: only `high` carries an alert colour (`Colors.priority.high`); `low`/`medium` render as neutral dots — this avoids colliding with status badge colours.
- **Colour is never the only signal.** The one place it was — `CardAlertBorder`, the injury/critical/improvement border on a snag card — now pairs with `CardAlertGlyph`, a different icon per border colour, on the photo's bottom-left corner. Add to both maps together or the new border says nothing in monochrome.
- **Minimum touch target**: 48px (use `MIN_TOUCH_TARGET` constant)
- **Font**: System (San Francisco on iOS) — no custom typeface
- **Light mode only** — no dark mode handling needed

## Design System — apps/web (DO NOT deviate from these)

All tokens are CSS custom properties in `src/app/globals.css`. Light values mirror `apps/mobile/src/constants/theme.ts` exactly (same brand, both clients) — dark values are a deliberately designed second theme (mobile has none to inherit from), applied via `prefers-color-scheme`. Never hardcode a colour, spacing, or radius inline — always reference a `var(--...)` token or a component that already does.

- **Fonts**: IBM Plex Sans (400/600/700) + IBM Plex Mono (400/500), self-hosted via `next/font/local` (`src/lib/fonts.ts`, files in `src/fonts/`) — shared identity with `SNAG_WEB_APP_PLAN.md`'s own artifact, not a generic default. Mono is for data: snag references, counts, dates in tables.
- **Components**: `src/components/` — `Badge` (`StatusBadge`/`KindBadge`/`SeverityBadge`/`NotifiableBadge`), `Button`/`LinkButton` (primary/secondary/ghost/danger), `Card`/`StatTile`/`StatGrid`/`PageHeader`/`EmptyState`, `Icon` (lucide-react, named icons only — see `Icon.tsx`'s `IconName` type for what's available without adding new imports), `PortalNav` (the responsive sidebar). Reuse these; don't reintroduce inline `style={{}}` pill/card markup.
- **Icons**: `lucide-react` via the shared `Icon` component, outline style — never emoji/unicode glyphs. Sizes from the same `sm`/`md`/`lg`/`xl`/`xxl` scale as mobile's `IconSize`.
- **Both themes required**: every page must work in light and dark — test with `prefers-color-scheme` before shipping a new page, don't just eyeball light mode.
- **Responsive**: the portal sidebar collapses to a drawer under 900px (`PortalNav`/`PortalNav.module.css`) — new portal pages should assume narrow viewports, not just desktop.
- **CSS Modules, not Tailwind**: this app hand-rolls its design system via CSS custom properties + CSS Modules (`*.module.css` next to each component/page). No CSS framework is installed — don't add one without discussing it first.

## Environment Setup

1. Copy `apps/mobile/.env.example` → `apps/mobile/.env`
2. Fill in `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY`
   (Settings → API in your Supabase project dashboard)
3. Copy `apps/web/.env.example` → `apps/web/.env.local` and fill in
   `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` — same project as mobile.

## Database

The app's live backend is the **Snagv1** Supabase project (`wpkdpukpllxuyqqlxkxf`). The real
schema history lives in `supabase/migrations/` (recovered from Snagv1's `schema_migrations`,
timestamped, "SNAPSHOT — do NOT re-apply") and in `MVP-SPEC.md` /
`Snag-Architecture-Build-Plan.md` at the repo root.

`supabase/schema.sql` and `supabase/migration_*.sql` used to sit alongside them: leftovers from an
earlier, now-inactive prototype whose only property was being catastrophic if anyone ran them
against Snagv1. They were deleted rather than re-labelled — a warning comment doesn't help someone
who pipes the file into psql, and git still has them if they're ever wanted.

Key tables: `organisations`, `profiles`, `sites`, `snags`, `comments`, `votes`,
`serious_incident_owners` (see below), plus the investigation/RCA/debrief tables
(`checklist_completions`, `witness_statements`, `evidence_items`, `investigations`,
`corrective_actions`, `snag_rca`, `rca_why_steps`, `snag_debriefs`).

Key view: `snags_with_details` — snags joined with reporter/owner/site names and
comment/evidence/vote/checklist counts. Always query this view for the issue list and detail
screens (mirrored in `packages/shared-types/src/index.ts`, shared by both apps).

Second view: `snag_gate_inputs` — the facts the serious-lane resolve gate consumes, one row per
unmerged serious snag, so a *list* can say what a snag is waiting on. It returns **inputs, not a
verdict**: the rule already exists twice by necessity (`update_snag_status` enforces it,
`seriousResolveGate` mirrors it), and a third copy in SQL is where the mode fork would drift.
`snagGateSummary` in `packages/supabase-queries` turns a row into an outstanding count plus the
first blocking step by feeding it through `seriousResolveGate` itself — so the list and the detail
screen can never disagree about whether a snag can close. Covered by `snagGateSummary.test.ts`.

`snag_status` is `flagged | in_progress | resolved | rca_pending` — `resolved` is the single
terminal status for both the niggle lane (fixit/improvement) and the serious lane
(hazard/incident); serious snags can only reach it once the investigation is complete
(`update_snag_status`'s notifiable/checklist/witness/evidence checks, then whichever pair the
investigation mode calls for — see below). There is no separate "sorted" status — it was retired
and collapsed into `resolved`.

Photos/evidence go to the `snag-photos` and `snag-evidence` Storage buckets (private,
org-folder-scoped via RLS), not a public `issue-photos` bucket. Org-wide documents live in
`org-documents` / `org_documents` — see "The document library" below.

## Which site a report goes to

The reporter picks it, on both mobile report flows: `SitePicker`, a dropdown in the form's own
field style, rendered only when they have more than one site to choose between.

It is worth knowing what this replaced, because the failure was silent. `getDefaultSiteId` took
`my_member_site_ids()[0]`, and that RPC has no `ORDER BY` — so a member of three sites sent
every report to whichever row Postgres happened to return first, forever, with nothing in the UI
naming the site at all. It looked like a permissions problem to the person hitting it.

- **The default is the site they last actually reported into** (`getLastReportedSiteId`, read
  from their own snags), not the site they last tapped: what someone reported is a better
  account of where they work than a selection they made and abandoned. It's a server read, so it
  holds on a new device and on the web build. `resolveReportSite` falls back to a per-org
  AsyncStorage cache (the offline path — see `src/lib/reportSite.ts`) and then to the first site
  by name.
- **The list is about relevance, not permission.** `create_snag` accepts any site in the org, but
  `getReportableSites` offers a reporter their own site memberships — falling back to every site
  in the org for someone with none, typically an admin. Don't widen it to "every site" for
  workers; work-group scoping (`work_group_sites`) assumes the reporter is at the site.
- **Supervising a site means belonging to it**, so a site supervisor is offered the sites they
  supervise without this list needing to know about `site_supervisors` at all.
  `20260801120000_supervising_implies_membership.sql` made `assign_site_supervisor` write both
  rows and backfilled the ones it had missed; every other path already did this.
- **And belonging to a site means seeing it**, for every role. `can_view_site` used to ask
  supervisors a different question — `site_supervisors` only, membership never consulted — so a
  supervisor saw *less* at a site they belonged to than a worker standing next to them, and
  promotion silently took read access away. `20260802140000_membership_implies_visibility.sql`
  made the non-admin branch `site_members OR site_supervisors`. Read only: `can_edit_site` is
  untouched, so triage, assignment and the investigation writes still need a real
  `site_supervisors` row. Sight, not command.
- **The niggle form's work-group picker follows the selected site**, since custom groups can be
  site-scoped. Changing site mid-report changes which groups are on offer, which is correct.
- The serious lane carries the site on `IncidentDraft` so the Review screen can show it, and its
  submit handler still resolves a site late if one was never loaded — that path predates the
  picker and is the safety net for a report submitted before the list arrived.

One piece of copy nearby: the work-group sheet's primary button says **"Assign to the queue"**,
fixed copy rather than the default group's name. That group is the reserved literal `Submit`
(`create_work_group` seeds it and refuses the name to anyone else), so rendering its name put a
button reading "Submit" on a sheet asking which team should handle the snag.

## Who owns a serious incident

`serious_incident_owners` (org_id, profile_id) is the set of supervisors an organisation
nominates to own hazards and incidents. They are **the health & safety team the app tells
reporters about** — before this existed, `serious_created` mailed every member of the snag's
site, so that claim was true only by accident: on a one-member site it reached that person, and
on a site whose members have no email it reached nobody.

Two things follow from the table, and both matter:

- **Notification.** `supabase/functions/notify-snag` mails these owners on `serious_created`,
  falling back to site members if an org somehow has none.
- **Assignment.** `apply_default_owner()` (BEFORE INSERT OR UPDATE OF kind on `snags`) assigns
  the earliest-added owner to any serious snag that arrives without one — including a niggle
  escalated into the serious lane. It only ever fills a gap, so a site's own default-owner rules
  and deliberate assignments both still win. Note `lane` is a generated column and therefore
  unreadable from a BEFORE trigger; the lane test is on `kind`.

**There is always at least one.** `create_organisation_and_owner` makes the creator the first
(they are the only member at that point, so there is nothing to ask), and
`remove_serious_incident_owner` refuses to remove the last one. Only supervisors and admins are
eligible, because owning a serious incident means running the investigation and
`require_investigation_access` refuses anyone else — nominating a worker would name an owner the
RPCs then reject. Managed at Manage Organisation → Serious incident owners.

## Triage: the moment a serious snag is allocated

Opening an unallocated serious snag as a supervisor puts up a **blocking prompt** asking the three
things that constitute triaging it, in one place: how it will be investigated, who is running it,
and whether it is notifiable. `TriageSheet.tsx` on mobile, `TriageDialog.tsx` + `triageAction` on
web; neither is dismissible.

Before this the three lived in three different collapsed places, and on the serious lane the
allocation controls sat in Manage — *below* the entire investigation they configure. A hazard could
be read end to end by a supervisor who never scrolled to the part that assigns it.

- **Untriaged means unallocated**: `investigations.lead_investigator_id is null`. Not `owner_id` —
  `apply_default_owner` fills that on the way in, so a serious snag arrives owned but unallocated,
  which is the state triage exists to end.
- **The notifiable question can be deferred** ("I'm not sure yet"), and nothing is written when it
  is. It carries a statutory threshold and a modal is no place to make somebody guess. It stays on
  the resolve gate, which still refuses to close the snag without it. Mode and investigator cannot
  be deferred — those are the reason the snag is in front of them.
- **Order of writes matters**: `assign_investigation` → `assign_snag_owner` → `set_notifiable_flag`.
  The middle one fires `notify_after_snag_update`, whose mail names how the investigation is being
  run, so the `investigations` row has to exist first.
- Manage (both clients) is where the **owner** is re-decided afterwards. The mode can also be
  changed there, but only until the investigation has work under it — see "The mode freezes once
  work starts" below. The wording is shared (`INVESTIGATION_MODE_OPTIONS` in
  `packages/shared-types`) so the two surfaces can't drift.

## Investigation modes

A serious snag is investigated one of two ways, chosen **when it is allocated**
(`investigations.mode`, set by `assign_investigation`):

| mode | what closes it |
|---|---|
| `snag` (default) | SNAG's guided process: a root cause, then corrective actions completed and verified. |
| `document` | The organisation's own process: an investigation document is attached, and a supervisor accepts it. |

This is a **substitution, not a shortcut**. Document mode swaps the last two resolve-gate
conditions for two of its own; the notifiable decision, the first-response checklist, a witness
statement and evidence are all still required. The fork lives in one place per layer:
`update_snag_status` in SQL, `seriousResolveGate` in `packages/supabase-queries` (both clients read
it), and one conditional section in each client's snag detail view.

Accepting is a separate act from attaching, but **not necessarily by a separate person** — a
supervisor can sign off their own work. The assumption is that a site lead allocates the
investigation to a crew, so whoever completes it and whoever accepts it are already different
people without a rule forcing it. Forcing it (which an earlier migration did) only ever bit the
case where a supervisor did the work themselves, and there it deadlocked: a one-supervisor org had
nobody left who could accept. `document_attached_by` and `document_accepted_by` are both recorded
and both shown, so a self-signed investigation is visible in the record rather than prevented.

This is deliberately asymmetric with corrective actions, which keep their
verifier-cannot-be-owner rule: that is about a task someone was assigned and marked done
themselves, this is about an organisation's completed investigation the supervisor is accountable
for either way.

Replacing the document clears the acceptance: a different document is a different investigation.

### The mode freezes once work starts

`assign_investigation` refuses to change the mode of an investigation that has been **allocated**
and has work recorded **under its current mode** — a root cause or a corrective action in `snag`
mode, an attached document in `document` mode. An **officer admin** may still override, and the
override is audited under its own action (`investigation_mode_overridden_*`) so it reads as a
decision overturned rather than one merely re-made.

The reason is the gate, not tidiness. `update_snag_status` forks on `mode`, so a switch
mid-investigation is a hole in it: complete and verify every corrective action, switch to
`document`, attach and accept a file, and the snag resolves with those actions still open —
`document` mode never asks. In reverse, an accepted investigation document stops counting the
moment the mode flips back. SNAG-00038 was sitting in exactly that state before
`20260731000000_lock_investigation_mode.sql` repaired it.

Three things follow:

- **Only the current mode's work locks it.** The checklist, witnesses and evidence are required by
  both modes and survive a switch, so they are deliberately no reason to refuse one.
- **Reassigning the lead investigator still works.** It goes through the same RPC; only a *change
  of mode* is frozen. Who runs it and how it is run are different decisions.
- **`attach_investigation_document` no longer sets `mode`.** It used to flip a snag-mode
  investigation to `document` just by attaching a file — a second, quieter re-triage that never
  went near Manage. It now requires the investigation to already be in document mode.

Both clients mirror the rule with `investigationModeLocked` (`packages/supabase-queries`), the same
way they mirror the resolve gate with `seriousResolveGate`: the server enforces, the clients hide a
control it would refuse. They gate on `locked && !isOfficerAdmin`, never on `locked` alone.

### Who can do what

`require_investigation_access` (not `require_serious_snag`) gates the investigation writes, and
draws the line at **doing versus directing**:

- **Doing** — checklist, witness statements, evidence, root cause, attaching the document.
  The assigned lead investigator (any role, including a worker), plus supervisors and admins.
- **Directing** — assigning, accepting/rejecting an RCA, accepting the document, waiving,
  creating corrective actions, starting a debrief. Supervisors and admins only.

Before this split every investigation write required `can_edit_site`, so `assign_investigation`
could name a lead who was then refused by every RPC the job consists of — and the same hole was
live in the RCA flow, where an assigned worker could answer all five whys and be unable to submit
(`submit_rca` allows the assignee, then calls `set_root_cause`, which raised).

**The clients have to mirror that split, and for a while only the SQL did.** Mobile gated every
investigation card on `canEdit` (supervisor/admin), so the assigned investigator saw none of the
work they had just been given: not the checklist, not evidence, not the notifiable state, and — in
document mode — not the upload that `20260729000000` widened the bucket policy specifically to
allow. `IssueDetailScreen` now derives **`canInvestigate`** alongside `canManageInvestigation`,
matching `require_investigation_access` term for term (site editor, or the lead investigator, or an
open RCA assignee), and `InvestigationDocumentPanel` takes **`canAttach`/`canAccept`** rather than
one `canEdit` — attaching is doing, accepting is directing, and a single flag could only ever get
one of them right.

**An assigned worker investigator can only work in `apps/mobile`.** The portal's `(portal)` group
refuses workers at the route level and `/go/snag/[id]` offers them the app instead, so that is
correct rather than a gap — but it does mean mobile has to carry the whole investigator experience.
Don't "fix" it by loosening `requireSupervisorOrAdmin`.

## Closing a serious snag early

A serious snag reaches `resolved` one of two ways, and there is no third: with every resolve-gate
condition met, or with **a supervisor's written reason why not**. The second is recorded on the
snag — `resolution_exception_reason`, `_by`, `_at`, and `_unmet`, the last a snapshot of which gate
keys were outstanding at that moment — audited as `resolved_with_exception`, and shown on both
clients above the investigation it closed over.

`update_snag_status` takes the reason as `p_exception_reason`. Without one it refuses exactly as it
always did, naming the first unmet condition, so a caller that knows nothing about exceptions is
unaffected. With one it additionally requires `can_edit_site` — the plain owner can change a status
but closing an unfinished investigation is a directing act — and a reason of real length.

Three things follow:

- **The gate rule now lives in `serious_resolve_unmet`**, which returns the unmet keys rather than
  raising on the first. That is still one copy per layer: `update_snag_status` reads it, and
  `seriousResolveGate` in `packages/supabase-queries` remains the clients'. The keys are the
  clients' own `ResolveGateKey` values, so a snapshot renders without translation —
  `describeUnmetConditions` turns one into a sentence, and `RESOLVE_GATE_LABELS` is deliberately a
  second vocabulary from the gate's `reason` strings: those are instructions for an open snag
  ("Add evidence"), these are a record of a closed one ("evidence").
- **An RCA in flight is not exceptable.** `update_snag_status` refuses `rca_pending` above the gate
  and no reason gets past it, so both clients offer the reason field only when the block is a gate
  condition — `unmetConditions`/`unmetSummary`, never the general "resolve is blocked" state.
- **`record_resolution_exception` supplies the reason after the fact**, for snags closed before any
  of this existed. Reopening and re-resolving would also work but restamps `resolved_at`, losing
  when the work actually finished.

The reason none of this was needed before is that it was possible to get in without one.
`resolve_snag` — the *niggle* path, no gate at all — cascaded `resolved` to every child of a merged
parent, and `merge_snags` will put an incident under a fixit. Three incidents in Snagv1 were closed
that way with no checklist, no witness, no evidence and no notifiable decision. It now cascades
only to `lane = 'niggle'` children; a serious child keeps its own status and its own gate, and goes
on counting as an open investigation until someone runs one.

**"RCA outstanding" counting resolved snags is not that bug.** An RCA is owed on a serious snag
until one is accepted or `waive_rca` records why it isn't needed, and resolving the snag doesn't
discharge it — a resolved snag in that list is correct. What was missing is why, so
`snag_rca_outstanding` carries the exception reason and a live `unmet_count`, and the mobile
dashboard's expanded rows distinguish "still owed an analysis" from "closed with 4 steps
outstanding · no reason recorded".

## The document library

`org_documents` + the `org-documents` bucket: an org-wide register, distinct from snag-scoped
evidence. **Any org member can read and upload; only a supervisor or admin can delete.**

Both clients reach it — the portal at `/documents`, mobile at Profile → Documents
(`DocumentLibraryScreen`). Workers need upload because someone running a document-mode
investigation has to file the completed document, and because the policies kept here are the ones
workers are expected to follow.

Investigation documents go into the same library rather than a per-snag hiding place, so the
person who needs one in two years — who wasn't on the snag — can find it.

## Supabase MCP (for Claude Code)

If connected, you can use the Supabase MCP to:
- Run SQL migrations: use `execute_sql` or paste into SQL Editor
- Create/list projects: `list_projects`, `create_project`
- Manage storage: create the `issue-photos` bucket

Connect the MCP with:
```bash
claude mcp add supabase https://mcp.supabase.com/mcp
```
Then authenticate with your Supabase credentials.

## GitHub

This project should be pushed to a GitHub repo. Suggested repo name: `snag-app`.

To push from Codespaces or local:
```bash
git init
git add .
git commit -m "Initial scaffold"
git remote add origin https://github.com/YOUR_USERNAME/snag-app.git
git push -u origin main
```

## Running the App

```bash
npm install          # from the repo root — installs every workspace (apps + packages)
npm run mobile        # shortcut for: npm run start --workspace=apps/mobile
```

Scan the QR code with the Expo Go app (iOS/Android) to run on your device.
For a simulator: press `i` for iOS Simulator or `a` for Android emulator.

## Common Tasks for Claude Code

### Add a new mobile screen
1. Create `apps/mobile/src/screens/NewScreen.tsx`
2. Add the route to `packages/shared-types/src/index.ts` (in the appropriate param list) —
   `apps/mobile/src/types/index.ts` just re-exports this package, don't add types there directly
3. Register it in `apps/mobile/src/navigation/index.tsx`

### Add a new Supabase table
1. Write a new timestamped file in `supabase/migrations/` (don't edit past migrations)
2. Apply it to the Snagv1 project (`wpkdpukpllxuyqqlxkxf`) via the Supabase MCP `apply_migration`/
   `execute_sql` tools, or paste it into Supabase → SQL Editor
3. Add the TypeScript type to `packages/shared-types/src/index.ts` — shared by both apps

### Modify the mobile design
- Change tokens in `apps/mobile/src/constants/theme.ts` only — never inline values
- All badge components are in `apps/mobile/src/components/` and centralise their colour logic

### Working on `apps/web`
Read `SNAG_WEB_APP_PLAN.md` first — it covers folder structure, auth strategy, which RPCs/views
to reuse vs. what's a genuine gap, storage, and deployment, and its §10 tracks open decisions.
The scaffold (marketing site, login, portal with dashboard/snags/reports/documents) is built.
`documents/` is a working org-wide document register — upload, list, signed-URL download, delete,
backed by the `org-documents` bucket and the `org_documents` table (see "The document library"
above). It was described here as a stub long after it was finished, which is how it reached
production with zero rows in it; the round trip is now covered by `apps/web/e2e/documents.spec.ts`.
New read-only query functions belong in `packages/supabase-queries` (each takes a `SupabaseClient`
param so both apps can call it with their own client) rather than being written inline in a page
unless it's a one-off simple `select`.

### Add a new portal page
1. Create `apps/web/src/app/(portal)/new-route/page.tsx` — it's inside the `(portal)` route group,
   so `(portal)/layout.tsx` already enforces the supervisor/officer_admin gate for you
2. Reuse `requireSupervisorOrAdmin()` from `src/lib/auth.ts` if the page needs the caller's role/org
3. Add a link to it in `(portal)/layout.tsx`'s `NAV_LINKS`

### Change the onboarding guide
The customer-facing manual lives in **`packages/onboarding-guide`** — one file, structured as
data rather than prose. Four surfaces render it and none of them may disagree:
`apps/mobile`'s `HelpGuideScreen` (Profile → Help & guide), the portal's `/help`, the generated
`SNAG_ONBOARDING_GUIDE.md` + the PDFs in `apps/web/public/`, and the in-app walkthrough below.

1. Edit `packages/onboarding-guide/src/index.ts` — sections carry `roles`, and a role only ever
   sees whole sections, never partial ones
2. Run **`npm run guide`** to regenerate the markdown and the four PDFs, and commit them with
   the change — the generated files are what a customer reads
3. `apps/mobile/src/lib/onboardingGuide.test.ts` ties the mode/severity/gate tables to the
   constants they describe, so adding a gate condition without documenting it fails there
4. `apps/mobile/src/lib/tour.test.ts` fails until a **new section** is either given a
   walkthrough step or named in `TOUR_EXEMPT_SECTIONS` with a reason

Two things about the package's shape are load-bearing. It's **one file** because the generator
imports it with plain Node type-stripping and no bundler — split it and the extensionless
relative import stops resolving. And it builds its tables from `INVESTIGATION_MODE_OPTIONS`,
`SEVERITY_LABELS` and friends rather than re-typing the strings, so a label change in the app
reaches the printed handout on the crib-room wall.

### The guided walkthrough

The first time anyone opens `apps/mobile` it dims the screen, rings one control at a time and
says what to do with it — Back/Next, a Pause, and a "Read more" into the matching guide section.
It replaced a welcome screen and a four-slide carousel that were **worker-only**, so a Site Lead
or Manager who signed up, created an organisation and landed on a four-tab app had never been
told what any of it was.

**Its content is the guide's content.** `TOUR_STEPS` lives in
`packages/onboarding-guide/src/index.ts` next to `GUIDE_SECTIONS`, every step names the
`sectionId` it is drawn from, and `tourStepsForRole` **derives step order from the guide's
section order** rather than declaring it — move a section and its steps move. `npm run guide`
prints the steps as an appendix in the markdown and in each role's PDF, so a trainer's handout
and the phone in a crew member's hand say the same thing.

`tour.test.ts` holds the joins that a type checker can't: section coverage (above), a step's
roles being a subset of its section's, and **anchor liveness** — it scans `apps/mobile/src` for
`<TourAnchor id="…">` and fails if `TOUR_ANCHORS` and the rendered set differ in either
direction. That last one matters because a renamed control is not a type error: `TourAnchor`
would simply never register, the spotlight would fall back to a centred card, and the
walkthrough would go on confidently pointing at nothing.

Three things about the runtime:

- **It is not a `Modal`, and must not become one.** `TourProvider` wraps `RootNavigator` in
  `App.tsx` and draws four scrim rects with a gap between them (`src/lib/tourGeometry.ts`).
  A Modal stacks above the whole navigator — hiding the tab bar the first steps point at — and
  takes every touch, so the control a step is telling somebody to press would be the one thing
  they couldn't press. Being outside the navigator is also why tab switching goes through
  `src/lib/navigationRef.ts` rather than `useNavigation`.
- **The scrim dims but never blocks** (`pointerEvents="none"`). It used to swallow taps outside
  the hole, and that survived exactly until the tab-bar step: the anchor wraps the tab *icon*,
  so the hole stopped just above the word "Report" and the half of the tab people aim at was
  dead. Blocking requires the hole to equal the hit area of every control anyone ever anchors,
  it fails silently, and no test can hold that across future anchors — so it doesn't block.
  `apps/mobile/e2e/tour.spec.ts` clicks the tab *label* to keep it that way.
- **Three steps gate on a real action** (`photo-added`, `kind-chosen`, `snag-submitted`, reported
  via `useTour().completeGate`). Each shows a **Skip this step**: a denied camera permission or an
  org with no sites must not be able to deadlock somebody's first session.
- **Progress is a server column** — `profiles.tour_status`/`tour_step`, written only through
  `set_tour_progress` (`20260803120000` revoked direct profile updates). `src/lib/tourState.ts`
  keeps a per-user AsyncStorage mirror that wins **only when it is newer**, for the one case that
  needs it: paused on a site with no signal, where the server still says `not_started` and
  believing it would restart a first-timer from step one. `done` is absorbing on either side.

## Code Style

- Use functional components + hooks only (no class components)
- All styles via `StyleSheet.create()` at the bottom of each file
- TypeScript strict mode — no `any` except for Supabase row shapes
- Import order: React → React Native → Expo → third-party → local (types, lib, components)
- **`onAuthStateChange` callbacks must be synchronous.** auth-js runs them inside
  its lock and awaits them, so awaiting any Supabase call in one deadlocks the
  client for the life of the page: no request is ever issued again, nothing
  rejects, nothing is logged, and the per-request deadlines never fire because it
  never reaches `fetch`. Set state in the callback; put anything that touches
  Supabase through `queueAuthWork` (`src/lib/authEvents.ts`). A hidden tab
  becoming visible is enough to trigger it — see that file.
- **Never call `Alert.alert` directly — use `showAlert` from `src/lib/alert.ts`.**
  react-native-web's `Alert` is `static alert() {}`, so on the web build (which is
  shipped, at snagv1.netlify.app) a direct call does nothing: the dialog never
  appears, and any action behind a confirmation never runs. `showAlert` is
  `Alert.alert`'s shape on native and `confirm`/`alert` on web, and takes **two
  buttons at most** — a choice between three things needs real UI, not a dialog.
- The same trap applies to every native-only module. `apps/mobile` runs in the
  browser as well as on phones, so before using a platform API, check that it has
  a web implementation — `expo-file-system` has none, and its stub throws rather
  than no-oping. See TESTING.md.
- **The web build runs under a CSP, and nothing local enforces it.** Both hosts
  send one (`apps/mobile/netlify.toml`, `apps/web/next.config.js`), so a URL the
  code fetches has to be in `connect-src` or the request never happens — and a
  browser reports that as the same opaque `TypeError` a dead network gives, which
  the app then words as "no connection". `expo start`, jest and `tsc` all see
  none of this; the header only exists on Netlify. Note `blob:` needs listing per
  directive: `img-src` for a picked photo's preview, `connect-src` for reading
  its bytes, and `'self'` covers neither. `src/lib/csp.test.ts` pins the schemes
  the upload path depends on.
- **`expo-camera` is the opposite trap: it has a web implementation, and that is
  the problem.** Its web entry builds a QR-decoding Web Worker *at module scope*
  from a `blob:` URL that `importScripts` jsQR off `cdn.jsdelivr.net` — so the
  import alone fires it on every page load. The CSP refuses both, and a `blob:`
  worker is governed by `worker-src` → `child-src` → **`script-src`**, so the
  `blob:` in `connect-src` above does not cover it. Import it through
  **`src/lib/camera.ts`**, which Metro resolves to a stub on web
  (`camera.web.ts`); never from `expo-camera` directly. `camera.test.ts` enforces
  that. Widening the CSP instead would put a third-party CDN inside the trust
  boundary of the domain people sign into, for a scanner the web build
  deliberately never offers.

## Hosts

Three, and they are not interchangeable:

| Host | What it serves | Set in |
|---|---|---|
| `www.snaghq.co.nz` | `apps/web` — marketing site **and** supervisor portal, one Next.js app | `apps/web/src/lib/seo.ts` (`SITE_URL`), `SNAG_PORTAL_URL` |
| `app.snaghq.co.nz` | `apps/mobile`'s Expo web export — a **separate Netlify site** | `apps/mobile/src/lib/appUrl.ts`, `NEXT_PUBLIC_SNAG_APP_URL` |
| `snagv1.netlify.app` | the app's previous host, now a Netlify redirect to `app.snaghq.co.nz` | — |

The apex `snaghq.co.nz` redirects to `www`. DNS is Netlify-managed.

`snagv1.netlify.app` has to keep resolving, and not only for tidiness: **site QR
codes encoding it have been printed and put on walls**, and every notification
sent before the move carries it. That is why it stays in
`apps/mobile/src/navigation/linking.ts`'s prefix list rather than being replaced
— the Netlify redirect gets someone to the app, but the prefix list is what
decides whether the path then resolves to the right screen rather than the
default tab.

Never point `NEXT_PUBLIC_SNAG_APP_URL` at the portal host. `/go` only uses it
for visitors it has already decided cannot use the portal, so that sends them to
`/snags/<id>` inside `(portal)`, where `requireSupervisorOrAdmin()` bounces them
to `/unauthorized`, which offers them the app — a loop back to where they
started. The two being subdomains of one domain makes them look more
interchangeable than they are.

## Notification links and the handoff

Every per-snag notification `supabase/functions/notify-snag` sends points at
**`<portal>/go/snag/<id>[?step=]`**, never at a client directly.

That route (`apps/web/src/app/go/snag/[id]/page.tsx`, deliberately *outside*
the `(portal)` group) decides per visitor: a supervisor or officer admin is
redirected straight into the portal, and everyone else is offered the app.
Choosing a client per *event* cannot work — `serious_created` is one email to a
whole site's members, whose roles are mixed, and RCAs are usually assigned to
workers, whom the portal refuses outright.

**Deploy the portal before the function.** The links only resolve once a
portal build containing `/go/snag/[id]` is live, and they are only ever
followed from an inbox — so a mismatch is invisible to the app, to CI, and to
anyone not reading their email. `SNAG_PORTAL_URL` is a Supabase function
secret, so re-pointing it later needs no redeploy.

A signed-out supervisor is sent to `/login?next=<portal path>` so the snag
survives the login round trip. `next` is validated by `src/lib/nextPath.ts` —
same-origin paths only, or it's an open redirect on a domain people trust.

## Who actually sends the mail

Two senders, not one, and they fail independently — so "email works" is never a
single fact about this project:

| Mail | Sent by | Configured in |
|---|---|---|
| Every per-snag notification + the overdue digest | `notify-snag` → Resend's **HTTP API** | `RESEND_API_KEY`, `SNAG_FROM_ADDRESS` (Supabase function secrets) |
| Password recovery (and confirmation, if re-enabled) | **Supabase Auth → Resend's SMTP** | Supabase dashboard → Auth → SMTP Settings |

Same Resend account, two entirely different paths into it, and neither one
tells you when the other breaks.

**The sender address has to be on a verified domain.** `SNAG_FROM_ADDRESS`
defaults to `noreply@snaghq.co.nz` for that reason. It used to default to
Resend's sandbox sender, `onboarding@resend.dev`, which delivers *only* to the
Resend account's own address — so every notification to anybody else was
rejected 403. Nothing said so: `sendEmail` logs the rejection, `notify-snag`
returns 200 regardless, the DB dispatch ignores the response, and no test
covers it. Mail stopped leaving the system on 13 July 2026 and was noticed
three weeks later by reading Resend's dashboard. **If notifications go quiet,
check Resend's Emails list before anything in this repo** — the app cannot tell
you.

**Auth mail is SMTP, and its failures are loud but elsewhere.** Supabase's
built-in SMTP only delivers to members of the Supabase org and does a couple of
messages an hour, so custom SMTP against Resend is what makes recovery real for
an external tester. The credentials are `resend` (literally, lowercase) as the
username and a Resend **API key** as the password. A wrong one gives
`535 "Authentication credentials invalid"` in the **Auth logs** — not in
Resend's, because a rejected SMTP login never creates an email to log.

## Resetting a password

**One landing page, `<portal>/reset-password`, and both clients point at it.**
It sits outside the `(portal)` group deliberately: workers are most of the
people who need it, and `requireSupervisorOrAdmin()` would bounce them to
`/unauthorized`.

The thing to understand before changing any of it is **why nothing here uses
PKCE**:

- `@supabase/ssr` forces `flowType: 'pkce'` on both its clients, and a PKCE
  recovery link only works in the browser that asked for it — auth-js's
  `_isPKCECallback` wants the `code` *and* a stored code verifier, and with the
  verifier missing it returns false, so the link isn't recognised as a callback
  at all. Nothing happens and nothing is said.
- Asking on a laptop and opening the mail on a phone is the normal case, not
  the edge case. And the app's own "Forgot password?" hands off from a
  completely different origin, where the verifier could never exist.

So `forgot-password/actions.ts` deliberately builds a **plain**
`@supabase/supabase-js` client on the implicit flow rather than using
`@/lib/supabase/server`, and `apps/mobile`'s `sendPasswordReset` points
`redirectTo` at `<portal>/reset-password` rather than at the app. The tokens
then arrive in the URL **fragment**, which is why the landing page is a client
component — the server never sees a fragment and would call a valid link
invalid. There is no `/auth/callback` route, and adding one would be a sign
somebody had reintroduced the code-exchange flow.

Mobile has **no recovery screen of its own**, on purpose, and `App.tsx` has no
`PASSWORD_RECOVERY` gate. One consequence worth knowing: the Supabase
dashboard's **Send password recovery** button sends no `redirectTo`, so it
falls back to the project's Site URL. Point that at the app and the button
produces a link that silently signs someone in without ever asking for a new
password. Test recovery through `/forgot-password`, not through the dashboard.

Every redirect target has to be on the allow-list at Supabase → Auth → URL
Configuration → Redirect URLs — today that means `<portal>/reset-password`. An
address that isn't on it doesn't error: Auth quietly substitutes the Site URL,
and the link lands on a homepage instead of a password form.

## Deep links

Both clients route **`/snags/:id`**, and both accept **`?step=`** naming one
section of a serious snag (`notifiable`, `checklist`, `witnesses`, `evidence`,
`rootCause`, `correctiveActions`, `investigationDocument`, `rca`, `debrief` —
`SnagStepKey` in `packages/shared-types`). `rootCause`/`correctiveActions`
render only in `snag` mode and `investigationDocument` only in `document` mode,
so a link to the wrong one lands on the snag with nothing expanded rather than
erroring. One link therefore works whichever client
`SNAG_APP_URL` points at, which is what `supabase/functions/notify-snag` relies
on when it mails someone about an RCA.

- Mobile: `apps/mobile/src/navigation/linking.ts`, wired into
  `NavigationContainer`. Native uses the `snag://` scheme from `app.json`.
  `IssueDetail` takes an optional `step` param and opens that card on arrival.
- Web: `(portal)/snags/[id]/page.tsx` reads `?step=` and passes `defaultOpen`
  to the matching `StepSection`.

Two things to keep in mind when changing this. The web build is
`output: "single"`, so a path with no route still serves the app shell and
returns 200 — a broken link fails silently rather than 404ing (which is how
`/snags/:id/rca` survived in the notification emails for as long as it did).
And `/` is deliberately unmapped in the mobile linking config: an unmatched URL
leaves the tab navigator on its `initialRouteName`, which is what carries the
post-onboarding tab.

### Which tab you land on, on the web build

`initialRouteName` is `Report`, but a *matched* path beats it — and on the web
build React Navigation writes the URL back on every navigation and re-reads it
when `NavigationContainer` mounts. Sign Out lives on the Profile tab, so the
address bar always read `/profile` when the session ended, and `AuthScreen`
renders with the navigator unmounted and the URL untouched. Signing back in
therefore landed everyone on Profile, for no reason anything on the page could
explain.

`resetWebPathIfStale` (`apps/mobile/src/lib/webLocation.ts`) clears the path on
`SIGNED_OUT` and `SIGNED_IN`, keeping the two URLs somebody meant to arrive at:
`/snags/<id>` (what `notify-snag` mails, and it has to survive the sign-in round
trip) and `?report=<token>` (the QR landing). Deliberately not `INITIAL_SESSION`
— reloading the page on a tab is not logging in, and staying put is what a
browser is supposed to do. Unit-tested in `webLocation.test.ts`; it no-ops off
web.

### The home screen icon

`apps/mobile` is installed from the browser, not a store — people add
`app.snaghq.co.nz` to their home screen. The icon that ends up there came out
visibly blurrier than every app beside it, and the reason was never the artwork:
`assets/icon.png` has been a clean 1024x1024 the whole time.

Expo's web export publishes **one** icon and no way to configure it.
`getFaviconFromExpoConfigAsync` hardcodes `dims = [16, 32, 48]`, and its
injector adds a single `<link rel="icon">` — no web app manifest, no
`apple-touch-icon`. So the largest icon the app offered was 48px, and a launcher
asking for ~192px had nothing to do but scale it up 4x.

The fix is `apps/mobile/public/`, which `copyPublicFolderAsync` copies verbatim
into `dist/`:

- **`manifest.webmanifest`** — 192 and 512 PNGs, `display: standalone`,
  `start_url: "/"`. The icons are `purpose: "any maskable"` on the same files
  rather than a separate maskable set, because the source is full-bleed
  `#2563EB` with the mark 29.5% out from centre, inside the 40% safe radius
  Android masks to. Re-measure before changing the artwork.
- **`index.html`** — overrides Expo's HTML shell (`getTemplateIndexHtmlAsync`
  prefers `public/index.html` over the CLI's bundled template), adding the
  manifest link, `apple-touch-icon` — iOS ignores the manifest and reads only
  that, so both have to be stated — and the standalone metas.

**Never name `%LANG_ISO_CODE%` or `%WEB_TITLE%` above the tags that use them.**
`createTemplateHtmlAsync` substitutes with `String.replace`, which takes the
first occurrence only — so a token mentioned in a comment absorbs the value and
the real tag ships the literal placeholder. That exports cleanly, exits 0, and
puts a browser tab reading `%WEB_TITLE%` into production. `webManifest.test.ts`
asserts each token appears exactly once for that reason, alongside the icons
existing at the sizes the manifest advertises and the manifest agreeing with
app.json's `web` block.

The manifest's `Content-Type` is pinned in `netlify.toml`: served as anything
but a JSON media type it is rejected outright, and the symptom is the old blurry
favicon quietly coming back.

None of this is visible from inside the repo — the build succeeds and the app
runs either way. It shows up on somebody's phone, which is why the guardrails
are tests rather than a comment.
