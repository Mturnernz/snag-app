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
- **Text**: primary `#111827`, secondary `#6B7280`, muted `#9CA3AF`
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

The app's live backend is the **Snagv1** Supabase project (`wpkdpukpllxuyqqlxkxf`), not the
`schema.sql` scaffold below. `supabase/schema.sql` and `supabase/migration_*.sql` are leftovers
from an earlier, now-inactive prototype project and do not reflect what's deployed — don't run them
against Snagv1. The real schema history lives in `supabase/migrations/` (recovered from Snagv1's
`schema_migrations`, timestamped, "SNAPSHOT — do NOT re-apply") and in `MVP-SPEC.md` /
`Snag-Architecture-Build-Plan.md` at the repo root.

Key tables: `organisations`, `profiles`, `sites`, `snags`, `comments`, `votes`, plus the
investigation/RCA/debrief tables (`checklist_completions`, `witness_statements`,
`evidence_items`, `investigations`, `corrective_actions`, `snag_rca`, `rca_why_steps`,
`snag_debriefs`).

Key view: `snags_with_details` — snags joined with reporter/owner/site names and
comment/evidence/vote/checklist counts. Always query this view for the issue list and detail
screens (mirrored in `packages/shared-types/src/index.ts`, shared by both apps).

`snag_status` is `flagged | in_progress | resolved | rca_pending` — `resolved` is the single
terminal status for both the niggle lane (fixit/improvement) and the serious lane
(hazard/incident); serious snags can only reach it once the guided investigation
(`update_snag_status`'s checklist/witness/evidence/root-cause/corrective-action checks) is
complete. There is no separate "sorted" status — it was retired and collapsed into `resolved`.

Photos/evidence go to the `snag-photos` and `snag-evidence` Storage buckets (private,
org-folder-scoped via RLS), not a public `issue-photos` bucket.

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
The scaffold (marketing site, login, portal with dashboard/snags/reports) is built; `documents/`
is a deliberate stub pending decision D2 (snag-scoped evidence vs. a general document library).
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
