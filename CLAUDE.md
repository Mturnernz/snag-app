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
│   │   │                           #   (Setup answers a waiting invitation before asking.)
│   │   └── src/
│   │       ├── constants/theme.ts # ALL design tokens
│   │       ├── lib/supabase.ts    # client (schema: home), auth, photo upload
│   │       ├── hooks/useHousehold.tsx
│   │       ├── screens/           # SnagList (home), SnagDetail, House, ThingDetail,
│   │       │                       #   Household, LocationTags, Profile, Auth, Setup
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

**Don't reason about this from the dashboard — ask the API.** A signed-out request for a `home`
table answers `42501 permission denied for schema home` when the setting is good and `PGRST106`
when it has reverted, which is a one-command check rather than a judgement call.
`SNAG_INFRA_NOTES.md` has the exact curl under *Checking it, in one command*.

Note the grant is deliberately narrow: `usage on schema home` went to `authenticated` only, never
`anon`. A signed-out caller gets `42501 permission denied for schema home`, which is the correct
answer and is *not* the same failure as `PGRST106`.

### "Everything has disappeared" has a second cause, and it is us

`PGRST106` above is the platform-side one. The other is a **client asking for a column the database
has not got yet**, and it has already happened once: a merge to `main` deploys `apps/mobile` to
Netlify, so pushing code whose migration has not been applied puts exactly that client in front of
people. `getMyProperties` names its columns — `select('id, household_id, name, suburb, town, …')` —
so PostgREST rejected the whole request rather than returning a row with two nulls, `useHousehold`
came up with no properties, and the **House tab rendered empty**, because `getThings` needs an
active property. Eighteen things sat untouched in `home.things` the whole time.

Two things to take from it:

- **A read that names its columns fails loudly, and a `select('*')` does not.** That asymmetry is
  why the List tab still worked while the House tab looked wiped: `getSnags` stars the view, so an
  absent column came back as `undefined` and `mapSnag` defaulted it. Naming columns is still right
  — it is the same argument as granting by name — but it means a missing column is a **400 on the
  whole request**, not a gap in one field, so the screen that loses it loses everything.
- **Apply the migration before the merge that deploys the code needing it**, never after. There is
  no staging project and `main` is what `app.snaghq.co.nz` serves, so the window between the two is
  a window in which the live app is broken for everybody. Order: apply, check the API answers,
  then merge.

Checking it is one query rather than a judgement call — the columns the client names, against the
schema it is reading:

```sql
select column_name from information_schema.columns
where table_schema = 'home' and table_name = 'properties';
```

And after any DDL, `notify pgrst, 'reload schema';` — the platform usually reloads on its own, but a
stale cache serves the same 400 as a missing column and is indistinguishable from the app's side.

## Two schemas in one project

The Snagv1 project (`wpkdpukpllxuyqqlxkxf`) holds both:

- **`home`** — this product. Eleven tables: `households`, `profiles`, `household_members`,
  `properties`, `property_members`, `locations`, `snags`, `comments`, `things` (the house record),
  `absent_things` (what a place hasn't got) and `invitations` (who has been asked and hasn't
  answered). Plus `snags_with_details` and `things_with_details`, the views every list, record and
  detail screen reads.
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
- **Nothing is asked before it is filed, and everything is asked straight after.** Taking a photo
  saves the snag and *then* opens `AmendSnagSheet`: what is wrong, then where, then whether it is
  urgent, with a way into triage at the end. Every room tag is offered, not a shortlist — the one
  you want is the one you're standing in, and that is as likely to be the Roof as the Kitchen.

  It used to be a row of chips above the compose bar, with the note typed into the bar itself.
  That row was right about what to ask and wrong about how: the bar's field quietly changed
  meaning after a photo, nobody noticed, and people filed a photo and then opened the snag again
  to describe it — the one journey the whole arrangement exists to remove. **The sheet asks in
  words instead. The bar now only ever files something new.**

  The prompt exists because **a photo with no words and no room is the weakest thing this app can
  hold**: `snagHeadline` has nothing to work with and the list reads "Something to sort out",
  which is unreadable a fortnight later to the person who filed it as much as to anyone else. The
  moment after the shutter is the moment to ask, while the thing is still in front of you.

  It asks *after* the save and never before it, which is the part not to erode. Every control
  there edits a snag that already exists, so none of them can block anybody and walking away
  without touching one leaves a perfectly good entry. The note is only asked for when the snag has
  no words of its own — a photo taken after typing already carries them, and a typed snag is its
  own description. The camera keeps exactly one meaning throughout: it starts a new snag, never
  amends the last one.

  **The sheet asks and does not explain.** Each of its three steps carried a paragraph of prose
  under the question; all three are gone. A sheet whose entire argument is that it costs nothing
  to walk away from cannot also be three screens of reading, and a question worth asking at that
  moment is one that answers itself.

  **There is a fourth step, and it is only sometimes there.** After the room, *Is it about one of
  these?* offers the things recorded **in that room** — the kitchen's dishwasher and rangehood, not
  the house's forty things — and writes `snags.thing_id`. The room is what makes the offer short
  enough to be a two-second tag rather than a search, which is why it comes after it and not
  before. A room with nothing recorded in it has no step at all: an empty rail over a *Skip for
  now* is the app asking somebody to dismiss a question it cannot answer, so `amendSteps` leaves
  it out and the header counts three instead of four. The count moves if the room changes
  mid-sheet, which is right — tagging the Kitchen is what makes the kitchen's dishwasher offerable.

  **The payoff is somewhere else entirely**, and that is the point of asking at capture: a snag
  that knows it is about the heat pump carries `thing_name`, `thing_make` and `thing_model` from
  `snags_with_details`, so the model number is on the snag in the shop rather than two tabs away.
  Those three columns existed and were read by nothing but the extract's *About* column — nothing
  in the app could set `thing_id` from the snag's side at all. `SnagDetailScreen` now shows it as
  a row under the badges, mono-faced, tapping through to the thing, with a × to unlink; without
  that the answer would be written and never shown, which is the silent failure this codebase
  keeps catching.

  **Ghosts cannot appear here, and that is the type rather than a filter.** `thingsInArea` takes
  `Thing[]`; a suggestion is a `RoomSuggestion` from a constant with no id for `thing_id` to point
  at. And **pointing a snag at a thing does not start the job** — see the four joins below.

  Step four is **two named pills — *Not urgent* and *Urgent*** — with Not urgent lit before
  anybody touches anything. It was one *Urgent* chip that toggled, which left the common answer as
  the unlabelled absence of a press: a state nothing on the sheet ever said out loud. Nothing is
  written to make the default true, because `null` and `'low'` both already mean not urgent —
  pressing the pill that is already lit is a no-op, deliberately, rather than a write that touches
  `updated_at` to say what the row already said.
- **Priority is not a capture decision any more.** It used to be, defended as the one judgement
  only the person standing there can make — but nearly everything was filed Low, which is the
  premise of the product, and urgency is *comparative*. It belongs where a dozen things are
  visible at once. `create_snag` still takes it; the capture sheet and the detail sheet set it.

**Triage** (`SnagDetailScreen`, presented as a modal over the list) is everything else — what it
needs from the shop, due date, repeat, assignee, priority. Each control writes immediately rather
than collecting into a form with a Save button, because triage is a series of small independent
decisions and a Save button turns sorting twelve items into forty taps. It is a **sheet rather
than a push** for the same reason — though note react-native-web renders a modal presentation as
a full screen, so that particular benefit is native-only.

**Notes sit above *Sort it out*, not below it.** This product has no notifications and never will,
so a note is the only way one person tells the other anything — "ordered the part, arriving
Tuesday" is usually the entire reason the screen was opened. Two cards of controls standing
between the photo and it made the one piece of news on the page the last thing anybody read. The
order down the screen is now: photo, headline, status, **Notes**, *Sort it out*, *Does it come
round again?*.

**Nobody moves a job to "doing" by hand.** There was a *Start it* button and it went unpressed:
people commented on things and assigned them to each other while the list went on claiming
nothing had been touched. Doing something about a snag is the evidence it has started, so
`home.update_snag` and `home.add_comment` move it — server-side, so no client can forget.

The rule is narrower than "any update", deliberately. Only **assignee, due date, repeat and the
parts list** start a job; room, description and priority don't. Those three are the tail of
capture — the capture sheet sets them seconds after the photo — and marking a brand-new snag "doing"
because somebody tagged it *Bathroom* would empty the status of meaning from the other end.
Finishing is the one state change still made by hand, because only a person knows.

**There is no "how long will it take".** Effort was the only question in the app whose answer
nobody could check, asked before the job was understood, and it existed mainly to feed a screen
that no longer exists. The column and the `snag_effort` enum are dropped, not deprecated.

**Do not add a field to the compose bar.** Everything there is friction at the exact moment
friction costs most. The place for it is the capture sheet, or triage.

### A photo opens, and can be got closer to

`PhotoViewer` is a full-screen modal over the strip on `SnagDetailScreen` and `ThingDetailScreen`:
pinch, drag, double-tap, and buttons that do the same things. It exists because **the photo is the
account of the problem** — there is no title column precisely because a picture of the broken
toilet seat says what a title would — and a 220×165 tile says roughly that and no more. A serial
number, a model plate, a hairline crack: none of them are legible in the strip, and the strip is
where the read moment this whole record exists for actually lands.

Four things are load-bearing.

- **It is hand-rolled, and the two obvious alternatives are both traps.** `ScrollView`'s
  `maximumZoomScale` is iOS-native only, so it would work in the simulator and do nothing on the
  build people install — the same shape of failure `Alert.alert` and `KeyboardAvoidingView` have
  already caught this codebase out with twice. `react-native-gesture-handler` is not a dependency,
  wants a root-view wrapper on native, and would be a second animation runtime on a web export
  that has just paid 490 KB for the PDF renderer. `PanResponder` is core React Native, is
  implemented on react-native-web, and reports `touches`, which is everything a pinch needs. **No
  new dependency; the bundle does not move.**
- **The arithmetic is in `lib/photoZoom.ts`, not in the component.** Every way a zoomable image
  goes wrong is the same failure from the other side of the screen — *the picture is gone and
  there is no obvious way to get it back* — and each is one sign or one divisor away. `panBounds`
  is zero at fit, which is what makes zooming out re-centre rather than leaving the photo parked
  in a corner; `zoomAbout` holds the point between the fingers still, without which the detail
  somebody is pinching towards travels away from them as they pinch. `photoZoom.test.ts` pins both
  as properties rather than as numbers. Bounds are measured against the **frame**, not the JPEG's
  own aspect ratio: knowing the latter means a network round trip before the first gesture can be
  answered, in exchange for slightly tighter letterbox behaviour on a photo already on screen.
- **There are buttons as well as gestures.** Half the people who open this are on a desktop
  browser with no pinch and no second finger, and a viewer whose only way in is a gesture that
  device cannot make is a viewer that does nothing. *Fit* renders only once there is something to
  fit — at fit it is a control dressed as a choice.
- **`touchAction: 'none'`, on web only.** Without it the browser claims the pinch and zooms the
  *page*, so the photo sits unchanged inside a scaled-up app. It is scoped to the one surface that
  handles its own touches; the viewport meta still allows page zoom everywhere else.

Two smaller rules. **Opening and removing are siblings, never nested** — the Thing page's tile
carries a × and a `Pressable` inside a `Pressable` is a coin toss about which one gets the tap.
And **a new photo opens at fit**: carrying the last one's zoom over drops somebody into the middle
of a picture they have not seen yet.

`PhotoViewer.test.tsx` pins the buttons, *Fit* appearing only when there is something to fit, the
counter, both ends of the strip, and the reset on moving to the next photo.

## The Schedule tab is a read, never a second way to write

`ScheduleScreen` is the third tab, after House: a month grid over the same snags, arranged by
date instead of by room. The list is deliberately bad at "when was the heat pump
filter last changed" and "is anything landing the weekend we're away", because both are questions
about dates.

**Nothing on it writes.** There is one scheduling mechanism in this app — `due_at` plus
`repeat_days`, set in triage, rolled forward by `home.set_snag_status` — and the moment there are
two ways to schedule something, neither is trustworthy. So no cell is draggable, nothing moves
between days, there is no +, and every row is a door back to the snag. It also sends nobody
anything: a calendar that could remind you would be the first thing in this product that speaks
unasked.

**It covers every place at once, and has no property picker.** The other tabs are about a place
you are standing in, so they ask which one. A date is not about a place: answering "is anything
landing that weekend" for the bach only, because the bach is what the House tab happened to be
showing, is the wrong answer to the question. So it calls `getSnags({})` — no property filter at
all — which returns exactly what `property_members` and the read policies let this person see, and
names the property on each row when there is more than one. A one-property household never meets
the concept, as everywhere else.

Four kinds of mark, and **one of them is not real**:

- **Added** (`created_at`, slate) · **Done** (`done_at` *or* `last_done_at`, neutral — fern is not
  "done") · **Due** (`due_at`, brass, and clay when it is in the past).
- **Comes round** is `due_at` walked forward by `repeat_days`. No row exists for any of those days
  and none ever will until the current one is marked done. It is drawn **hollow** for exactly the
  reason a House-tab suggestion is drawn dashed, and the same rule applies: **if the hollow/solid
  distinction blurs, the projection goes rather than the distinction.** It is never called "Due",
  because nothing is.

Three smaller rules:

- **A day is a local day.** `dayKey` is the single place an instant becomes a calendar cell. A job
  due at 9pm in Auckland is the next day in UTC for half the year, and `toISOString().slice(0,10)`
  files it under the wrong one. The mobile suite runs under `TZ=Pacific/Auckland` so the test for
  this is a real assertion rather than one that happens to hold on a UTC runner.
- **One dot per kind, not per mark.** A 40px cell answers "what sort of day was this"; the list
  underneath answers it properly. Capping a per-mark row would drop a kind silently, which is the
  worse failure.
- **Paging a month clears the selected day**, and the list becomes the whole month. A heading
  reading "Saturday 5 September" over a grid of November is the screen contradicting itself, and
  it is also the wrong answer: somebody who has just paged forward is asking what lands *then*.

`scheduleMarks`, `monthGrid`, `dayKey` and `marksOn` live in `packages/supabase-queries` with the
other pure helpers and are pinned by `schedule.test.ts`; `ScheduleScreen.test.tsx` pins the hollow
projection, the overdue hue, the unfiltered read and the paging rule.

## The list is the app's home

`SnagListScreen` is `initialRouteName`, and there are four tabs: List, House, Schedule and You.
Schedule sits after House because the first two are where work is done and it is where a question
gets answered.

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
  shorter; that is the whole reward on offer. Only the last seven days are rendered. A repeating
  job cannot leave — see *Finishing says so* below.
- **Both filter rails became one button.** Filtering is occasional and was charging 96px of
  vertical rent on every visit to a screen people now open constantly.
- **The shopping list rides the "Needs parts" lens**, and a pill in the header says how much of it
  there is. One card above the cards, listing every item the visible jobs are waiting on — the only
  elevated surface on the screen, and the only thing the retired Weekend tab left behind. See
  *A list you can tick* below for the pill and the ticking.

`SnagListScreen.test.tsx` pins the New rule, the first-run case, the room ordering and the done
window. `ComposeBar.test.tsx` pins the text-only path, the words coming back on failure, and the
keyboard lift. `AmendSnagSheet.test.tsx` pins which question a new snag is asked first, that the
sheet opens on *Not urgent* without having written anything to say so, that no step explains
itself, and the whole of the *Is it about one of these?* step — absent for a room with nothing in
it, absent while the house record is still on its way, this room's things and no other, the second
press unlinking, *Skip for now* until something is chosen, and the header counting four.
`houseRecord.test.ts` pins `thingsInArea` itself: one room only, `Whole house` for a snag with no
room, and the chip order being the order of the words on the chips.

### Finishing says so, and a repeat cannot finish

Marking something done opens **one dialog with one button**: *Congratulations*, the headline of what
was finished, and *Return to list*. It is `DoneDialog`, not `showAlert` — that is a `window.confirm`
on the build people install, which cannot congratulate anybody and cannot carry a tick. The button
goes back to the list because that is where the reward actually is: the card has gone neutral and
left, and the dialog now says out loud what the shortening list has always said quietly.

The tick is fern, and that is not a breach of *fern is not "done"*: this is an **interaction**, which
is what fern is for. The snag's own `StatusBadge` still goes neutral, so the list's calmest state is
still its quietest colour.

**A repeating job never sees that dialog, and this is the part to keep.** `set_snag_status` rolls
`due_at` forward and leaves the status `open`, so the heat pump filter is back on the list before the
phone is down — congratulating somebody there would be the app claiming something the list flatly
contradicts. The branch already existed to word the toast honestly (*"Done — back on the list when
it's next due"*); it now also decides who gets congratulated, and it decides from the row that came
back from the write rather than from what was asked for.

So the repeat gets the other half of the reward instead, since it cannot have the first:

- **It dims.** `isDoneForNow` — a repeat with a `last_done_at` and a `due_at` still ahead — takes the
  same `opacity: 0.62` a finished card takes, because it is the same fact: there is nothing to do
  about it. No strike-through, though; it is not finished, and it will be back.
- **It sinks to the very bottom**, past every room, under the heading **Comes round again**. Left in
  its room, the one thing on the list nobody has to think about competes with the ones they do.
  *Comes round again* is the Schedule tab's own phrase for the same mechanism, deliberately, so two
  screens do not invent two names for it.
- **It stops being counted.** The header says what is left to do, and "3 to do" over a list where one
  of them is dimmed and parked at the foot is the screen contradicting itself. It is also kept out of
  **New**, which would otherwise raise to the top the one row that has just been put to bed.
- **It comes back up on its own.** The rule is a date comparison, so the day `due_at` arrives it is an
  ordinary job in its own room again — no write, no cron, nothing to remember. The distinction is
  `last_done_at` **and** a future date, never merely having a `repeat_days`: the gutters due on
  Saturday are ordinary work and belong in Outside with everything else.

`repeats.test.ts` pins all five cases of `isDoneForNow` — the parked repeat, the one merely
repeating, the one whose date has come round, the one-off done yesterday, the genuinely finished one
— and that the due badge still says what it always said, because dimming is a fact about attention
and not about the date. `SnagDetailScreen.test.tsx` pins the dialog's words and its one button, that
a rolled-forward repeat gets the toast and no dialog, and that reopening says nothing at all.
`SnagListScreen.test.tsx` pins the last-section placement, the translucency, the count and the
ordinary repeat staying put.

### A list you can tick, and a flag that cannot lie about it

The parts list has answered "why has this sat for a fortnight" since `20260912140000` — the trip to
the shop is the thing that does not happen. What it could not do was record the trip: you bought the
seal and the list went on asking for the seal.

**`home.bought_parts` is a side table of what has been got, not a second list.** The items stay in
`snags.parts`, written the one way they always were, through `update_snag`. A row exists only when
the answer to "has this been got" is yes, so absence is unbought — the resting state of nearly every
item — and the table stays the size of the shopping actually done rather than the shopping ever
listed. Per household, never per person: there is one house and one trip, the same argument as
`absent_things`.

**`needs_parts` is derived in the view now, and the column is gone.** It was maintained by
`update_snag` beside the list, on the argument that a flag and the list it describes must not be able
to disagree. Ticking breaks exactly that: buying the last item has to clear the flag, so either
`set_part_bought` maintains the column too — two writers of one derived value, which is the
disagreement arriving by another door — or nothing does. So the view computes it: **has an item
nobody has bought yet.** One expression, one reader, nothing to keep in step. `20260915150000` also
writes the view's columns out **one by one**, because it was `select s.*` — the footgun
`20260914140000` already paid for on `things_with_details`.

**Ticking is not doing.** `update_snag` moves a job to 'doing' when its parts change, because
deciding what to buy is deciding to do the work. Buying one is not adding one, so `set_part_bought`
is a separate function that touches neither the status nor `updated_at` — and it is separate
precisely so it cannot. It is keyed by the item's own text rather than an index, because the list can
be edited from the other phone while somebody is standing in the aisle, and it refuses a tick for
something not on the list rather than storing one where nothing will ever show it.

Three rules on screen:

- **The pill only exists above zero.** At nought it is a control dressed as a choice — the same rule
  as *Fit* in `PhotoViewer` — and this screen evicted two filter rails for charging vertical rent on
  every visit. It counts **unbought items across the whole list**, not the lens, because the pill is
  how somebody finds out there is shopping to do at all. Tapping it is the *Needs parts* lens, never
  a second place parts live.
- **A ticked row stays on the trip sheet, struck through.** "Done leaves" would have it vanish, but a
  tap in an aisle lands on the wrong row often enough that a list which silently drops what you just
  touched is a dead end — you would have to remember which job the item belonged to to put it back.
  It leaves on its own terms instead: a job with nothing left to get stops being `needs_parts`, drops
  out of the lens, and takes its rows with it, so the card empties as the trip ends. Unticking is on
  the snag's own page as well, beside the ×.
- **A card names what is left, never what was listed.** A card claiming it needs the seal you bought
  on Saturday is a card you stop believing, so the pill goes when the trip is done.

**Where to buy and roughly what it costs stay on the advice row**, not on `bought_parts`. That is
what keeps `update_snag(p_parts)` the only way to set *what* is on a list — the new table answers one
question about each item and nothing else.

`shopping.test.ts` pins `unboughtParts`, the unbought-first ordering, a bought item being kept rather
than dropped, a stale tick for a removed item counting for nothing, and the count being across
everything. `SnagListScreen.test.tsx` pins the pill's absence at zero, the count ignoring the lens,
the pill opening the lens it already has, ticking going through `setPartBought` and never
`updateSnag`, a got item still being offered back, and a card no longer asking for what has been
bought.

## The house record: what's *there*, beside what's wrong

`HouseScreen` is the **House** tab, and `home.things` is the table behind it. A snag is almost
always about a thing — the heat pump, the hallway paint, the toilet cistern — and the list never
knew that, so "which filter", "which green", "which model" got answered from scratch every time
someone stood in a shop.

**The tab arrives furnished.** Every room holds greyed, dashed entries for what a house of this
kind probably has — a rangehood in the kitchen, a dryer in the laundry — until somebody records
the real one. This is the answer to the thing that kills every inventory product: an empty record
answers nothing, and a tab that answers nothing on the day it ships never gets opened again.

**The rule the whole arrangement rests on, and the easiest one to erode: a ghost is not a row.**
It comes from `ROOM_SUGGESTIONS`, a constant in `shared-types`; it never reaches `home.things`,
never appears in a search result, and can never be pointed at by a snag. A record full of entries
nobody has confirmed *looks* full and answers nothing, and that is worse than an empty one — you
believe it, check it in the shop, and find nothing there. **If the ghost/real distinction ever
blurs, the furniture goes rather than the distinction.** Two places it would blur first, both
pinned by `HouseScreen.test.tsx`: the header count says "recorded" and counts only real things,
and a search returns real things only.

Three consequences:

- **Progress is per room, never a percentage.** "Kitchen · 2 of 8" is a unit of work somebody can
  finish on a Saturday. A global completeness meter is the shaming number that gets an app closed
  and not reopened — there is deliberately no such meter anywhere.
- **A ghost weighs less than a record**, and not only differently: no thumbnail, smaller type,
  about two-thirds the height. Six full-size dashed cards in one room was a tab-length wall of
  grey, which is the "reads as homework" failure the whole argument has to survive. Found by
  rendering, not by reading.
- **Dismissing is final.** The × means "no dryer here" and writes to `home.absent_things` — the
  only thing the server remembers about suggestions, and it is the negative. Per property, not per
  person: there is one house, and two people disagreeing about whether there is a dryer is not a
  state worth modelling. There used to be a *1 not here · bring it back* line under every room
  that had dismissals; it is gone. Saying a house has no dryer is a small certain fact, and a
  standing offer to un-say it is clutter sitting on top of the answer. If one turns up, it is
  recorded with the + like anything else the catalogue never guessed at — which is why removing
  the rescue costs nothing, unlike `Elsewhere`, whose absence would leave a real dead end.
  `home.restore_absent_things` is still in the schema with nothing calling it.
- **There is one layout, and it is by room.** A *By room / By kind* rail used to sit above the
  list. By kind answered "what appliances do we have" — which the search field directly above it
  already answers — and charged a control rail on every visit to do it. One layout also means
  this tab and the List tab cannot drift apart about how the house is organised.

### Paint is the one suggestion that works differently

A room has one rangehood and a name for it. A room has as many paints as it has surfaces, and
their names are **colours** — a bathroom holds Half Spanish White on the main wall and Quarter
Alabaster on the windows. Three rules follow, and they are the whole feature:

- **The prompt is just "Paint"**, one per room, and it is **answered by any `finish` recorded in
  that room** rather than by name (`ghostsForRoom` special-cases the kind). Neither colour contains
  the word "Paint", so a name match would leave the prompt sitting under two recorded paints — the
  app failing to notice work already done, which is the fastest way to get a screen ignored.
- **The second and third come from the +**, which offers Paint in every room whatever is already
  recorded. The ghost prompts for the first one only; a prompt that stayed up would nag, and one
  that allowed only one would be wrong.
- **The colour goes in `name`, the surface in `notes`.** The colour is the answer somebody came
  for, so it is the headline; `THING_KIND_FIELD_LABELS` calls the notes row **"Where it went"** for
  a finish, and the card shows it as a line of its own. That note is the only thing telling two
  paints in one room apart, which is why it is the single field on the spec sheet exempt from
  "empty fields don't render". No other kind shows its note on a card — an appliance's note is not
  what distinguishes it from the appliance beside it.

In the walkthrough, choosing Paint asks **which colour** rather than offering a name, step three
photographs the **tin lid** rather than a rating plate, and step four asks **where it went**
instead of what it takes and how often it is serviced. A tin of paint takes nothing and is never
serviced; asking it those two questions was two whole steps of the sheet interrogating a tin.

### Adding a room, from the tab that shows the house

**A room added on the House tab is a room everywhere.** The *Add a room* line at the foot of the
list and the *Add a room…* chip on step one of the walkthrough both call `home.create_location`
against the active property and then `reloadLocations()` — so a conservatory, a study or a movie
room joins the tags the List tab groups by and capture offers, not just this screen. Rooms are a
property's vocabulary, not one tab's; two screens keeping separate ideas of what rooms exist is
how the House tab and the list stop describing the same house.

The chip is on step one because **the moment somebody notices the conservatory is missing is the
moment they are trying to record something in it** — sending them to Profile → Location tags and
back would lose the flow they were in. `LocationTagsScreen` still exists and is still where tags
are *removed*; nothing about it changed.

Two rules make a new room behave:

- **`suggestionsForRoom` is the one source** both the ghosts and the walkthrough draw from, so the
  two cannot disagree about what a room has. It was duplicated for one commit and that is exactly
  how they drift.
- **A room the catalogue does not know gets the paint prompt**, because every room in every house
  has walls — and because a section with no things and no ghosts is not drawn at all, so without
  it somebody would add a room and watch nothing happen. Three places are exempt, and the
  difference is *present-and-empty* versus *absent*: `Elsewhere` (the seed's escape hatch, whose
  whole meaning is "nowhere in particular"), `Under the house` (piles and a toby, no paint), and
  `Whole house`, which is not a room at all but this screen's label for things belonging to the
  place rather than a room in it. The last one was found by a test after the fallback shipped —
  it had grown a prompt asking which surface of nowhere-in-particular the paint went on.

**The catalogue only ever suggests `appliance` and `finish`**, the two kinds the app can actually
describe. The obvious absentees — the toby, the switchboard, meter numbers, bathroom tapware, bulb
fittings — are `fabric` and `fitting`, and suggesting something the spec sheet cannot then word
properly is how a prompt becomes a dead end. They arrive with those kinds.

### A + on every room heading, and a picker that admits houses differ

Every room heading carries a **subtle, muted +** — small, at the end of the rule, under *By room*
only (a kind heading is not a place you can put something). It opens the walkthrough on **step
two** with the room already chosen, because pressing + on the Kitchen has plainly answered "which
room". `start.room` therefore distinguishes `null` — Whole house, chosen deliberately — from
*absent*, which is nobody having chosen yet; collapsing the two sent people back to a question
they had just answered.

There is **one picker, not two**. The + does not open a list of its own; it opens step two, and
step two is where the searching lives:

- **The list is bigger than the room's catalogue.** This room's suggestions come first, then the
  rest of the house's vocabulary under *Anything else* (`catalogueSuggestions`, deduplicated —
  Paint is in nearly every room). Not every house is laid out the same: a study can hold a heat
  pump, a flat can keep the washing machine in the bathroom, and a picker that only ever offers
  the catalogue's idea of a kitchen quietly insists otherwise.
- **A search field narrows both** (`matchSuggestions` — substring, anywhere in the name, any case;
  nobody hunting the rangehood types "range", gets nothing, and thinks to try "hood"). The
  *Elsewhere in the house* heading only appears when there is a group above it to be elsewhere
  *than* — a search the room itself does not match is just results.
- **No match is not a dead end.** It says so in words and offers **Add "<what they typed>"**,
  which drops into the name-it-yourself branch already filled in. On that branch *Next* is hidden
  entirely: adding it is the only thing to do, and a dead button under the one live control is a
  choice that isn't one.

### Adding is a + and a walkthrough, not the compose bar

`AddThingSheet` — four steps, and **only the first is required**. Which room · what is it · the
label · what it takes.

**This is deliberately slower than capture, because it is a different moment.** A snag is filed in
ten seconds standing in front of the problem; a thing is recorded at a workbench, or while a
repairer reads a model number out. The compose bar was answering the wrong one here: one tap, no
questions, and what came out was a photograph of a plate with no room, no kind and no name — the
weakest thing the record can hold. **Do not put the compose bar back on this tab.**

- **Both list steps are the same control.** Step one was twelve room chips plus an "Add a room…"
  chip that swapped the whole step for a naming field; step two was already a search box that
  narrowed as you typed and offered to add whatever did not match. They asked the same shape of
  question two different ways. Now both are: type, watch the list narrow, and if nothing is it,
  add what you typed — and on both, the *Next* button is **hidden** when nothing matched, because
  a dead button under the one live control is a choice that isn't one. Step one grew that footer
  back the first time it was given a search box, and it read exactly as wrong there.
- The room is pre-filled whenever the + was pressed inside a room, and **tapping a ghost opens on
  step three**, because it has already answered the first two questions.
- **The camera is still one tap** — it is just step three now, where a photograph of the rating
  plate still captures make, model, serial and date of manufacture at once.
- **Step three takes the paperwork and the notes as well as the plate.** An invoice or a
  certificate of safety is in somebody's hand at the moment they are recording the thing; asking
  for it later means asking them to go and find it, which is what this tab exists to stop. It is
  uploaded there and carried into `create_thing` through `p_document_paths` rather than written
  afterwards — a create-then-update is two chances to leave a file in the bucket that nothing
  points at.
- **`notes` is one column doing two jobs, and the kind decides which.** For a paint it is the
  surface, asked at the last step in those words, because it is the only thing telling two colours
  in one room apart. For everything else it is free text, asked beside the label.
- **Nothing is written until the last step**, which is the one real difference from the snag amend
  row and is forced: `create_thing` needs a kind, and a row half-created by somebody who walked
  away mid-flow is exactly the unconfirmed entry the ghost design exists to keep out.
- Step three asks for nothing, so its button reads **"Skip for now"** until something is entered
  and **"Next"** after. It used to be a Next and a Skip side by side, which was two controls with
  one outcome.

The failure mode all of this is built against is specific, and it is the reason there are no
required fields past the room: every house-inventory product ever shipped opens on an empty
thirty-field form, a house has four hundred things in it, and the record ends up 8% complete. An
8% record is worse than none — you check it once, find nothing, and never check again.

### Writing is rare and accidental; reading is under pressure, somewhere else

This asymmetry decides the layout, and it is the thing to hold on to. You record the heat pump
because a repairer happened to read its model number out loud. You read it back eight months
later, in an aisle, needing one exact string. So:

- **Search is the primary control**, above everything and always visible. Every read moment starts
  with a half-remembered noun, and nobody in a shop navigates a tree. It matches consumables too,
  so `GU10` lists every fitting that takes one.
- **Search runs on the list already in hand** (`searchThings`), not on the server. A house holds
  tens of things; a round trip per keystroke would make the one moment this tab exists for the
  moment it is slowest, on the worst connection it will ever see.
- **A card shows the answer, not the name.** "Heat pump" is what somebody already knew;
  `MSZ-AP50VGK` is what they came for, so `thingDetailLine` gets the mono face and a line of its
  own. `Fonts.mono` is spent on data only — model numbers, serials, colour codes, tint formulas —
  never on prose.
- **A thing's page is a form, and that is a reversal.** It used to write every row on blur and
  render only the fields already filled in, with the rest behind an *Add a detail* row — the
  argument being that a page of blanks is homework. Lived with, it failed at both ends: nothing
  ever said a change had been kept (the rows called `patch` without the toast it takes, so edits
  saved in silence), and a page showing only what it has cannot tell you what it could hold. So
  **every field the kind can answer is on screen, empty or not**, and **one Save button** commits
  the typed ones together and says so. A paint still gets no Serial box: "every field" means every
  field the kind can answer.
- **A saved record is thin on purpose.** Three things were taken off it, and all three were
  information rather than answers. The Appliance/Paint rail (see below). The twelve room chips,
  now **one pill and a *Change*** — a paragraph of controls standing in for one word, eleven of
  them wrong, on a page read far more often than it is edited. And the prose under every section
  heading: "the filter, the bulb, the cartridge" and the rest.
- **No example values in any box.** A grey `7A204871` under SERIAL and `Nov 2019` under INSTALLED
  do not read as prompts; they read as a serial number and a date somebody already entered, on the
  one page in this app whose whole job is to be believed in a shop eight months later. The
  uppercase label above each box already says what it wants. (The "what does it take" box keeps
  its prompt: it is an add control with no label of its own, which is a different job.)
- **Taps are not in the form.** The room, the parts list, photos and documents each
  still write on press. Those are single decisions that are their own confirmation, and putting a
  dozen of them behind one button is how sorting out a room becomes forty taps.
- **A field is stacked — name above, box below, full width.** The old two-column row had nowhere to
  put a long answer, and `MSZ-AP50VGK` and "Award Appliances" are exactly what somebody came to
  read. It also overflowed: on web a `TextInput` is an `<input>` with an intrinsic ~20-character
  width that `min-width: auto` will not shrink below, so a flexed right-aligned value grew past the
  card and off the screen edge. Anything flexed around a `TextInput` needs `minWidth: 0`.
- **Paperwork lives beside the photos.** `things.document_paths` holds PDFs in the **`home-photos`**
  bucket under `<household_id>/docs/`, reusing the four storage policies and
  `home.can_use_photo_folder` rather than standing up a second bucket. Its `allowed_mime_types` had
  to learn `application/pdf` — which Storage enforces *before* RLS, so a PDF was refused with
  nothing said about permissions. The original filename is kept in the key because it is the label:
  a list of UUIDs answers nothing. Opened with a signed URL in a new tab, never embedded — the
  deployed CSP sets `object-src 'none'` and names no `frame-src`.

  **The bucket id says "photos" and the bucket holds manuals. Leave it.** A bucket id cannot be
  renamed, so undoing the mismatch means a second bucket, four more storage policies, another
  EXECUTE grant on another folder helper and a second signing path — for the same bytes under the
  same layout. The name is the price, and it is paid once: the *code* is named for what it does.
  One exported constant, `HOUSEHOLD_FILES_BUCKET` in `lib/supabase.ts` (it was declared twice, which
  is two strings that have to agree about a storage policy), and the signing helpers are
  `getFileUrl` / `getFileUrls` — a manual fetched through something called `getSnagPhotoUrl` is how
  the mismatch spreads from the string into everything that touches it.
- **No new colour.** Kind is an outline icon. The palette's four hues stay spent on state, and a
  thing has no state.

### Five kinds, two built

`home.thing_kind` is `appliance | finish | fitting | fabric | contact`, all five in the enum from
the first migration so adding the rest is a screen and not a migration. `THING_KINDS` is the two
that are offered: appliances and paint, the two with the sharpest read moments.

`make`/`model` carry the paint case as readily as the appliance one — Resene / 7BB 83/018 sits in
the same two columns as Bosch / SMS46MI01A, and both are strings read aloud to somebody else.
`THING_KIND_FIELD_LABELS` changes only the words. The genuinely per-kind fields (a paint's sheen
and tint formula) live in `spec`, which is jsonb and is the small tail, never the body — one table
rather than five, because five would be five read policies, five write functions and five places
to get the property check wrong.

**The walkthrough asks the kind; the thing page no longer offers to change it.** Step two sets it
from whatever was chosen — a suggestion carries its own kind, and naming something yourself asks
in two chips. There used to be an Appliance/Paint rail at the top of the spec sheet, because
capture filed everything as `appliance` without asking and the page had to be able to correct it.
Now that the kind is asked where somebody is choosing what the thing *is*, a kind switch sitting
over a filled-in record is an offer to turn a dishwasher into a tin of paint on a mis-tap.
Mis-filed, it is removed and added again — rarer than the mis-tap.

`update_thing` still takes `p_kind` (and `20260912170000` exists because the first migration
forgot it). Nothing in the UI passes it; leave it, because five kinds are in the enum and the
three unbuilt ones will want it.

### Four joins, all using mechanisms that already exist

- **`snags.thing_id`** — what a snag is about. `on delete set null`, never cascade: what was wrong
  with the old dishwasher is still what was wrong. It is set at capture (the amend sheet's fourth
  step, above) and cleared from the snag's own page; the house record it needs is read **when a
  snag is filed, not when the list loads**, because the list is the screen people open constantly
  and this serves a sheet that only appears after capture. Keyed by property, so moving between
  the house and the bach re-reads rather than offering the wrong place's appliances. If that read
  is slow the step appears late and if it fails the step never appears — neither can block a snag
  that is already on the list.
- **Pointing a snag at a thing does NOT start the job.** Saying what something is about is the
  tail of capture, the same gesture as tagging the room. Assignee, due date, repeat and parts
  start it; `thing_id` doesn't, and the `v_started` expression in `update_snag` says so.
- **Nothing copies a thing's consumables onto a snag's parts list.** The client offers them as
  taps. Filling the parts list is what moves a snag to 'doing', so a job that started itself
  because somebody named the appliance would empty the status from the same end the *Start it*
  button did.
- **`service_days` is not a scheduler, and now it does something.** It used to be a rail of
  intervals on the spec sheet that answered a question and then sat there: the column was written
  and no job ever appeared. It is a **Schedule service** button and a modal now — how often, who
  does it (`spec.servicedBy`), when the first one lands — and pressing *Put it on the list* writes
  the cycle to the thing and puts a repeating snag on the list. Still no cron, no second table, no
  notifications; the modal says so in words, because a thing called "Schedule service" is exactly
  what somebody would expect to remind them. `describeCycle` is shared by both so they say it the
  same way ("every 6 months", never "180 days") — see *One vocabulary for how often* below, which
  is what finally made that sentence true.

  **The job is created already dated, in one call.** Setting a due date or a repeat through
  `update_snag` is one of the four things that *start* a job, so create-then-update would put a
  heat pump service on the list marked **Doing** for the six months before anybody touched it —
  emptying the status from the same end the retired *Start it* button did. `20260914150000` gave
  `create_snag` `p_due_at` and `p_repeat_days` so `v_started` never runs. This is not a second way
  to schedule anything: same two columns, same table, same `set_snag_status` rolling it forward.
  **The compose bar passes neither and never will** — capture asks nothing before it files.

`things.room` is TEXT for exactly the reason `snags.room` is, and the House tab groups by
`home.locations` in seeded order — the two tabs have to describe the house in the same words and
the same order, or the room a snag is in and the room a thing is in stop reading as the same
place. Things with no room fall under **Whole house**. Photos reuse `home-photos` and the existing
`<household_id>/<file>` layout, so no storage policy changed.

**The tab is called House, not "My House".** The moment there is a bach, "my house" is the wrong
name for half of what it holds; the property name goes in the screen header instead, through the
same picker capture has.

`ThingDetailScreen.test.tsx` pins the reversal: every applicable field rendering as a box on an
empty thing, no Serial on a paint, Save off until something is typed, one write carrying only what
changed, and an emptied box clearing the column rather than leaving it alone. It also pins what
was taken away — no example values, no kind rail, one room pill, no section prose, no *On the
list* — and that scheduling a service is one `createSnag` carrying its own date and repeat rather
than a create followed by an update.
`houseRecord.test.ts` also pins the document key round-trip — the filename surviving, hyphens not
being mistaken for the prefix, and two uploads never colliding (`upsert: false` makes a collision a
failure, not an overwrite).

`HouseScreen.test.tsx` pins the furnished day-one screen, the per-room counts, Whole house last
and unfurnished, a search answering flat with no ghosts in it, a dismissal leaving no way back,
and the absence of any grouping control. `houseRecord.test.ts` pins the catalogue being deduplicated, reaching across
rooms and carrying only describable kinds, the substring matcher (including "wash" finding the
dishwasher, which is right rather than a near miss) and the miss that puts *Add it yourself* on
screen. It also pins the consumables search (the
`GU10` case), the headline rules, `describeCycle`, the loose dates, and `ghostsForRoom` — including
the case where a thing filed as "Bosch dishwasher" counts as having answered the Dishwasher
prompt, and the paint rules above: one general prompt per room, answered by any finish in it and
by nothing in another room, with the colour leading and the code searchable.

## Why the app exists at all

Not to transmit a job — saying it out loud does that. It's to hold work that sits *below the
threshold of action* until a moment when the threshold drops: a free Saturday, a trip to the
hardware store you're making anyway. Two kinds, same kind:

- **Calendar-forgotten** — gutters, smoke alarm batteries, the heat pump filter. Handled by
  `due_at` + `repeat_days`.
- **Threshold-forgotten** — the toilet seat. Never urgent enough alone, worth doing when three of
  them can be done together. Handled by the weekend view.

Both are served by the list itself. It groups by **room**, because that's how work is batched —
you do the garage once — and the **Needs parts** lens puts a combined shopping list above the
cards: every item the visible jobs are waiting on, with the room each is for. The trip to the shop
is the single most common reason a small job stays undone for weeks, so that collection is the one
piece of the retired Weekend tab worth keeping, and it now lives where people already are.

## Recurring items have no scheduler

Marking a repeating snag done doesn't close it. `home.set_snag_status` rolls `due_at` forward by
`repeat_days`, records `last_done_at`, and leaves the status `open`. That's the entire feature —
no second table, no cron, no notifications.

Two consequences: `done_at` alone would lose the fact a repeating job was ever completed, which
is why `last_done_at` exists; and callers must re-read the returned snag rather than assuming the
status they asked for. `SnagDetailScreen` says what actually happened rather than "Done". The
Schedule tab reads `last_done_at` for the same reason, and it is the honest limit of what the
schema remembers: only the most recent completion, so the tab shows the ones it can prove and
invents no history it hasn't got.

### One vocabulary for how often

`REPEAT_PRESETS` (a snag's repeat) and `SERVICE_CYCLES` (a thing's servicing) are two selections
from **one** vocabulary, and they live beside each other in `shared-types` for a reason: they
drifted the moment they didn't.

`REPEAT_PRESETS` offered six months as **182** days; `SERVICE_CYCLES` used **180**. So "every 6
months" meant two different numbers depending on which screen set it — and because scheduling a
service *creates a snag* carrying that number, two snags with identical intent ended up with
different repeats. Worse, `describeCycle` only reaches months on a multiple of 30, so the 182-day
repeat came back out as **"every 26 weeks"**: the app failing to say back the words on the chip
somebody had just pressed, on four screens at once (triage, the Schedule tab, the thing card, the
extract).

**Six months is 180 days everywhere now.** It is not half of 365 and that is fine — this is a list
of household chores, not an amortisation schedule, and the number nobody types matters far less
than the words everybody reads.

The rule to keep, and the one `cycles.test.ts` pins: **every interval either list offers must be a
whole number of months or years**, so `describeCycle` never falls through to its weeks or days
branch for anything the UI can produce. It asserts the property rather than the numbers, so the
next interval added to either list cannot reintroduce this. It also pins that no phrase maps to two
day counts, and that each preset's label matches what `describeCycle` says about its days.

The weeks and days branches stay, because `create_snag` accepts any interval from 1 to 3650 and an
extract should say what the row actually holds rather than round it into a lie.

Setting one up is a **yes/no first, then the cycle**: how often, then when the first one lands,
then a plain sentence stating the arrangement. It used to be a row of presets with "One-off" among
them, which made the common answer — no, it doesn't come round — look like a setting rather than
the default it is. A repeat with no date on it would never surface, so choosing an interval sets
one; an existing date is never clobbered.

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
groups by as well as what the capture sheet offers — so it is an interface, not just a seed.

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

**An invitation waits on an address, not on an account.** `home.invite_to_household` takes any
email — signed up or not, named or not — and the row sits until somebody answers it.

This replaced `add_member_by_email`, which is dropped. That one required the other person to have
already signed up *and* already saved a name, so the honest answer to "add my partner to the house"
was **`That account has not finished signing up yet`** — a true sentence naming neither what went
wrong nor what to do, shown to the one person who couldn't act on it. The ordering was load-bearing
and nothing anywhere published it. On the live project it was the answer for every account but one.

It still takes an optional `p_property_ids`. Omitted means every property — right while there is one
place, wrong the moment there is a bach, so the client passes an explicit list once there is more
than one. **That list is chosen, not assumed.** It used to be `properties.slice(0, 1)` — whichever
place happened to be first in the *inviter's* linked list — with a hint underneath stating it as
though somebody had decided. A row of chips asks instead, defaulted to the place being looked at.

### The pending state, and the rule it does not break

CLAUDE.md said "no pending state" and meant it. The retired product's `invite_user` wrote the invite
row and returned — the RPC succeeded, the app toasted "Invite sent", the invite listed as pending,
and **no invite was ever emailed for the entire life of the feature**. Nothing said so.

**The failure was the claim, not the row.** So the row is back and the claim is not. Nothing sends
anything and nothing says it did: the toast is *Waiting for them — tell them to sign up with that
address*, the card says Snag doesn't email them, and `HouseholdScreen.test.tsx` asserts the word
"sent" appears nowhere on the screen. Telling the other person is still something you do out loud.
What the row buys is that they no longer have to do their half first.

**Don't add email delivery to this.** The moment a send can fail, the screen is claiming something
it cannot check, which is exactly where the old one died.

### The invitee answers it, and can refuse

`accept_invitation` and `decline_invitation` match on the *address the invitation names*, never on
an id alone, so an invitation is only ever actionable by the person it is addressed to — and
`my_invitations` is the only way an invitee reads one, so nobody can enumerate invitations by
household id. There is no read policy for them on the table at all.

It is answered in two places, and both are needed:

- **`SetupScreen`** — someone who has just signed up. The invitation beats *both* branches of that
  screen, because somebody staring at "Set up your house" must not have to guess the answer is
  behind the second button. It is looked for only once a profile exists, since `accept_invitation`
  needs one.
- **`HouseholdScreen`** — someone who already has a household. Without this an invitation to an
  existing user would be invisible: they never see Setup, and there is deliberately no household
  switcher. An invitation nothing can show is the silent failure the whole mechanism exists to end.

A waiting invitation renders under *Who's here* with an hourglass instead of an avatar and the words
"Waiting — they need to sign up with this address". **It must never read as somebody who is here.**

## Deleting your own account

`home.delete_my_account`, on the Profile tab, below Sign out and quieter than it — the everyday door
and the other one should not look alike. Gated on typing your own name, the same gate deleting a
place uses and for the same reason: it can take a household with it.

Households you are the only member of go whole. Households you share do not — it leaves those
exactly as `remove_member` would, nulling your assignments and handing on any property you were
alone on. Files first, then the account, then `signOut`: the storage delete policy asks
`home.is_member(<household id>)`, so an account that has deleted itself cannot clear up after
itself. Same rule as deleting a household, written up under *Taking someone, or something, away*.

### A profile outlives its login

**`home.profiles.id` no longer cascades from `auth.users`**, and this is the load-bearing part.
Six columns record who did something — `snags.reporter_id`, `snags.updated_by`,
`comments.author_id`, `things.created_by`, `things.updated_by`, `absent_things.created_by` — and
three are NOT NULL. They are NO ACTION deliberately, because `remove_member` already leaves the
profile row alone so a snag still says who filed it.

So deleting the login used to try to take the person with it, and the person is still referenced by
every household they leave behind. `delete_my_account` failed outright on the first realistic shape,
with `23503 ... violates foreign key constraint "snags_reporter_id_fkey"`.

An account and a person are not the same row. A login is a way in; a profile is a name attached to
work that happened. `delete_my_account` deletes the `auth.users` row and leaves a **tombstone**: the
profile row with `deleted_at` set and the display name replaced by *Someone who left*. The name is
the personal thing, and the name is what goes. `snags_with_details.reporter_name` then reads
"Someone who left" rather than the household losing work that was never the leaver's to take.

`upsert_profile` clears `deleted_at` on the way past. Signing up again gets a new `auth.users` id
and therefore a new profile, so that can't actually be reached — it is there so a row that ever does
come back doesn't read as gone everywhere it is named.

### A code you can hold up

Typing an address assumes you know it and are willing to type it. Standing in the same kitchen both
are friction, so an invitation can also be addressed to **whoever holds the link**:
`home.create_invite_link` mints the household's one live code and the QR encodes
`https://app.snaghq.co.nz/join/<token>`.

**It is one table and one accept path, not a second mechanism.** A row is addressed by `email` OR by
`token`, never both and never neither (`invitations_addressed_one_way`), and a partial unique index
keeps it to one live link per household — so pressing *Show a QR code* again kills the old one,
which is the thing somebody pressing it is usually trying to do. The Schedule tab's rule applies
exactly: two ways to join a household and neither is trustworthy.

**Nothing in this app scans anything, and that is the design.** The scanner's own camera opens an
ordinary URL — which is the point, because the person scanning has not installed Snag yet. No camera
permission, no scanner screen, and no getUserMedia to get past the deployed CSP. `netlify.toml`
already spelled out why an in-app scanner would fail silently: `expo-camera`'s module scope builds a
`blob:` worker that pulls jsQR off a CDN, the policy blocks it, and a blocked import is not a
runtime error anybody gets told about. **Don't add a scanner.**

Short-lived and revocable is the whole security model: 24 hours, one tap to stop, and every arrival
still presses Join. A screenshot is a way in until it expires. That is what keeps this from becoming
the retired product's join codes, printed on walls with nobody able to say who held one.

Three things make the journey work, and each is silent if it breaks:

- **`isPreservedUrl` keeps `/join/<token>`.** Signing up *is* the journey here — the scanner has no
  account — so losing the token across the auth round trip drops them on an empty Setup screen with
  no idea what they scanned and no way to recover the code.
- **The `/*` → `/index.html` rewrite in `netlify.toml`.** `/join/<token>` is a path and the export
  writes no file for it; without the rewrite Netlify answers 404 before the app loads. `csp.test.ts`
  pins it for that reason, alongside the schemes.
- **`/join/:token` is deliberately NOT in `linking.ts`.** `JoinScreen` is a gate in `App.tsx`, not a
  route, because the normal case is somebody with no household — there is no navigator to route them
  through. A matched path would send React Navigation somewhere while the gate is asking a question.

It is a question, not a fourth gate: no token in the URL, no branch. `clearJoinToken` takes the code
out of the address bar *before* `loadAccount` re-gates, or the next reload asks again about a
household they just joined.

`JoinScreen` answers three arrivals and all three are real: a live code (asks), a dead one (says so
in words — a screenshot of yesterday's code is not an error state), and a code for a house you are
already in (people scan twice).

`SetupScreen.test.tsx` pins the invitee's end, `ProfileScreen.test.tsx` the deletion order and that
Delete sits quieter than Sign out, `JoinScreen.test.tsx` the three arrivals and the clear-before-
re-gate order, `joinLink.test.ts` what is and isn't a join path, and `HouseholdScreen.test.tsx` the
waiting rows, the cancel, the answerable invitation, the absence of the word "sent", and that a live
code never renders as somebody waiting to arrive.

## Taking a list out of the app

A **CSV** to sort, a **PDF** to send to somebody. Both offered from the foot of the scrolled
content on the List and House tabs — `ListFooterComponent`, deliberately **not** pinned to the
bottom of the screen, because on the List tab that is the compose bar and nothing goes on the
compose bar. An export is a thing you go looking for at a desk once a month; reaching the end of
the list is the cheapest possible place for something that rare.

**One table, two renderers.** `snagExportTable` and `thingExportTable` build the rows in
`packages/supabase-queries` with the other pure helpers, and `toCsv` and `renderPdf` only format
them — so a CSV and a PDF of the same extract can never disagree about what is in it.

**Scope is asked every time and never remembered.** *What's on screen* honours the lens, the
search and the done section; *Everything* ignores all three. They are genuinely different
documents, and a file whose contents depend on a filter you set twenty minutes ago is one you will
misread later — so both chips carry their row count, and the file names the scope, the house, the
place and the day at the top.

**Both questions are answered before anything happens, and one button does it.** Spreadsheet and
PDF used to *be* the action — two buttons, each choosing a format and firing at the same moment,
which put the only irreversible control on the sheet one tap from opening it. It also made the
sheet contradict itself: the scope rail said "pick one of these" while the row underneath said
"press either of these to finish", and the lit scope chip, the filled PDF button and the outlined
Spreadsheet button meant three of five controls read as the primary action with none of them
labelled as one. Everything above the fold is a chip now — the app's one chip, sunken off, solid
fern on — and **Export** is the only filled button in the dialog.

**Ghosts are in neither extract**, which is the House tab's own rule reaching one place further: a
suggestion never becomes a row, so it can never become a line in a record somebody checks in a shop.

### Photographs ride in the PDF, and only there

A spreadsheet cell cannot hold a picture, which is why `snagExportTable` carries a photo *count*.
The PDF is the copy that gets sent to somebody who was not there — a builder, a landlord, an
insurer — and for that reader the photograph is most of the evidence, so it goes in: three across,
two down, after the table, each captioned with the headline the list shows and the reference and
room beneath it. A page of uncaptioned photographs of six different rooms is the part of a report
nobody can act on. **The sheet says which file carries them**, because that is the one real
difference between the two and the reason somebody picks the PDF.

- **Twenty, capped, and chosen one round each.** `snagExportPhotos` / `thingExportPhotos` walk the
  rows taking each one's *first* photo before any row's second. Row order would let a single snag
  photographed from five angles spend a quarter of the allowance, and an extract of fourteen jobs
  would come back picturing four of them.
- **Bytes, not an `<Image>`.** jsPDF will take a DOM element and `apps/mobile` runs on phones too,
  where there isn't one — and reading pixels back off a canvas would need a `blob:` the CSP has no
  rule for. A signed URL fetched as an array buffer is the one path both platforms and the deployed
  policy already allow, because it is the request every thumbnail on the list already makes.
  `connect-src` covers `https://*.supabase.co` already; nothing in `netlify.toml` changed.
- **A photograph that will not come is left out, never thrown.** Signed URLs expire and keys get
  orphaned. Somebody waiting on a file at a desk wants the twelve pictures that did arrive, not an
  error naming one that did not — so a 404, an unsigned key, bytes that are neither JPEG nor PNG,
  and one jsPDF cannot decode each cost their own well and nothing else.
- **Letterboxed, never cropped.** A crop takes the middle of a photograph somebody framed
  deliberately, and the whole reason a snag has no title is that the framing is the description.

`exportFile.test.ts` pins the round-robin, the cap, the captions, the three ways a photo is dropped
rather than raised, and the page arithmetic — six to a page, against a real jsPDF with real PNG
bytes, for the same reason the PDF itself is not mocked.

Four things about the file itself, each of which is how a spreadsheet extract usually arrives
looking corrupt when it isn't:

- **Every value is quoted and inner quotes are doubled.** A snag's description can hold a comma, a
  quote and a newline at once.
- **CRLF**, which Excel on Windows still wants and everything else accepts.
- **A UTF-8 BOM**, without which Excel guesses a code page and every macron in a NZ address comes
  back mangled.
- **A photo-only snag gets `snagHeadline`**, because it has no words of its own and a spreadsheet
  cannot show the photo.

### The bundle cost, and why it is paid up front

`jspdf` + `jspdf-autotable` are imported at module scope and take the main web bundle from **2.65 MB
to 3.14 MB (+490 KB)**. That is not laziness: `"output": "single"` in `app.json` means Metro emits
one bundle with no lazy chunks, and the deployed CSP is `default-src 'self'` with no CDN reachable —
so there is nowhere to fetch a renderer from at export time. It ships in the bundle or the feature
does not exist. (jsPDF's `html2canvas` and `dompurify` do come out as separate chunks; nothing calls
`.html()`, so they are never fetched.)

**Two traps, both already sprung once:**

- **Downloads and the CSP.** A download is a navigation, not a fetch, so `connect-src` does not
  govern it and `object-src 'none'` covers `<object>`/`<embed>` rather than `<a download>`. Verified
  in Chromium against the deployed policy: the download fires, no violation. The directive that
  *would* kill it silently is `sandbox`, which `csp.test.ts` now asserts is absent.
- **jsPDF under jest.** Its `exports` map names only `node` and `browser` conditions, so jest-expo's
  resolver finds nothing — `moduleNameMapper` points at `dist/jspdf.umd.min.js`. And Expo's winter
  `TextDecoder` polyfill wins over Node's without implementing `latin1`, which jsPDF needs at module
  scope: `jest.setup.js` hands Node's back. Deliberately not a mock of jsPDF — `exportFile.test.ts`
  asserts a real PDF comes out, `%PDF-` to `%%EOF`, because the thing that actually breaks here is
  the library failing to run at all, which is exactly what a mock hides.

`exportFile.test.ts` pins the escaping, the BOM, the CRLF, the photo-only headline and the real PDF;
`ExportSheet.test.tsx` pins the counts, the default scope, that choosing a format exports nothing
until *Export* is pressed, that the sheet says which file the photos are in, and that an empty
extract is refused;
`SnagListScreen.test.tsx` pins that *Everything* ignores the lens and includes done, and that the
control is at the foot rather than on the compose bar; `HouseScreen.test.tsx` pins that not one
ghost reaches the file.

### The PDF can carry the question, and the answer comes back by hand

The loop is deliberately **outside the app**: a briefed PDF goes out, somebody puts it in front of
an assistant, and the reply is pasted back in. No key, no queue, no edge function, nothing to
rate-limit and nothing that can fail while claiming it didn't. `assessmentBrief` writes the
question, `parseSnagActions` reads the answer, and both are pure — the whole judgement of this
feature is in two functions `advice.test.ts` can assert without a network.

**The brief rides in the PDF and only there**, exactly as the photographs do: an `ExportTable`
holds rows to be sorted and a brief is prose addressed to a reader. It is two named chips on the
export sheet — *To get it assessed* and *To send to somebody* — asked every time and never
remembered, like scope, and defaulted to the brief because that is now the main reason a PDF gets
made. Not one chip that toggles, which would leave the other answer as the unlabelled absence of a
press; absent entirely on a spreadsheet, and on the house record, where nothing is wrong with a
dishwasher that is merely recorded.

Four things in the wording are load-bearing:

- **It states the scope it was made under**, because the chips already asked and *Everything*
  includes finished work. A brief reading "review all open issues" would contradict the file it is
  stapled to and spend half the answer on jobs already done.
- **It requires the page every tradesman was found on, and permits "none found".** Asked for three
  local tradesmen, an assistant with no way to look will produce three plausible names and three
  plausible mobile numbers, and at this end they are indistinguishable from real ones. A URL is the
  only part of such a row anybody can follow, so `parseTradies` **drops a tradesman with no
  source** rather than showing one unsourced. Same lesson as the invitation screen: the row was
  never the problem, the unverifiable claim was.
- **It names the work a householder legally cannot do** — prescribed electrical work, gasfitting,
  most plumbing and drainlaying, anything needing a consent or an LBP, asbestos disturbance in a
  pre-2000 house, roof work at height. A hard list in the text, not a hope about the answer.
- **It asks for the callout fee and the likely total separately**, because "about $200" means
  different things as each, and the difference is what a household actually decides on: four jobs
  booked into one visit pay the callout once.

**The answer is never a comment.** `home.add_comment` sets `status = 'doing'`, so an assessment
posted as a note would mark the job as being worked on. It is `home.snag_advice` — one row per
snag, replaced rather than stacked, because the PDF is the history and nobody wants to compare last
month's guess.

**And recording it does not touch the snag.** This is the rule to keep. `update_snag` starts a job
the moment parts, a due date, an assignee or a repeat change, and an assessment answers all of
those at once — so applying a reply through it would mark every open job in the house as being
worked on the moment somebody pasted, which is the retired *Start it* failure at twelve times the
scale and from the other end. Suggested parts are **offers with a + beside them**, accepted one tap
at a time from the snag's own page, and that tap is the human act that starts the job.

Money stays **text**, quoted back with the date beside it: parsing "180-260" into a number is the
app asserting a precision the answer never had. An unknown reference is **named, never guessed at**
— a job from another place, one since deleted, or an invention all get the same answer, because
silently filing eleven of twelve is the version nobody notices. And a paste that fails says *which*
of the three ways it failed, since nothing pasted, no block in it, and a block that isn't readable
are three different mistakes with three different fixes.

A place knows its **suburb and town** now (`set_property_location`), which is what lets the brief
ask for somebody local. Not a street address: the file gets forwarded, and that is precision
nobody needs and everybody who receives the PDF would then hold.

`advice.test.ts` pins the brief's scope line, the source requirement, the restricted-work list, the
split costs and the fence, and the whole of the parser — the unsourced tradesman, the caps, the
three failure messages, and the unknown reference. `AdviceCard.test.tsx` pins the source line, a
part being an offer, an accepted one going quiet, the tradesmen staying collapsed and never showing
without their source. `PasteAdviceScreen.test.tsx` pins that nothing writes before the review, that
filing never calls `updateSnag`, the unticked row, and the partial-failure count.
`ExportSheet.test.tsx` pins the two chips, their absence on a spreadsheet and on an extract that
cannot carry a brief; `exportFile.test.ts` pins that the brief reaches the PDF, never the CSV, and
that the page numbers count its sheets.

## Taking someone, or something, away

Adding had no opposite for eleven migrations, and the gap had a sharp edge. `getMyHousehold` reads
the households RLS lets you see and takes **one** — so somebody who tapped *Create it* on the Setup
screen instead of *Someone else set ours up* owned an empty household, was then added to the real
one, and stayed pinned to the empty one for ever. No switcher, no error, nothing on screen able to
explain it. `20260914160000` is the other half.

**The read is ordered by when you joined, newest first.** Not by when the household was made: that
asks the wrong question, and it is the exact line the bug lived on. There is still deliberately no
switcher — App.tsx is three gates and a fourth would be a different product — so the way out of a
mistake is to leave or delete, not to pick.

Three functions, and each refuses the one case that would strand a row nobody can reach:

- **`remove_member`** takes somebody out, or takes you out; deliberately one function, because with
  two people in a house those are the same act and there are no roles here to make one a privilege.
  It refuses the last member (a household nobody is in is invisible to everyone, including whoever
  would add somebody back). It **nulls their assignments**, because an assignee who cannot see the
  place is a job that silently never gets done — the same state `update_snag` already refuses to
  create. And a property they were the only person on is **inherited**, by the caller, or by the
  longest-standing member when the caller is the one leaving: refusing instead is a dead end, since
  you cannot link somebody to a place you can no longer see. The profile row is untouched, so a snag
  still says who filed it.
- **`delete_property`** refuses the household's last place, for the reason `create_household` makes
  one in the first breath: a household with no property cannot receive a snag.
- **`delete_household`** refuses while anybody else is in it. At that point the list is theirs as
  much as yours and the honest move is to take yourself out.

**The client has to clear the storage keys, because SQL can't.** `storage.protect_delete()` raises
`42501` on a direct delete of a `storage.objects` row, rightly, because that leaves the bytes behind
with the row gone. So `deleteStoredFiles` does it, with a session that passes
`home.can_use_photo_folder`. The same helper now runs after `deleteSnag` and `deleteThing`, which
both used to drop the row and leave the JPEGs — the orphan `SNAG_INFRA_NOTES.md` had a manual audit
query for.

**And a household is the one case where the order inverts.** `delete_property` *returns* the keys
its cascade orphaned and the client clears them afterwards, which works because your membership
survives. A household cannot do that: `can_use_photo_folder` reads the first path segment as a
household id and answers `home.is_member(...)`, so deleting the household removes the row that
permission is read from, and keys handed back afterwards are keys you can no longer act on — every
delete refused, in silence, because `deleteStoredFiles` deliberately never throws. So
`getHouseholdFilePaths` is read **first**, the files go, and the household goes last
(`20260914161000`). Left the other way it is the path that orphans the most files orphaning all of
them. `delete_household` returns void for the same reason: keys you can't use read as keys that
were dealt with.

On the screen: **exactly one of Leave and Delete is ever offered**, because exactly one of them can
succeed. Deleting a place is the one action in this app that destroys somebody else's work rather
than a row of your own, so it is the one confirmation that asks for the place's **name to be typed**
(`ConfirmDialog`'s `confirmText`) and names what goes with it in counts rather than warning in
general. Everything else stays a two-button `ConfirmDialog` — never `Alert.alert`, which is a no-op
on the build people install.

`HouseholdScreen.test.tsx` pins that the last member has no ×, that Leave and Delete are never both
on screen, that a place delete is gated on the typed name and hands its returned keys to
`deleteStoredFiles`, that a household delete clears its files *before* the membership that
authorises clearing them, and that a new member goes to the places that were picked.
`household.test.ts` pins the newest-join-first read.

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
- **The parts pill** on a card — deliberately colourless. What a job needs from the shop is a fact
  about a trip, not an alarm. One item is named ("L-brackets"), more are counted: the name is what
  tells you what the trip is for, and a count never did.
- **`DueBadge`** — overdue is the one thing on a household list that has earned red. It's a fact
  about a date, not a judgement about importance.

### One chip, every rail

The amend chips and the "Show me" sheet on `SnagListScreen`, and every control in *Sort it out* on
`SnagDetailScreen`, all say the same thing the same way: **a sunken well when off, solid fern when
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
2. Apply via the Supabase MCP (`apply_migration`) or the SQL Editor — **before** merging the code
   that reads it. `main` is what `app.snaghq.co.nz` serves, and a client naming a column the
   database has not got gets a 400 on the whole request, which reads on screen as an empty tab.
   See *"Everything has disappeared" has a second cause* above.
3. Add the type to `packages/shared-types/src/index.ts`
4. Grant explicitly, by name
5. **Add it to the view as well, by name.** Every list and detail screen reads
   `snags_with_details` or `things_with_details`, never the table.

**A view created with `select t.*` freezes its column list the moment it is created.** This has
already cost one silent bug: `document_paths` was added to `home.things` two days after
`things_with_details` was written, so the star had long since been expanded and the new column was
not in it. The write worked, the toast said "Document added", and the PDF was invisible for ever
after — the read dropped the column, `mapThing` defaulted it to `[]`, and nothing anywhere had an
error to report. `20260914140000` rebuilt the view with its columns **written out one by one**, so
the next added column is a visible omission in a diff rather than a silent one at runtime. It is
the same argument as granting by name rather than by sweep, and `t.*` should be read the same way
a grant sweep is: as something that looks like "everything" and means "everything as at the moment
somebody typed it".

Note `create or replace view` can only *append* columns. Putting one back where it belongs means
dropping and recreating the view, which takes the grant with it — re-issue it.

### Add a query
`packages/supabase-queries/src/index.ts`. Each function takes a `SupabaseClient` so both apps can
call it with their own; `apps/mobile/src/lib/supabase.ts` re-exports them bound to its client and
should contain no logic of its own.
