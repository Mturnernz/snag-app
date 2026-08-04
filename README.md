# SNAG

A workplace issue-reporting platform, in two parts on one Supabase project:

- **`apps/mobile`** — an Expo / React Native app. Where snags are reported and worked on.
- **`apps/web`** — a Next.js marketing site and supervisor portal. Where snags are managed
  and reviewed. It does not report; that's the app's job.

This is an npm-workspaces monorepo — run `npm install` once at the root, never inside a
workspace.

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

## The portal

```bash
cp apps/web/.env.example apps/web/.env.local   # same Supabase project as mobile
npm run web                                     # http://localhost:3000
```

## The onboarding guide

[`SNAG_ONBOARDING_GUIDE.md`](SNAG_ONBOARDING_GUIDE.md) — how the app works, written for the
people using it rather than for the people building it. New customers use it to set their
organisation up and to train their crew.

It's generated, not written: the source is `packages/onboarding-guide`, which both clients also
render in-app (Profile → Help & guide, and the portal's `/help`), filtered to the reader's role.

```bash
npm run guide     # regenerates the markdown and the PDFs in apps/web/public/
```

Printable handouts land at `apps/web/public/` — the full guide plus one per role.

## Tests

```bash
npm run typecheck
npm test          # units, then web e2e, then mobile e2e
```

See `TESTING.md` for the tiers, what each needs, and the write-path suite's safety fences.

## Database

The database is a **live Supabase project** (Snagv1), not something you stand up locally. The
real schema history is `supabase/migrations/` — snapshots, not to be re-applied. Read
`CLAUDE.md`'s "Database" section before changing anything.

## Where to read next

| Document | What it covers |
|---|---|
| `CLAUDE.md` | Developer guide: structure, design systems, deep links, common tasks |
| `TESTING.md` | Test tiers, running them, the QA org, network caveats |
| `PRODUCTION_READINESS.md` | What's production-ready, what isn't, and the decisions still open |
| `SNAG_WEB_APP_PLAN.md` | How `apps/web` came to exist |
