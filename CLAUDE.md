# SNAG — Claude Code Instructions

This file tells Claude Code everything it needs to know to work effectively on this project.

**Read `MVP-SPEC.md` (product intent + golden rules) and
`Snag-Architecture-Build-Plan.md` (system layout, backend contract,
milestones) before any non-trivial work.** The golden rules there —
migrations only, RLS everywhere with RPC-only writes, append-only evidence,
snags never deleted, secrets via Vault/env, one PR per milestone — override
anything else in this file.

## Two products live in this repo — know which one you're touching

1. **Snagv1 (the live product)** — the web app in `apps/web` +
   the Supabase project `wpkdpukpllxuyqqlxkxf` (migrations in
   `supabase/migrations/`, edge functions `notify-snag` and
   `export-investigation` in `supabase/functions/`). Deployed at
   snagv1.netlify.app. **All current work happens here.**
2. **Legacy mobile prototype** — the Expo app at the repo root (`App.tsx`,
   `src/`), built against a different, now-INACTIVE Supabase project whose
   schema is `supabase/schema.sql` (plus the `award-points` function).
   The rest of this file documents that prototype; leave it alone unless
   explicitly asked.

## What is SNAG? (legacy mobile prototype)

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
│       ├── StatusBadge.tsx        # Coloured pill: open / in_progress / resolved / closed
│       ├── PriorityBadge.tsx      # Coloured pill: low / medium / high
│       └── CategoryBadge.tsx      # Coloured pill: niggle / broken_equipment / etc.
├── supabase/
│   └── schema.sql                 # Full Postgres schema — run this first in Supabase SQL Editor
└── .env.example                   # Copy to .env — add your Supabase URL + anon key
```

## Design System (DO NOT deviate from these)

All tokens are in `src/constants/theme.ts`. Never hardcode colours or spacing values inline.

- **Background**: `#F9FAFB` (near-white)
- **Surface / cards**: `#FFFFFF`
- **Border**: `#E5E7EB` (1px, no shadows)
- **Primary accent**: `#2563EB` (Tailwind blue-600)
- **Text**: primary `#111827`, secondary `#6B7280`, muted `#9CA3AF`
- **Card radius**: 12px | **Button radius**: 8px | **Chip radius**: 4px
- **Minimum touch target**: 48px (use `MIN_TOUCH_TARGET` constant)
- **Font**: System (San Francisco on iOS) — no custom typeface
- **Light mode only** — no dark mode handling needed

## Environment Setup

1. Copy `.env.example` → `.env`
2. Fill in `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY`
   (Settings → API in your Supabase project dashboard)

## Database

Schema is in `supabase/schema.sql`. Run it in Supabase → SQL Editor → New Query.

Key tables: `organisations`, `profiles`, `issues`, `comments`

Key view: `issues_with_details` — issues joined with reporter/assignee names + comment count.
Always query this view for the issue list and detail screen.

After running the schema, create a **public** Storage bucket named `issue-photos` in
Supabase → Storage → New Bucket.

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
1. Write the migration SQL in `supabase/schema.sql` (append, don't replace)
2. Run it in Supabase SQL Editor
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
