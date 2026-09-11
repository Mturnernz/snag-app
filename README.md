# Snag

A shared list of the things that need doing around the house. Photograph a problem, and it goes
on a list the household works through — with the jobs you'd otherwise forget (gutters, filters,
smoke alarm batteries) coming back round on their own.

Built for two people, on the infrastructure of a retired workplace health-and-safety product of
the same name. See `SNAG_HOME_PIVOT_REVIEW.md` for why, and `CLAUDE.md` for how.

## What it does

- **Add** — a photo, a title, a room. Ten seconds, standing up.
- **Sort it out** — priority, effort, whether it needs a trip to the shop, when it's due, who's
  doing it. Later, sitting down.
- **Free weekend?** — what fits the time you've got, grouped by room, with everything waiting on
  a hardware-store trip collected into one list at the top.

## Running it

```bash
npm install     # repo root
npm run mobile  # Expo — scan the QR code with Expo Go, or press w for the browser
```

Copy `apps/mobile/.env.example` to `apps/mobile/.env` and fill in the Supabase URL and anon key
first.

## Layout

| | |
|---|---|
| `apps/mobile` | the app |
| `apps/web` | password recovery, and nothing else — see CLAUDE.md for why it can't live in the app |
| `packages/shared-types` | enums, row types, labels, navigation params |
| `packages/supabase-queries` | every read and write |
| `supabase/migrations` | `20260911*` is the current schema; everything before it is the archive |

## Tests

```bash
npm run typecheck
npm run test:mobile        # jest
npm run test:e2e:mobile    # Playwright against the Expo web build
```
