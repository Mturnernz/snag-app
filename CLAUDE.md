# SNAG — Claude Code Instructions

This file tells Claude Code everything it needs to know to work effectively on this project.

## What is SNAG?

A React Native / Expo mobile app for workplace issue reporting. Workers photograph and report
problems (broken equipment, health & safety hazards, niggles). Managers can triage, assign,
and resolve issues. Built on Supabase for auth, database, and file storage.

## Tech Stack

| Layer | Choice |
|---|---|
| Mobile framework | Expo SDK 52 (React Native 0.76) |
| Language | TypeScript (strict mode) |
| Navigation | React Navigation v6 — bottom tabs + native stack |
| Backend | Supabase (Auth, Postgres, Storage) |
| State | React hooks (no external state library yet) |

## Project Structure

```
snag/
├── App.tsx                        # Entry point — NavigationContainer + SafeAreaProvider
├── src/
│   ├── constants/
│   │   └── theme.ts               # ALL design tokens — colours, spacing, typography, radii
│   ├── lib/
│   │   └── supabase.ts            # Supabase client, auth helpers, storage upload
│   ├── types/
│   │   └── index.ts               # Shared TypeScript types, enums, display label maps
│   ├── navigation/
│   │   └── index.tsx              # RootNavigator (Stack) + MainTabNavigator (Bottom Tabs)
│   ├── screens/
│   │   ├── IssueListScreen.tsx    # Tab 1 — scrollable list with filter chips
│   │   ├── ReportIssueScreen.tsx  # Tab 2 — photo + form to submit a new issue
│   │   ├── IssueDetailScreen.tsx  # Pushed screen — full detail + comments
│   │   └── ProfileScreen.tsx      # Tab 3 — user info, invite code, sign out
│   └── components/
│       ├── IssueCard.tsx          # List card: photo, title, badges, meta
│       ├── StatusBadge.tsx        # Coloured pill: flagged / in_progress / resolved / rca_pending
│       ├── PriorityBadge.tsx      # Coloured pill: severity (minor/moderate/injury/critical)
│       └── CategoryBadge.tsx      # Coloured pill: fixit / improvement / hazard / incident
├── supabase/
│   ├── migrations/                # Real Snagv1 schema history (source of truth — see below)
│   ├── functions/                 # Deployed edge functions (notify-snag, export-investigation, ...)
│   └── schema.sql                 # Stale prototype scaffold — do not run against Snagv1
└── .env.example                   # Copy to .env — add your Supabase URL + anon key
```

## Design System (DO NOT deviate from these)

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

## Environment Setup

1. Copy `.env.example` → `.env`
2. Fill in `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY`
   (Settings → API in your Supabase project dashboard)

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
screens (mirrored in the mobile app's `src/types/index.ts`).

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
npm install
npx expo start
```

Scan the QR code with the Expo Go app (iOS/Android) to run on your device.
For a simulator: press `i` for iOS Simulator or `a` for Android emulator.

## Common Tasks for Claude Code

### Add a new screen
1. Create `src/screens/NewScreen.tsx`
2. Add the route to `src/types/index.ts` (in the appropriate param list)
3. Register it in `src/navigation/index.tsx`

### Add a new Supabase table
1. Write a new timestamped file in `supabase/migrations/` (don't edit past migrations)
2. Apply it to the Snagv1 project (`wpkdpukpllxuyqqlxkxf`) via the Supabase MCP `apply_migration`/
   `execute_sql` tools, or paste it into Supabase → SQL Editor
3. Add the TypeScript type to `src/types/index.ts`

### Modify the design
- Change tokens in `src/constants/theme.ts` only — never inline values
- All badge components are in `src/components/` and centralise their colour logic

### Add real auth screens
The app currently assumes the user is already authenticated. To add login/signup:
1. Create `src/screens/AuthScreen.tsx` with email + password form
2. Use `signInWithEmail` / `signUpWithEmail` from `src/lib/supabase.ts`
3. Wrap the navigator in App.tsx with an auth state listener:
   ```tsx
   supabase.auth.onAuthStateChange((event, session) => { ... })
   ```

## Code Style

- Use functional components + hooks only (no class components)
- All styles via `StyleSheet.create()` at the bottom of each file
- TypeScript strict mode — no `any` except for Supabase row shapes
- Import order: React → React Native → Expo → third-party → local (types, lib, components)
