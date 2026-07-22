# SNAG

A workplace issue-reporting platform: an Expo/React Native mobile app (`apps/mobile`) and — in
progress — a Next.js marketing site and supervisor portal (`apps/web`), both built on the same
Supabase project. This is an npm-workspaces monorepo.

## Quick Start (mobile app)

```bash
# 1. Install dependencies (from the repo root — installs every workspace)
npm install

# 2. Configure environment
cp apps/mobile/.env.example apps/mobile/.env
# Edit apps/mobile/.env and add your Supabase URL and anon key

# 3. Start the app
npm run mobile
```

The database is a live Supabase project, not something you set up locally — see `CLAUDE.md`'s
"Database" section before touching `supabase/schema.sql` or the `migration_*.sql` files at the
repo root (both are stale prototype leftovers, not the real schema).

See `CLAUDE.md` for the full developer guide, including how to connect Claude Code and Supabase MCP.
See `SNAG_WEB_APP_PLAN.md` for the `apps/web` initiation plan.
