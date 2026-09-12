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
│   │       ├── screens/           # SnagList (home), Weekend, SnagDetail, Household, LocationTags,
│       │                       #   Profile, Auth, Setup
│   │       └── components/
│   └── web/                       # Next.js — /, /forgot-password, /reset-password. That's it.
├── packages/
│   ├── shared-types/              # @snag/shared-types — enums, row types, labels, nav params
│   └── supabase-queries/          # @snag/supabase-queries — every read and write, each taking a client
├── supabase/migrations/           # 20260911* is the home schema; everything before it is the archive
├── SNAG_HOME_PIVOT_REVIEW.md      # why the pivot was done this way
└── SNAG_INFRA_NOTES.md            # the config that isn't in git
```

## How `home` gets exposed, and why it isn't where you'd look

PostgREST will not serve a schema it has not been told to expose. Without it, *every* call comes
back `PGRST106` and the app reads as an account with no data — empty lists, no household, no
error. `SchemaNotExposedError` in `packages/supabase-queries` names that, and `App.tsx` shows it
instead of rendering an empty shell, so it fails loudly now. **If someone reports "the app is
blank", this is the first thing to check.**

It is currently set **in the database**, not in the dashboard:

```sql
alter role authenticator set pgrst.db_schemas = 'public, graphql_public, home';
notify pgrst, 'reload config';
notify pgrst, 'reload schema';
```

PostgREST reads per-role config overrides when `db-config` is on, which is Supabase's default, so
this works and took effect immediately. **But the dashboard is the durable place.** Settings →
API → Exposed schemas is what the platform rewrites from, so a platform-side config change can
revert the role setting without warning. Mirror it there; it costs one click and removes the
divergence. Until then, `pg_roles.rolconfig` for `authenticator` is the real source of truth and
the dashboard will not show `home` at all.

Note the grant is deliberately narrow: `usage on schema home` went to `authenticated` only, never
`anon`. A signed-out caller gets `42501 permission denied for schema home`, which is the correct
answer and is *not* the same failure as `PGRST106`.

## Two schemas in one project

The Snagv1 project (`wpkdpukpllxuyqqlxkxf`) holds both:

- **`home`** — this product. Eight tables: `households`, `profiles`, `household_members`,
  `properties`, `property_members`, `locations`, `snags`, `comments`. Plus `snags_with_details`,
  the view every list and detail screen reads.
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

**Capture** is the bar at the foot of the list (`ComposeBar`): a photo, or a line of text, or
both. One tap to the camera, or four seconds of typing. It is used standing in the bathroom
holding a broken toilet seat, with about ten seconds of patience.

**There is no Add tab, and adding one back would undo the whole arrangement.** Capture was a
destination once, and the cost was that the app opened on a form rather than on what the other
person had added. The camera is bottom-left because that is the easiest place on a phone to
reach one-handed; the old Add screen had it at the top, which is the hardest.

Four things about capture are load-bearing:

- **There is no title column.** A photo says what a title would, and requiring one put a keyboard
  between someone and the problem in front of them. A snag needs a photo *or* a description
  (`snags_has_something`), and `create_snag` refuses the empty case in words rather than letting
  the constraint name surface. `snagHeadline` supplies what the list shows for a photo-only snag.
- **A line of text is a complete snag.** "Gutters" typed into the bar is a perfectly good entry,
  and making that the same gesture as sending a message is the point of the bar existing.
- **Nothing is asked before it is filed.** Room and urgency are offered *afterwards*, as the
  amend row above the bar, editing a snag that already exists. Nothing there can block anyone, and
  walking away without touching it leaves a perfectly good snag.
- **Priority is not a capture decision any more.** It used to be, defended as the one judgement
  only the person standing there can make — but nearly everything was filed Low, which is the
  premise of the product, and urgency is *comparative*. It belongs where a dozen things are
  visible at once. `create_snag` still takes it; the list's amend row and the detail sheet set it.

**Triage** (`SnagDetailScreen`, presented as a modal over the list) is everything else — effort,
needs-parts, due date, repeat, assignee, priority. Each control writes immediately rather than
collecting into a form with a Save button, because triage is a series of small independent
decisions and a Save button turns sorting twelve items into forty taps. It is a **sheet rather
than a push** for the same reason: the list stays underneath, so closing one and opening the next
is not a round trip.

**Do not add a field to the compose bar.** Everything there is friction at the exact moment
friction costs most. The place for it is the amend row, or triage.

## The list is the app's home

`SnagListScreen` is `initialRouteName`, and three tabs — List, Weekend, You — are all there are.

**This product has no notifications and deliberately never will** (two people in one house do not
need an email per snag; see `notify-snag` in the archive). So this screen is the only channel by
which one person finds out what the other did, and the first thing it says is what arrived since
they last looked.

- **"New" is what somebody *else* added since your last visit.** Your own entries are never news
  to you. The stamp is `profiles.last_seen_list_at`, written by `home.mark_list_seen`, which
  returns the *previous* value so the section can't empty itself out while it's being read. It is
  stamped **once per mount**, not on every focus — doing it on focus would clear the rule the
  moment someone opened a snag and came back, which is the one journey that starts from reading
  it. Null on a first run, deliberately: the alternative greets a new member with the household's
  entire backlog marked unread.
- **The rest groups by room**, in `locations` order — which is how work gets batched, and which
  is why there is no room filter: you can see there are three things in the Garage without asking.
- **Done leaves.** One line at the foot, not a lens. Finishing something should make the list
  shorter; that is the whole reward on offer. Only the last seven days are rendered.
- **Both filter rails became one button.** Filtering is occasional and was charging 96px of
  vertical rent on every visit to a screen people now open constantly.

`SnagListScreen.test.tsx` pins the New rule, the first-run case, the room ordering and the done
window. `ComposeBar.test.tsx` pins the text-only path, the words coming back on failure, and the
keyboard lift.

## Why the app exists at all

Not to transmit a job — saying it out loud does that. It's to hold work that sits *below the
threshold of action* until a moment when the threshold drops: a free Saturday, a trip to the
hardware store you're making anyway. Two kinds, same kind:

- **Calendar-forgotten** — gutters, smoke alarm batteries, the heat pump filter. Handled by
  `due_at` + `repeat_days`.
- **Threshold-forgotten** — the toilet seat. Never urgent enough alone, worth doing when three of
  them can be done together. Handled by the weekend view.

`WeekendScreen` is the one view a filtered list genuinely can't be, which is why it kept a tab. It's bounded by **time available** rather
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

## Properties: the house, and later the bach

**A bach is a property, not a location tag.** This is the distinction to hold on to, because it
is the one that was got wrong first: tags say *where in a place* something is; a property *is* the
place, has its own people, and has its own tag list.

`snags.property_id` has been not-null since the schema was stood up, so surfacing this was a
migration rather than a rewrite. Three rules:

- **`property_members` decides who sees what.** Household membership does not imply seeing every
  property — a family can share a bach without seeing the snags in each other's houses, which is
  the whole reason the case is interesting. Every read policy on `properties`, `locations`,
  `snags` and `comments` goes through `home.is_property_member`, and so does every snag write.
- **Locations belong to a property**, not a household. `seed_locations` runs per property, so a
  new bach arrives with its own twelve tags that can then diverge.
- **The picker renders only when there is more than one place.** A one-property household never
  meets the concept. `getDefaultPropertyId` starts capture on the place they *last actually filed
  against* (`home.last_reported_property`), not the one they last tapped — a server read, so it
  holds on a new device. The retired product's equivalent took the first row of an RPC with no
  `ORDER BY`, so a member of three sites sent every report to whichever row Postgres happened to
  return first, forever, with nothing in the UI naming the site. It looked like a permissions
  problem to whoever hit it.

Two smaller rules that follow. `unlink_property_member` refuses to remove the last person — a
property nobody is linked to is invisible to everyone, including whoever would link someone back.
And `update_snag` requires an assignee to be linked to the *property*, not merely in the
household: assigning the bach's gutters to someone who cannot see the bach is a job that silently
never gets done.

**`household_members.role`** still exists with nothing reading it. Everyone linked to a place can
do everything at that place, and there are **no role checks in the UI at all**. Don't add one —
the only permission here is which places someone is on.

## Locations are seeded, not administered and not derived

`home.locations` holds the room tags, seeded **per property** by `seed_locations`: Kitchen,
Bathroom, Bedroom, Living room, Laundry, Hallway, Garage, Outside, Deck, Roof, Under the house,
Elsewhere. `getLocations(propertyId)` reads them in seeded order, and that order is what the list
groups by as well as what the amend row offers — so it is an interface, not just a seed.

Nobody sets this up, and nobody has to earn it by logging something first. `Elsewhere` is the
escape hatch that keeps a fixed list from being a dead end.

Beyond the seeded twelve, **Profile → Location tags** (`LocationTagsScreen`) adds and removes them
per property, through `home.create_location` / `home.delete_location`. Three things about it:

- **It is per property, with the same picker capture has**, rendered only when there is more than
  one place. Editing the house's list must not quietly edit the bach's.
- **Removing a tag does not touch the snags filed under it.** `snags.room` is TEXT rather than a
  foreign key precisely so history survives: a snag logged in the Sleepout still reads Sleepout
  afterwards and the list still filters on it. Removal only changes what capture offers next time,
  and the confirmation says so — two buttons, because `showAlert` on the web build is a
  `window.confirm`.
- **The list's room grouping and amend chips come from `useHousehold`**, so a change here has to
  be pushed back with `reloadLocations()` — and only when the edited property is the one the list
  is showing.

There is deliberately no rename: renaming would leave every snag filed under the old name saying
the old name, which is the one outcome the TEXT column was chosen to avoid quietly happening.
Remove and add instead.

**A second place is never a tag.** If someone asks for a "Bach" tag, the answer is
`create_property`.

## Adding someone to a household

`home.add_member_by_email`, against an account that already exists. No tokens, no email delivery,
no pending state.

It takes an optional `p_property_ids`. Omitted means every property in the household — right
while there is one place, and wrong the moment there is a bach, so the client passes an explicit
list once there is more than one.

That's deliberate, not lazy. The retired product's `invite_user` wrote the invite row and
returned — the RPC succeeded, the app toasted "Invite sent", the invite listed as pending, and
**no invite was ever emailed for the entire life of the feature**. Nothing said so. Don't
reintroduce a mechanism that can fail silently for two people who live in the same house.

## Design System (DO NOT deviate)

All tokens in `apps/mobile/src/constants/theme.ts`. Never hardcode colours, spacing or shadows.
`apps/web/src/app/globals.css` mirrors the light values — change both.

Two rules govern the palette, and they are the whole system:

1. **The ground is warm.** `#FAF7F2` is plaster, not near-white. This is a household list, not
   software you are logged into.
2. **Colour is spent on state and interaction, never on decoration.** Four hues, one job each.

The corollary that gets second-guessed: **fern is the brand, so fern is not "done"**. A finished
snag goes neutral. The reward for finishing a household job is the item leaving the list, and
spending the brand hue on completion would make the list's calmest state its loudest colour.

- **Ground** `#FAF7F2` · **Surface** `#FFFFFF` · **Sunken** `#F4EFE7` · **Border** `#E7DFD3`
- **Fern** `#2E6A4F` — every primary action and the active tab. Tint `#E4EFE7`.
- **Clay** `#9E3522` — priority high, and overdue. Tint `#F9E7E1`.
- **Brass** `#825611` — doing, and due within a week. Tint `#F7EEDC`.
- **Slate** `#35526E` — open. A state, not a warning. Tint `#E9EFF6`.
- **Text**: ink `#2B2724` (warm near-black, not blue-black), secondary `#5C554C`, muted `#6A6156`.
- **Elevation**: the `Shadow` scale (`sm` list cards, `md` standalone cards, `lg` modals), tinted
  with the ink rather than a blue-black. An elevated card drops its border; never both.
- **Card radius** 12px · **Button radius** 8px · **Chip radius** 4px
- **Icons**: `@expo/vector-icons` (Ionicons) via the shared `Icon` component — never emoji.
  `-outline` by default; filled reserved for the active tab.
- **Minimum touch target** 48px (`MIN_TOUCH_TARGET`)
- **Light mode only.**

**Every pair is measured, not eyeballed, and the reason is specific: a warm ground reads lighter
than a cool one while doing nothing at all to its measured luminance.** An earlier pass of this
palette failed three pairings for exactly that reason. The tightest pair shipped is
muted-on-sunken at 5.31:1. If the ground is warmed further, re-run the numbers rather than
trusting how it looks.

Three badges carry the triage vocabulary, and their colour budget is deliberate:

- **`StatusBadge`** — open (slate) / doing (brass) / done (neutral).
- **`PriorityBadge`** — only `high` gets an alert colour; `low` is a neutral pill, so a second
  saturated hue can't collide with status on the same card.
- **`EffortBadge`** — deliberately colourless. Effort answers "can I finish this today", which is
  not an alarm.
- **`DueBadge`** — overdue is the one thing on a household list that has earned red. It's a fact
  about a date, not a judgement about importance.

### One chip, every rail

The amend chips and the "Show me" sheet on `SnagListScreen`, and the effort selector on
`WeekendScreen`, all say the same thing the same way: **a sunken well when off, solid fern when
on, no border either way.** Two rules follow from that:

- **Never put an inactive control on `surface` with a border.** On a plaster ground a white
  bordered box is a *card*, so a row of filters styled that way reads as a row of things to read
  rather than a row of things to tap.
- **`primaryLight` is not a selected state for a control.** It is the tint behind fern *text* (a
  capture tag chip, an avatar). Using it for one rail and solid fern for another made two controls
  doing the same job look like two different controls.

Priority is the one exception: **Urgent** fills with clay, because it is the only alert in the
capture path. Nothing else in a chip row gets a hue.

**A chip's tap area and its visible pill are different sizes on purpose.** The pill is ~34px,
because a rail of 48px lozenges outweighs the list it filters; the `Pressable` around it carries
`MIN_TOUCH_TARGET`. Both rails were under 48 before this — 34px and 26px — which is invisible
until someone is holding the phone one-handed. `Button.test.tsx` and `ComposeBar.test.tsx` pin
the states.

**A disabled filled button goes neutral, not faded.** Dimming a filled button dims its hue too:
fern at half strength is a pale sage that reads as broken rather than as not-ready, and
white-on-pale-sage fails contrast on the way past. Disabled filled variants take the sunken well
and a muted label (5.31:1). Loading is not the same case — the spinner is the feedback, and going
grey mid-press reads as the action having failed.

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
- **`KeyboardAvoidingView` does nothing in a browser, and neither does `Keyboard`.**
  react-native-web ships both, so they type-check and render — but `onKeyboardChange` is an empty
  method body and `Keyboard.isVisible()` returns a hardcoded `false`. Seven screens wrap
  themselves in one and have never been protected on the build people actually install. Use
  `useKeyboardInset()` (`hooks/useKeyboardInset.ts`) for anything pinned to the bottom of a
  screen, as `marginBottom`, and drop the safe-area padding while it is non-zero — the keyboard
  already covers the home indicator, so adding both lifts the bar an inset too far.

  Two mechanisms do the work and they deliberately can't double up.
  `interactive-widget=resizes-content` in `public/index.html`'s viewport meta makes Chrome shrink
  the *layout* viewport, so ordinary layout avoids the keyboard; Safari ignores it, and
  `lib/keyboardInset.ts` measures `visualViewport` instead. When the layout viewport has already
  shrunk, `innerHeight` shrinks with it and that measurement comes out at zero — so whichever one
  is working, the other reports nothing. `keyboardInset.test.ts` pins that, and
  `webManifest.test.ts` pins the meta directive, which nothing else could catch.
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
which is what lands someone on the list.

### Which tab you land on, on the web build

`initialRouteName` is `Snags`, but a *matched* path beats it — and on web React Navigation
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
  `purpose: "any maskable"` on the same files because the source is full-bleed `#2E6A4F` with the
  mark reaching 34.5% out from centre, inside the 40% safe radius Android masks to. **Re-measure
  before changing the artwork** — the same file serves both the plain and the masked case, so a
  mark that only works uncropped ships looking clipped on half the phones it lands on and nothing
  warns you.
- **`favicon.svg`** and **`icons/icon-512.svg`** — the vector masters. `favicon.svg` is drawn for
  48px with a heavier relative stroke (6/48 rather than 44/512), because the icon-512 stroke
  disappears at tab size. Regenerate the PNGs from `icon-512.svg`, never from each other.
- **`assets/adaptive-icon.png`** is the Android foreground layer and is a different geometry
  again: the launcher crops it to its middle 66%, so the mark is sized to stand 68.75% of *that*,
  on transparency, with the fern coming from `adaptiveIcon.backgroundColor`. Trim the SVG's own
  margin before scaling — the ink occupies only the middle ~69% of the 512 viewBox, so sizing the
  canvas sizes the wrong thing and the icon comes out visibly small.
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
