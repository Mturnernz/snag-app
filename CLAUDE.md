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
| Mobile framework | Expo SDK 52 (React Native 0.76), `apps/mobile` |
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

`snag_status` is `flagged | in_progress | resolved | rca_pending` — `resolved` is the single
terminal status for both the niggle lane (fixit/improvement) and the serious lane
(hazard/incident); serious snags can only reach it once the investigation is complete
(`update_snag_status`'s notifiable/checklist/witness/evidence checks, then whichever pair the
investigation mode calls for — see below). There is no separate "sorted" status — it was retired
and collapsed into `resolved`.

Photos/evidence go to the `snag-photos` and `snag-evidence` Storage buckets (private,
org-folder-scoped via RLS), not a public `issue-photos` bucket. Org-wide documents live in
`org-documents` / `org_documents` — see "The document library" below.

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
  a web implementation — `expo-file-system` and `expo-camera` have none, and
  `expo-file-system`'s stub throws rather than no-oping. See TESTING.md.

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
