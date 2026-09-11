# SNAG — Claude Code Instructions

This file tells Claude Code everything it needs to know to work effectively on this project.

## What is SNAG?

A React Native / Expo app for tracking things that need doing around a house. Someone
photographs a problem — a broken toilet seat, a filter due for changing — and it goes on a
shared list the household works through. Two people today; a shared bach is the plausible
second shape (see below).

**It was, until September 2026, a workplace health-and-safety product** (SnagHQ: hazard and
incident reporting, investigations, RCA, HSWA compliance). That is retired. The pre-pivot state
is commit `604a62c` on `main`, and the reasoning behind every decision below is in
`SNAG_HOME_PIVOT_REVIEW.md`. When something here looks over-engineered for a household, check
there before "simplifying" it — several things are deliberate.

## Tech Stack

| Layer | Choice |
|---|---|
| Mobile framework | Expo SDK 54 (React Native 0.81, React 19), `apps/mobile` |
| Web | Next.js, `apps/web` — reduced to password recovery, see below |
| Language | TypeScript (strict mode) |
| Navigation | React Navigation v6 — bottom tabs + native stack |
| Backend | Supabase — the `home` schema of the Snagv1 project |
| State | React hooks + two contexts (`useHousehold`, `useToast`) |
| Monorepo | npm workspaces (`apps/*`, `packages/*`) |

## Project Structure

An **npm-workspaces monorepo** — run `npm install` once at the repo root, not inside individual
apps or packages.

```
snag/
├── apps/
│   ├── mobile/                    # the app
│   │   ├── App.tsx                # three gates: signed in? in a household? go.
│   │   └── src/
│   │       ├── constants/theme.ts # ALL design tokens
│   │       ├── lib/supabase.ts    # client (schema: home), auth, photo upload
│   │       ├── hooks/useHousehold.tsx
│   │       ├── screens/           # Capture, SnagList, Weekend, SnagDetail, Household, Profile, Auth, Setup
│   │       └── components/
│   └── web/                       # Next.js — /, /forgot-password, /reset-password. That's it.
├── packages/
│   ├── shared-types/              # @snag/shared-types — enums, row types, labels, nav params
│   └── supabase-queries/          # @snag/supabase-queries — every read and write, each taking a client
├── supabase/migrations/           # 20260911* is the home schema; everything before it is the archive
├── SNAG_HOME_PIVOT_REVIEW.md      # why the pivot was done this way
└── SNAG_INFRA_NOTES.md            # the config that isn't in git
```

## The one setting no migration can create

**Supabase → Settings → API → Exposed schemas must include `home`.**

It lives in the platform, not the database, so nothing in this repo can create or check it. When
it's missing PostgREST answers *every* call with `PGRST106` and the app reads as an account with
no data in it — empty lists, no household, no error.

That is now caught rather than silent: `SchemaNotExposedError` in `packages/supabase-queries`
names it, and `App.tsx` shows it instead of rendering an empty shell. If someone reports "the app
is blank", this is the first thing to check.

## Two schemas in one project

The Snagv1 project (`wpkdpukpllxuyqqlxkxf`) holds both:

- **`home`** — this product. Seven tables: `households`, `profiles`, `household_members`,
  `properties`, `locations`, `snags`, `comments`. Plus `snags_with_details`, the view every list
  and detail screen reads.
- **`public`** — the retired B2B product, **frozen**. 35 tables, 112 migrations, 6 pilot orgs and
  57 snags. Not migrated, not dropped, not read from. Leaving it intact *is* the archive, which
  is why the pivot needed no destructive migration and why there's no schema dump anywhere.

Don't write to `public`. Don't "tidy" it. Don't copy patterns out of its migrations without
reading why they were there — a lot of them answer regulatory questions a house doesn't have.

### Writes go through RPCs

There are deliberately **no insert/update/delete policies** on any `home` table. Every write is a
SECURITY DEFINER function. This is the one discipline worth keeping from the retired product: it
means the shape of a write can change in one migration without hunting through client code.

### Grant by name, never by sweep

`20260803120200` in the retired product swept the schema granting `authenticated` everything
outside a small anon allow-list, and handed ten internal functions — including a scheduled
data-deletion job — to any signed-in caller. **A sweep that grants needs both lists; a sweep that
only revokes needs neither.** The home schema's grants are written out one by one.

### An RLS policy's functions need EXECUTE

A policy expression is evaluated as the *calling* role. `home.is_member` is called by every read
policy, so revoking it from `authenticated` doesn't return zero rows — it raises
`42501: permission denied for function is_member` on every single read. That happened during the
first migration and is why `20260911093000` exists.

The three helpers only ever called from *inside* SECURITY DEFINER functions (`require_member`,
`snag_household`, `is_member_profile`) stay revoked, because those calls run as the function
owner and the caller's EXECUTE is never consulted.

## Capture and triage are different moments

This is the load-bearing product decision and the easiest one to erode.

**Capture** (`CaptureScreen`) is a photo, a location tag, high-or-low, and one optional line.
Three taps and no keyboard in the common case. It is used standing in the bathroom holding a
broken toilet seat, with about ten seconds of patience.

Three things about it are load-bearing:

- **There is no title column.** A photo says what a title would, and requiring one put a keyboard
  between someone and the problem in front of them. A snag needs a photo *or* a description
  (`snags_has_something`), and `create_snag` refuses the empty case in words rather than letting
  the constraint name surface. `snagHeadline` supplies what the list shows for a photo-only snag.
- **Locations are a seeded pick-list** (`home.locations`, twelve rows written by
  `seed_locations` at household creation), not free text. A suggestion list derived from past use
  is empty on the one day that matters — the day the app is installed. `snags.room` stays TEXT
  rather than a foreign key, so the list query needs no join and renaming a location later
  doesn't rewrite the history of snags filed under the old name.
- **Priority is set at capture**, and is the one deliberate exception to the split below. It is
  the single judgement only the person standing there can make. Two values; a third would need
  thinking about.

**Triage** (`SnagDetailScreen`) is everything else — effort, needs-parts, due date, repeat,
assignee, and changing priority afterwards — done later, sitting down, from the list. Each
control writes immediately rather than collecting into a form with a Save button, because triage
is a series of small independent decisions and a Save button turns sorting twelve items into
forty taps.

**Do not add a fifth thing to the capture form.** Everything there is friction at the exact
moment friction costs most. The place for it is triage.

## Why the app exists at all

Not to transmit a job — saying it out loud does that. It's to hold work that sits *below the
threshold of action* until a moment when the threshold drops: a free Saturday, a trip to the
hardware store you're making anyway. Two kinds, same kind:

- **Calendar-forgotten** — gutters, smoke alarm batteries, the heat pump filter. Handled by
  `due_at` + `repeat_days`.
- **Threshold-forgotten** — the toilet seat. Never urgent enough alone, worth doing when three of
  them can be done together. Handled by the weekend view.

`WeekendScreen` is the part a filtered list can't do. It's bounded by **time available** rather
than importance, groups by **room** because that's how work is batched (you do the garage once),
and pulls **needs-parts** out to the top as a shopping list — the trip to the shop is the single
most common reason a small job stays undone for weeks.

## Recurring items have no scheduler

Marking a repeating snag done doesn't close it. `home.set_snag_status` rolls `due_at` forward by
`repeat_days`, records `last_done_at`, and leaves the status `open`. That's the entire feature —
no second table, no cron, no notifications.

Two consequences: `done_at` alone would lose the fact a repeating job was ever completed, which
is why `last_done_at` exists; and callers must re-read the returned snag rather than assuming the
status they asked for. `SnagDetailScreen` says what actually happened rather than "Done".

## Two things in the schema the UI never touches

Both are there so the **shared bach** — a family reports, the owner fixes — isn't a rewrite. See
`SNAG_HOME_PIVOT_REVIEW.md` for the full argument. Neither costs a screen.

- **`snags.property_id`** is `not null` against a single auto-created `Home`, and the concept is
  hidden in the UI. Adding a not-null FK to a populated table later means a migration, a backfill
  and a change to every query. A room is not a property: rooms are free text, properties are rows.
- **`household_members.role`** exists with nothing reading it. Everyone in a household sees and
  does everything, and there are **no role checks in the UI at all**. Don't add one.

## Locations are seeded, not administered and not derived

`home.locations` holds the tags offered at capture, seeded per household by `seed_locations`:
Kitchen, Bathroom, Bedroom, Living room, Laundry, Hallway, Garage, Outside, Deck, Roof, Under the
house, Elsewhere. `getLocations` reads them in seeded order and feeds both the capture chips and
the list filter.

Nobody sets this up, and nobody has to earn it by logging something first. There is no UI for
adding a thirteenth — `Elsewhere` is the escape hatch, and a household that genuinely needs
"Sleepout" gets one RPC and one row. That is the obvious next thing here, not a gap to work
around.

## Adding someone to a household

`home.add_member_by_email`, against an account that already exists. No tokens, no email delivery,
no pending state.

That's deliberate, not lazy. The retired product's `invite_user` wrote the invite row and
returned — the RPC succeeded, the app toasted "Invite sent", the invite listed as pending, and
**no invite was ever emailed for the entire life of the feature**. Nothing said so. Don't
reintroduce a mechanism that can fail silently for two people who live in the same house.

## Design System (DO NOT deviate)

All tokens in `apps/mobile/src/constants/theme.ts`. Never hardcode colours, spacing or shadows.

- **Background** `#F9FAFB` · **Surface** `#FFFFFF` · **Border** `#E5E7EB` · **Primary** `#2563EB`
- **Text**: primary `#111827`, secondary `#4B5563`, muted `#6B7280` — deliberately darker than
  the Tailwind greys they resemble; at WCAG AA (4.5:1) there is no room for a lighter muted on
  this background.
- **Elevation**: the `Shadow` scale (`sm` list cards, `md` standalone cards, `lg` modals). An
  elevated card drops its border; never both.
- **Card radius** 12px · **Button radius** 8px · **Chip radius** 4px
- **Icons**: `@expo/vector-icons` (Ionicons) via the shared `Icon` component — never emoji.
  `-outline` by default; filled reserved for the active tab.
- **Minimum touch target** 48px (`MIN_TOUCH_TARGET`)
- **Light mode only.**

Three badges carry the triage vocabulary, and their colour budget is deliberate:

- **`StatusBadge`** — open / doing / done.
- **`PriorityBadge`** — only `now` gets an alert colour; `soon` and `someday` are neutral dots, so
  a second saturated hue can't collide with status on the same card.
- **`EffortBadge`** — deliberately colourless. Effort answers "can I finish this today", which is
  not an alarm.
- **`DueBadge`** — overdue is the one thing on a household list that has earned red. It's a fact
  about a date, not a judgement about importance.

## Code Style

- Functional components + hooks only.
- All styles via `StyleSheet.create()` at the bottom of each file.
- TypeScript strict — no `any` except Supabase row shapes.
- Import order: React → React Native → Expo → third-party → local.
- **`onAuthStateChange` callbacks must be synchronous.** auth-js runs them inside its lock and
  awaits them, so awaiting any Supabase call in one deadlocks the client for the life of the
  page: no request is ever issued again, nothing rejects, nothing is logged, and the per-request
  deadlines never fire because it never reaches `fetch`. A hidden tab becoming visible is enough
  to trigger it. Set state in the callback; put anything touching Supabase through
  `queueAuthWork` (`src/lib/authEvents.ts`).
- **Never call `Alert.alert` directly — use `showAlert` from `src/lib/alert.ts`.**
  react-native-web's `Alert` is `static alert() {}`, so on the web build (which is what people
  actually install) a direct call does nothing: the dialog never appears and any action behind a
  confirmation never runs. `showAlert` takes **two buttons at most**.
- The same trap applies to every native-only module. `apps/mobile` runs in the browser as well as
  on phones, so check a platform API has a web implementation before using it — `expo-file-system`
  has none, and its stub throws rather than no-oping. See TESTING.md.
- **The web build runs under a CSP, and nothing local enforces it.** `apps/mobile/netlify.toml`
  sends one, so a URL the code fetches has to be in `connect-src` or the request never happens —
  and a browser reports that as the same opaque `TypeError` a dead network gives, which the app
  then words as "no connection". `expo start`, jest and `tsc` see none of this. Note `blob:` needs
  listing per directive: `img-src` for a picked photo's preview, `connect-src` for reading its
  bytes, and `'self'` covers neither. `src/lib/csp.test.ts` pins the schemes the upload path
  depends on.
- **Every request has a deadline** (`fetchWithTimeout` in `lib/supabase.ts`). supabase-js sets
  none, and it resolves an access token before every request — so one stalled `/auth/v1/token`
  refresh leaves `getSession()` pending forever and no later call is ever issued at all. Nothing
  reaches the server, nothing rejects, the loaded screen keeps rendering, and the only symptom is
  a button that spins forever. `e2e/stalled-network.spec.ts` pins it.
- **Sign out must not depend on the session working.** It's the escape hatch from a broken
  session, so `signOut` is bounded and falls back to dropping the stored session directly. Local
  scope, not global: signing out of a device means that device.

## Hosts

| Host | What it serves |
|---|---|
| `app.snaghq.co.nz` | `apps/mobile`'s Expo web export — the app people install |
| `www.snaghq.co.nz` | `apps/web` — the root page and password recovery, nothing else |
| `snagv1.netlify.app` | redirect to `app.snaghq.co.nz` |

`snagv1.netlify.app` has to keep resolving, and not only for tidiness: **QR codes encoding it were
printed and put on walls**. That's why it stays in `linking.ts`'s prefix list — the Netlify
redirect gets someone to the app, but the prefix list decides whether the path then resolves to
the right screen rather than the default tab.

## Why apps/web still exists

One reason: **password recovery has to land on a plain web page.**

`@supabase/ssr` forces PKCE, and a PKCE recovery link only works in the browser that asked for it
— auth-js wants the `code` *and* a stored verifier, and with the verifier missing it doesn't
recognise the link as a callback at all. Nothing happens and nothing is said. Asking on a laptop
and opening the mail on a phone is the normal case.

So `forgot-password/actions.ts` builds a **plain** `supabase-js` client on the implicit flow, the
tokens arrive in the URL **fragment**, and `/reset-password` is therefore a client component — a
server component never sees a fragment and would call a valid link invalid.

`apps/mobile`'s `sendPasswordReset` points at `<portal>/reset-password`. **Mobile has no recovery
screen of its own, by design.** If this deploy goes away, account recovery goes with it and
nothing in the app will say so.

Every redirect target must be on the allow-list at Supabase → Auth → URL Configuration. An address
that isn't on it doesn't error: Auth quietly substitutes the Site URL and the link lands on a
homepage instead of a password form. And don't test recovery with the dashboard's **Send password
recovery** button — it sends no `redirectTo`, so it can produce a link that signs someone in
without ever asking for a new password.

## Deep links

`/snags/:id` is the one that matters — it's what someone sends when they want the other person to
look at something. `apps/mobile/src/navigation/linking.ts`, wired into `NavigationContainer`;
native uses the `snag://` scheme from `app.json`.

`/` is deliberately unmapped: an unmatched URL leaves the tab navigator on its `initialRouteName`,
which is what lands someone on Capture.

### Which tab you land on, on the web build

`initialRouteName` is `Capture`, but a *matched* path beats it — and on web React Navigation
writes the URL back on every navigation and re-reads it when `NavigationContainer` mounts. Sign
Out lives on the Profile tab, so the address bar always read `/you` when the session ended, and
signing back in landed everyone on Profile for no reason anything on the page could explain.

`resetWebPathIfStale` (`src/lib/webLocation.ts`) clears the path on `SIGNED_OUT` and `SIGNED_IN`,
keeping `/snags/<id>` — which has to survive the sign-in round trip. Deliberately not
`INITIAL_SESSION`: reloading a tab is not logging in.

## The home screen icon

The app is installed from the browser, not a store — people add `app.snaghq.co.nz` to their home
screen. Expo's web export publishes **one** icon at 48px and no way to configure it, so a launcher
asking for ~192px scales it up 4x and it looks visibly blurry.

`apps/mobile/public/` is copied verbatim into `dist/`:

- **`manifest.webmanifest`** — 192 and 512 PNGs, `display: standalone`. The icons are
  `purpose: "any maskable"` on the same files because the source is full-bleed `#2563EB` with the
  mark 29.5% out from centre, inside the 40% safe radius Android masks to. Re-measure before
  changing the artwork.
- **`index.html`** — overrides Expo's HTML shell, adding the manifest link and `apple-touch-icon`
  (iOS ignores the manifest and reads only that, so both have to be stated).

**Never name `%LANG_ISO_CODE%` or `%WEB_TITLE%` above the tags that use them.**
`createTemplateHtmlAsync` substitutes with `String.replace`, which takes the first occurrence only
— so a token mentioned in a comment absorbs the value and the real tag ships the literal
placeholder. That exports cleanly, exits 0, and puts a browser tab reading `%WEB_TITLE%` into
production. `webManifest.test.ts` asserts each token appears exactly once.

The manifest's `Content-Type` is pinned in `netlify.toml`: served as anything but a JSON media
type it's rejected outright, and the symptom is the old blurry favicon quietly coming back.

## Environment Setup

1. Copy `apps/mobile/.env.example` → `apps/mobile/.env`, fill in `EXPO_PUBLIC_SUPABASE_URL` and
   `EXPO_PUBLIC_SUPABASE_ANON_KEY`.
2. Copy `apps/web/.env.example` → `apps/web/.env.local` (`NEXT_PUBLIC_SUPABASE_*`) — same project.

## Running

```bash
npm install          # repo root — installs every workspace
npm run mobile       # Expo
npm run web          # Next.js
npm run typecheck
npm run test:mobile  # jest
```

## Common Tasks

### Add a screen
1. `apps/mobile/src/screens/NewScreen.tsx`
2. Add the route to `packages/shared-types/src/index.ts` — `apps/mobile/src/types/index.ts` only
   re-exports that package
3. Register it in `apps/mobile/src/navigation/index.tsx`

### Add a column or table
1. New timestamped file in `supabase/migrations/` — never edit a past one
2. Apply via the Supabase MCP (`apply_migration`) or the SQL Editor
3. Add the type to `packages/shared-types/src/index.ts`
4. Grant explicitly, by name

### Add a query
`packages/supabase-queries/src/index.ts`. Each function takes a `SupabaseClient` so both apps can
call it with their own; `apps/mobile/src/lib/supabase.ts` re-exports them bound to its client and
should contain no logic of its own.
