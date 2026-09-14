# Snag

A shared list of the things that need doing around the house. Photograph a problem, and it goes
on a list the household works through — with the jobs you'd otherwise forget (gutters, filters,
smoke alarm batteries) coming back round on their own.

Built for two people, on the infrastructure of a retired workplace health-and-safety product of
the same name. See `SNAG_HOME_PIVOT_REVIEW.md` for why, and `CLAUDE.md` for how.

## What it does

- **Add** — a photo, or a line of text, from the bar at the foot of the list. No title and no
  form: ten seconds, standing up, and the questions come after it's saved.
- **Sort it out** — what it needs from the shop, when it's due, whether it comes round, who's
  doing it, how urgent. Later, sitting down.
- **The house** — what's *there* beside what's wrong: the heat pump's model number, the paint
  colour in the bathroom, the manual. Read back eight months later in a hardware aisle.
- **The schedule** — the same jobs by date instead of by room, including the repeating ones. It
  reads the list and never writes to it.

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
