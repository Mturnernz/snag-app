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
| Web | Next.js: `apps/web` (password recovery) and `apps/staff` (the SnagHQ staff portal), see below |
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
│   │       ├── screens/           # SnagList (home), SnagDetail, House, HouseRoom, ThingDetail,
│   │       │                       #   Household, LocationTags, Profile, Auth, Setup
│   │       └── components/
│   ├── web/                       # Next.js — /, /forgot-password, /reset-password. That's it.
│   └── staff/                     # Next.js — the SnagHQ staff portal, staff.snaghq.co.nz
├── packages/
│   ├── shared-types/              # @snag/shared-types — enums, row types, labels, nav params
│   └── supabase-queries/          # @snag/supabase-queries — every read and write, each taking a client
│                                   #   (…/staff is the portal's own entry point; the app never imports it)
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
has not got yet**, and it has already happened once: a merge to `main` then deployed `apps/mobile`
straight to Netlify, so pushing code whose migration had not been applied put exactly that client in
front of people. `getMyProperties` names its columns — `select('id, household_id, name, suburb, town, …')` —
so PostgREST rejected the whole request rather than returning a row with two nulls, `useHousehold`
came up with no properties, and the **House tab rendered empty**, because `getThings` needs an
active property. Eighteen things sat untouched in `home.things` the whole time.

Two things to take from it:

- **A read that names its columns fails loudly, and a `select('*')` does not.** That asymmetry is
  why the List tab still worked while the House tab looked wiped: `getSnags` stars the view, so an
  absent column came back as `undefined` and `mapSnag` defaulted it. Naming columns is still right
  — it is the same argument as granting by name — but it means a missing column is a **400 on the
  whole request**, not a gap in one field, so the screen that loses it loses everything.
- **Apply the migration before the merge**, and never deploy past one that has not been applied.
  There is no staging database: `main--snagv1.netlify.app`, the preview every merge builds, reads
  the live one exactly as `app.snaghq.co.nz` does. The live app is the `production` branch, and it
  moves only when *Deploy to production* runs, which lists the migrations each deploy carries (see
  *Deploys cost credits; previews don't*). Order: apply, check the API answers, merge, deploy.

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
  detail screen reads. (Projects, bills and the rest have grown it since; the staff portal adds
  `staff`, `support_requests`, `support_messages` and `support_access_log` — see *The staff
  portal*.)
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

### A view without `security_invoker` has no RLS at all

**This is the most dangerous line in the schema and it is invisible.** A view is
evaluated against its base tables' policies as the *view's owner*. These are owned by
`postgres`, which is a superuser and therefore exempt from RLS — so a view without
`with (security_invoker = true)` hands **every row in the table** to anybody holding a
valid token. It type-checks, it renders, the app works, and nothing anywhere has an
error to report, because from the client's side more rows are indistinguishable from
rows it was entitled to.

It happened here. `snags_with_details` and `things_with_details` were both created
correctly in `20260911*`, and then `20260917090000` and `20260920100000` rewrote them
with `create or replace view ... as` and no `with` clause. **A replace with no clause
resets the options rather than keeping them.** Both migrations are about adding a
column, say nothing about security, and read as obviously safe. Measured before
`20260921100000` closed it: an account belonging to no household read 0 rows from
`home.snags` and **36** from `home.snags_with_details`, with the descriptions, rooms
and reporter names in them.

Nothing in the app reads those tables directly — `getSnags`, `getSnag`, `getThings`
and `getThing` all name a view — so the List tab, the House tab, the Schedule tab and
both extracts were every one of them served past RLS.

Three things follow:

- **Every `create or replace view` carries the clause**, even when the change is about
  a column. It is the same argument as writing a view's columns out one by one rather
  than `select t.*`: the omission has to be visible in a diff.
- **`viewSecurity.test.ts` replays every migration in order and asserts where each view
  *ends up***, rather than checking the two by name. That is what Postgres does, it is
  what both regressions exploited, and it means the next bare replace fails in CI
  rather than a day later in somebody else's household.
- **Don't reason about it from `pg_get_viewdef`** — the option is not in the definition.
  `select relname, reloptions from pg_class` is where it lives.

### An RLS policy's functions need EXECUTE

A policy expression is evaluated as the *calling* role. `home.is_member` is called by every read
policy, so revoking it from `authenticated` doesn't return zero rows — it raises
`42501: permission denied for function is_member` on every single read. That happened during the
first migration and is why `20260911093000` exists.

The three helpers only ever called from *inside* SECURITY DEFINER functions (`require_member`,
`snag_household`, `is_member_profile`) stay revoked, because those calls run as the function
owner and the caller's EXECUTE is never consulted.

## The usability pass (September 2026)

A customer-journey review counted taps and duplicate routes outside the Projects tab, and nineteen
changes came out of it. Several reverse a decision written up further down; those sections have
been edited in place, and where anything below still disagrees, **this section wins**.

- **Words.** A list entry is a **job** and a house-record entry is an **item** — in the compose bar
  (*Capture a new job*), the job page (*Linked items*), the picker, the thing page (*Remove this
  item*) and every confirmation. The code still says `snag` and `thing`; only what people read
  changed. The Projects tab kept its own vocabulary.
- **Capture.** A library button beside the field (item 3). On the amend sheet, **choosing a room
  finishes it** (it wrote the room and then waited for Submit), the room the last capture used is
  **offered** for ten minutes — lit, written only when accepted — and the sheet no longer toasts
  each answer back.
- **Every place that adds photos offers the camera and the library** — the reversal is written up
  under *Paperwork lives beside the photos*.
- **The list**: *Due soon*, the tick on each card with *Undo*, and no *Show me* button — under *The
  list is the app's home*.
- **The job page**: *Mark done* in the footer, leaving saves, one *When* card, and one-tap
  **suggested items** from the job's room on the *Linked items* card (one `getThings` read, only
  when the job has a room, never fatal; tapping writes through `set_snag_things` like the picker).
  The edit sheet's button is **Done** and never dead.
- **Things**: the thing page saves each box as it is left; one service job per thing; the
  walkthrough's cycle files it; *Report a problem* through the capture bar — under *The house
  record*.
- **Invites**: the link first, and a pasted link on the waiting screen — under *A code you can hold
  up*.

**One rule for saving, everywhere outside Projects: a tap writes when it is pressed, a box writes
when it is left, and leaving the page writes whatever is still in a box.** Buttons that commit are
kept only where something is being *created* (the add-a-thing walkthrough, the capture bar) or in
a sheet editing two fields together (the edit sheet, whose button is *Done*). A screen that asks
*Leave without saving?* has broken this.

## Capture and triage are different moments

This is the load-bearing product decision and the easiest one to erode.

**Capture** is the bar at the foot of the list (`ComposeBar`): a photo, or a line of text, or
both. One tap to the camera, or four seconds of typing. It is used standing in the bathroom
holding a broken toilet seat, with about ten seconds of patience.

**There is no Add tab, and adding one back would undo the whole arrangement.** Capture was a
destination once, and the cost was that the app opened on a form rather than on what the other
person had added. The camera is bottom-left because that is the easiest place on a phone to
reach one-handed; the old Add screen had it at the top, which is the hardest.

**The camera is the default, and the *field* says so.** A photograph is the snag, so the shutter
is what the bar is for and typing is the alternative — but the words for that belong in the
field, which reads **"Capture a new job"**, not on the button. The button carried the word
"Photo" for one commit, which put a label on the control whose meaning is least in doubt: a
camera glyph on a fern circle at the foot of a list is not something anybody has to read. Still
one tap to the camera rather than to a chooser, and still bottom-left. A photo somebody already
has goes in through the **library button at the far end of the field**, which gives way to the
send arrow once there are words — see *The usability pass*.

Five things about capture are load-bearing, and two of them are things it stopped asking:

- **There is no title column.** A photo says what a title would, and requiring one put a keyboard
  between someone and the problem in front of them. A snag needs a photo *or* a description
  (`snags_has_something`), and `create_snag` refuses the empty case in words rather than letting
  the constraint name surface. `snagHeadline` supplies what the list shows for a photo-only snag.
- **A line of text is a complete snag.** "Gutters" typed into the bar is a perfectly good entry,
  and making that the same gesture as sending a message is the point of the bar existing.
- **Nothing is asked before it is filed, and everything is asked straight after.** Taking a photo
  saves the snag and *then* opens `AmendSnagSheet`: what is wrong, then where, then the job itself.
  Every room is offered, never a shortlist — the one you want is the one you're standing in, and
  that is as likely to be the Roof as the Kitchen — through the searchable `RoomPicker` rather
  than a rail of chips.

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

  **It asks two things, and it used to ask four.** What went is instructive, because both
  departures were defended here once.

  *Is it about one of these?* offered the things recorded **in that room** and wrote
  `snags.thing_id`. The payoff was real — a snag that knows it is about the heat pump carries
  `thing_name`, `thing_make` and `thing_model` from `snags_with_details`, so the model number is
  on the job in the shop rather than two tabs away — but the *question* was tagging, at the one
  moment with ten seconds of patience. The job's own page gets the same answer without asking for
  anything: the room is already on the snag, so **Linked assets** lists what is recorded in that
  room, which is the shortlist a person would have picked from. See *Linked assets* below.

  *Does it need doing now?* went with priority itself. See below.

  **Finishing the sheet opens the job**, rather than dropping back onto the list. The one moment
  somebody is certainly thinking about this job should not end by showing them every other one,
  and everything the sheet stopped asking is decided on that page. The button says **Submit** —
  not "Done", which would describe the sheet's own dismissal while it is actually navigating
  somewhere, and not "Sort it out", which named the destination rather than the act. Note the snag
  was already created before the sheet opened, which is the arrangement's whole point: Submit ends
  capture rather than performing it.
- **Priority is gone from the app, not moved.** It was a capture decision, defended as the one
  judgement only the person standing there can make; nearly everything was filed Low, which is the
  premise of this product rather than a finding. Moving it to triage did not save it — urgency is
  comparative, a household list is a dozen small jobs none of which is an emergency, and a badge
  that is grey on every row is a column of noise. What actually sorts this list is a date and a
  trip to the shop.

  So `PriorityBadge`, `PRIORITY_LABELS`, `PRIORITY_ORDER`, the extract's *Priority* column, the
  priority sort and the **Urgent** lens are all deleted. **`home.snags.priority` is left unread
  rather than dropped**: rows hold answers somebody gave, and dropping the column would rewrite
  what they said. `create_snag` and `update_snag` still take the argument and are always passed
  null — the signature is the server's, and a positional gap is a different function.
- **Nobody is assigned anything either.** *Who's doing it?* went for the same kind of reason: two
  people in one house tell each other out loud, and the field mostly recorded that somebody had
  tapped it. `assignee_id` is unread on the same terms as `priority`, and the **Mine** lens went
  with it — a lens over a column nothing can write comes back empty for ever and tells nobody why.
  `update_snag` still validates an assignee against `property_members` if one is ever passed.

**Triage** (`SnagDetailScreen`, presented as a modal over the list) is everything else — what it
needs from the shop, when it is due, and whether it comes round again. Each control writes
immediately rather than collecting into a form with a Save button, because triage is a series of
small independent decisions and a Save button turns sorting twelve items into forty taps. It is a
**sheet rather than a push** for the same reason — though note react-native-web renders a modal
presentation as a full screen, so that particular benefit is native-only.

**Leaving saves, and the footer is *Mark done*.** There was a Save button here that closed rather
than collected, and it mostly read *Close* beside a back arrow that already did the same. What it
really did was commit the two boxes that can hold typed text — the date, whose `onBlur` is not
guaranteed on native, and the item typed into the shopping box, which waits on its own `+`. The
page now does that itself: `commitPending` runs on `beforeRemove` (every way off the page — the
header's back, Android's, a swipe) and before *Mark done*, as **one** `update_snag`, and a date no
calendar has holds the page open with the words still in the box. The hint in the bar still counts
the boxes, honestly — *"1 unsaved change — kept when you leave"*.

So the `StickyActionBar` holds **Mark done** (solid fern) or **Reopen** (outline). Finishing is the
most common thing done to a job that already exists, and at the foot of the scroll it was past
every card. The earlier worry — two primary buttons stacked, a thumb finding the wrong one — is
answered by there now being only one. **A slider was considered and rejected**, as before: finishing
is not irreversible (*Reopen*, the seven-day done list, and *Undo* on the list's own tick), and
ceremony spent where it is not needed is how it stops working where it is.

**There is no *Sort it out* card any more.** It held urgency, the shopping list and the assignee;
two of those are gone, and a card holding one thing is not a card — it is a heading pretending to
be a category. The order down the screen is now: photo strip, headline, the meta row,
**Linked items**, **Anything to pick up?**, what came back from an assessment, **Notes**, the
item's own history, and the **When** card (the date, then *Repeats*) — with *Mark done* in the
footer.

**The order is the order of inspecting and fixing something**: what the job is about, then what to
do about it, then when, then the one state change a person still makes by hand. The asset card
earned the top slot by shrinking — as a nine-row inventory it belonged below the work, as a
two-line summary of what this job concerns it is the first thing worth knowing. The assessment
card stays directly above the shopping list, because the parts it offers with a `+` land in that
list and a card whose suggestions are two cards away is one nobody connects to anything.

**Notes sit near the top, above every control.** This product has no notifications and never
will, so a note is the only way one person tells the other anything — "ordered the part, arriving
Tuesday" is usually the entire reason the screen was opened. Two cards of controls standing
between the photo and it made the one piece of news on the page the last thing anybody read.
**The box is four lines**, because a single-line slot says "a few words" to somebody whose actual
message is which part was ordered, from where, arriving when, and what it cost. Note that
`numberOfLines` is an Android-only hint on a multiline `TextInput` and does nothing on the build
people install, so the height is stated outright.

**It is an ordinary box with its own control underneath, not a chat row.** A 48px fern square
holding an up-arrow, vertically centred against a four-line box, is a *messaging* affordance, and
this is not a messaging app — so the box goes full width and the control sits under it reading
**Add note**. That is the same correction the shopping list's `+` already took: a word rather than
a glyph, on the control that commits what somebody has just written.

**Its placeholder names the box rather than showing a message.** It read "Ordered the part,
arriving Tuesday", which is an example — and this file's rule about example values is that they
read as something already entered, which on the one box holding what the other person said is the
worst place in the app for it. *"Add a note, or what you did"* says what an example never could:
that the box takes both halves of its job, the news and the record of the repair.

**Anything to pick up sits directly above the notes**, and that placement is the argument for it
having survived: the trip to the shop is the single most common reason a small job sits for weeks,
so it is the part of triage that actually moves work, and it sits with the two cards saying what
the job *is* rather than below the conversation about it.

**The three facts at the top are a way in, never a second way to write.** Status, when it's due
and which room it's in are what somebody wants off the top of this page — and two of the three had
their one control the better part of a screen further down. So the meta row states all three and
the two a person actually sets are doors: the due chip scrolls to the date field, the room chip
opens the same `EditSnagSheet` the pencil does. **One writer per fact**, which is the whole
constraint — a chip that set the date itself would be the duplicate date control this page has
already been through once, and the room has exactly one sheet precisely so two cannot disagree.

Two rules inside it. **Status is stated, not offered**: it is derived — a job starts when somebody
dates it or decides what to buy — and the one state change made by hand is *Mark done*, at the
foot, so a tappable status chip up here would be that button arriving at the top by another door.
And **both chips speak when the fact is missing**, reading *No date* and *No room* rather than
rendering nothing: a snag with neither is named elsewhere in this file as the weakest thing this
app can hold, and a row of two badges says that quietly where a row of three says it out loud.
The visible pill stays a badge and the `Pressable` around it carries `MIN_TOUCH_TARGET`, the same
split every chip row in this app makes.

**A job can hold more than one photograph.** One was all it could ever have, because the only
camera that reached a snag was the compose bar's and that files a *new* one — so the crack noticed
afterwards became a second job about the same thing. The + is at the end of the strip rather than
under it, and it inherits every upload rule the thing page paid for, now extracted into
`lib/addPhotos.ts` rather than copied a third time: one write at the end, one upload after
another, what arrived is kept, and the cap said out loud. Adding one deliberately does not start
the job — photographing something is not deciding to do it.

**A due date is its own field, and it is not only for repeats.** `due_at` used to be reachable
only from inside the repeat card, so a one-off job could never be given a date at all — which made
the Schedule tab's *Due* marks and the overdue badge features only repeating jobs had. Precisely
backwards: a filter that comes round every six months looks after itself, and the gutters before
the weekend away are what somebody needs reminding of. It is a `DateField` like every other date
in the app, committed on blur rather than on every keystroke — `8/1` on the way to `8/11/2019`
parses to the eighth of January, and a field that wrote as it was typed would file the job under
it.

**Nobody moves a job to "doing" by hand.** There was a *Start it* button and it went unpressed:
people commented on things and assigned them to each other while the list went on claiming
nothing had been touched. Doing something about a snag is the evidence it has started, so
`home.update_snag` and `home.add_comment` move it — server-side, so no client can forget.

The rule is narrower than "any update", deliberately. Only **assignee, due date, repeat and the
parts list** start a job; room, description, `thing_id`, `project_id` and photographs don't. Those
are the tail of capture — the sheet sets the first two seconds after the photo — and marking a
brand-new snag "doing" because somebody tagged it *Bathroom* would empty the status of meaning
from the other end. Finishing is the one state change still made by hand, because only a person
knows.

Two of the four are now unreachable from the UI: nothing sets an assignee, and priority is gone
entirely. So in practice a job starts when somebody puts a date on it or decides what to buy —
which is, if anything, a truer reading of "deciding to do the work" than the four ever were.

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

**Projects are on it too, and still nothing writes.** A renovation's `started_on`, `finished_on`
and `target_on` are drawn as a fifth kind — a read of dates set on the project's own page, so the
rule holds exactly: no cell is draggable, and every row is a door back to the project. Three
details are load-bearing. A project mark carries `snag: null` and a `project` instead, because a
project is not a snag and pretending otherwise gives the tab two ideas of what it is showing. It is
distinguished by **shape** — a square where everything else is a circle — because the palette has
four hues with one job each and a renovation is not a state; that is the same move hollow-vs-solid
already makes for a projection. And `target_on` is **never called "Due"**: nothing is due then, it
is a hope somebody typed, and "Due" is the one word this tab must not spend loosely. A met target
is dropped rather than drawn, since the row saying it finished is two lines up. The read is
`getAllProjects()` — no property filter, for the same reason `getSnags({})` has none — and it is
**not fatal**: a calendar that cannot draw the renovations is still a calendar.

`scheduleMarks`, `monthGrid`, `dayKey` and `marksOn` live in `packages/supabase-queries` with the
other pure helpers and are pinned by `schedule.test.ts`; `ScheduleScreen.test.tsx` pins the hollow
projection, the overdue hue, the unfiltered read and the paging rule. `looseEnds.test.ts` pins the
project marks — the two real dates, the target never reading as "Due", a met target dropped, and
that a caller passing no projects gets exactly what it got before.

## The list is the app's home

`SnagListScreen` is `initialRouteName`, and there are five tabs: List, House, Projects, Schedule
and You — **or four, if this person has put Projects away.** Projects sits beside House because
both describe the fabric of the place; Schedule stays last because it is the one you go to with a
question, where the others are where work is done. See *Projects can be put away* below.

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
- **A room can be folded away, and the heading stays.** That is the whole point — "three things in
  the Garage" is what the grouping exists to say, and a fold that took the heading with it would
  be a filter rather than a fold. A folded section keeps its heading and empties its `data`, so
  `SectionList` renders no rows. One control on the count's own line reaches every section, and it
  says what pressing it *does*, deciding from whether anything is still open, so the press on offer
  is never a no-op. It is on that line rather than a row of its own because this screen has already
  evicted two filter rails for charging vertical rent on every visit.

  **It reaches everything on screen, the trip sheet included**, and that is not a detail. It used
  to reach only the list's own sections — so with the parts lens up, where the shopping card *is*
  most of what is visible, pressing *Collapse all* folded the rooms behind the card and left the
  rooms in front of you exactly as they were. A control that looks like it did nothing is the one
  failure a control called "all" must not have. Expanding clears the trip sheet's folds outright
  rather than only the rooms currently listed, because a room whose items have all been bought
  drops out of the card and would otherwise come back shut the next time something was added to it.

  **It is `FoldAllPill`**, one component so that no surface folding rooms away invents a second
  control for it. (The House tab used it too, until each room there became a page of its own and
  there was nothing left to fold — see *A room is a page*.) It is a **pill** rather than a chevron beside a word: on a plaster ground an unbounded glyph and
  a line of muted text reads as a *caption*, something the screen is telling you, and this is
  something to press. The app's one chip shape says so — a sunken well, no border, the label
  inside it — and it stays sunken in both states, because it is a momentary action rather than a
  filter that is on or off and solid fern is reserved for the latter. The pill is ~34px inside a
  48px target, as every chip in this app is.

  **Two fold scopes, two keys** (`CollapseScope` in `lib/collapsed.ts`): the list's sections and
  the trip sheet's rooms. Separate deliberately — a room folded on the trip sheet is a statement
  about the shopping, not about the jobs, and one key would have each surface silently folding the
  other. Namespaced in the module rather than in each caller so the guards stay in one place: every
  read and write has to survive storage being absent, full or throwing, and that is not a thing to
  copy out twice. (There was a third, for the House tab's rooms; it went with the fold.)

  The fold is remembered **per device** (`lib/collapsed.ts`) and keyed **by section, never by
  index**: sections come and go as work is filed and finished, and an index would fold whatever
  slid into that position. Per device rather than per account because this is where you are in a
  list rather than a fact about the house — the other person folding the Garage away on their
  phone must not fold it away on yours. Every read and write is guarded and failure is always
  "everything is open": a list that will not render because it could not remember which room was
  folded is far worse than one that opens expanded.
- **Done leaves.** One line at the foot, not a lens. Finishing something should make the list
  shorter; that is the whole reward on offer. Only the last seven days are rendered. A repeating
  job cannot leave — see *Finishing says so* below.
- **Both filter rails became one button, and then the button went.** The *Show me* sheet was down
  to two lenses and three sorts: *Needs parts* was the cart again by another door, *Due* is
  answered by **Due soon** without asking, and *Newest* by **New** and **Just added**. The cart is
  the only lens control; it stays on screen while its lens is up even at nought, because it is the
  only way back to the jobs.
- **Due soon sits under New and above every room** — overdue, or due in the next seven days,
  soonest first. There are no notifications, so this screen is the only reminder; grouped by room,
  the gutters due on Saturday sat in Outside with everything else. A parked repeat is left out and
  comes back up on its own the day it falls due.
- **A job can be finished from its card.** A tick beside each open card calls `set_snag_status`
  — a sibling of the card's own `Pressable`, never inside it — and the toast offers **Undo**. It
  was open, scroll past every card, *Mark done*, *Return to list*. A repeat that rolls forward gets
  the honest toast and no Undo.
- **The shopping list rides the "Needs parts" lens**, and a pill in the header says how much of it
  there is. One card above the cards, listing every item the visible jobs are waiting on — the only
  elevated surface on the screen, and the only thing the retired Weekend tab left behind. See
  *A list you can tick* below for the pill and the ticking.

  **The cart names the view it goes to.** A cart carrying a number says there is shopping to do; it
  does not say that pressing it swaps what the screen is showing, and a control whose whole job is
  to change the view has to name the view it changes to. So a caption sits under it reading **View
  shopping list**, and **View jobs list** once the trip sheet is up — by then the question has
  turned round.

  **Both header buttons come from one style, and the count rides the corner.** They were a 48px
  square beside a lozenge half as wide again, offset vertically because the caption made the cart
  column taller than the filter and the row centred them — two controls doing the same kind of job
  reading as two different kinds of control. So `iconBtn` is the one shape, the two sit in a group
  of their own with `alignItems: 'flex-start'` so they share a **top edge** while the cluster stays
  centred against the title, and the count moved out of the cart into a badge, because it is a
  number *about* the button rather than part of it. No new hue on the badge: fern while the button
  is a sunken well, inverted to fern-on-white once the button itself has gone fern.

`SnagListScreen.test.tsx` pins the New rule, the first-run case, the room ordering, the done
window, and the whole of the fold — the heading and its count surviving, only the folded section
emptying, the all-control saying what it will do, and the fold coming back on the next mount.
`ComposeBar.test.tsx` pins the text-only path, the words coming back on failure, the keyboard
lift, the field naming what the bar does, and no label on the camera button. `AmendSnagSheet.test.tsx` pins
which question a new snag is asked first, that it asks two things and never four, that it never
asks what the job is about or how urgent it is, that no step explains itself, the room picker's
substring match and its worded miss, and that finishing the sheet opens the job.
`houseRecord.test.ts` pins `thingsInArea` itself: one room only, `Whole house` for a snag with no
room, and the order being the order of the words.

### A filed job can be edited, and the room it is in can be searched for

Two things were answerable for ten seconds after the shutter and never again: **the words and the
room**. The amend sheet asks both straight after the photo and then it is gone, so "Gutters" typed a
fortnight ago stayed "Gutters" — and a snag filed in the wrong room stayed there. A pencil on the
headline opens `EditSnagSheet`: the description, a searchable room picker, and **one Save**.

**The room rail became a picker, in both places a room is chosen.** Every room is still offered
and never a shortlist — the one you want is the one you're standing in, as likely the Roof as the
Kitchen — but a rail of chips makes that claim in a way that stops scaling the moment a household
adds a conservatory and a storage area under the house to the seeded twelve, and a wall of grey
has to be *read* before it can be tapped. `RoomPicker` is one component used by the capture sheet
and this one, so the two cannot behave differently. `matchRooms` is `matchSuggestions`' substring
rule applied to the room vocabulary: "house" finds *Under the house*, which a prefix match answers
with silence. A miss says which rooms there are and where rooms are added, rather than offering to
make one — somebody filing a snag in ten seconds is not describing the place, and a half-made room
is a worse outcome than a snag filed under Elsewhere. Tapping the chosen room again clears it;
there is deliberately no separate "no room" row, because `Elsewhere` is already the seed's escape
hatch and a second way to say *nowhere in particular* is two answers to one question.

One Save rather than the write-on-press every other control here uses, and the reason is the
distinction the thing page's spec sheet already draws. Parts, the due date and the repeat are each
one small decision that is its own confirmation. The words and the room are the
job's *description* rather than a decision about it, typed and chosen together — and a half-typed
sentence saving itself on every keystroke is not an edit, it is a race. **Neither field starts the
job**, which is the existing rule and the reason editing is safe: `update_snag` moves a snag to
'doing' on assignee, due date, repeat or parts, and never on room or description. The sheet also
refuses to leave a photo-less snag with no words, in those words, rather than letting
`snags_has_something` surface as a constraint name.

**Linked assets is what the job is about — many of them, chosen behind a picker.**

It began as a list *to read*: the room's whole record printed inline, replacing two controls that
wrote (*Part of a bigger job* and *Say what it's about*). That fixed the right problem and created
another. Nine appliances rendered on the page read as **nine things already attached to this
snag**, when they were really the inventory answering a question nobody had asked — and they cost
a screen of vertical rent on a page people open constantly. **A list of what is *selected* belongs
on the page; a list of what *could be* belongs behind a control.**

So the card shows only what is linked, with a counter, and the record moved into
`LinkAssetsSheet`. And it is **many now rather than one**: a leak under the sink is about the
mixer *and* the waste trap, and a kitchen job is very often about two appliances side by side.
`home.snag_things` holds that (`20260920100000`), with `snags.thing_id`'s rows backfilled into it.

- **A join table, not a second column.** Two writers of one fact is the failure this schema keeps
  naming, and a `thing_id` kept in step with the first row of a set is exactly that. The old column
  is left unread on the same terms as `priority`: `thing_name`/`make`/`model` still read from it
  for the extract's *About* column, and deleting it would rewrite what somebody said.
- **`set_snag_things` replaces the whole set in one call.** A picker with checkboxes and a Done
  button is answering one question, and two RPCs would let a half-finished answer reach the row. It
  refuses things recorded at another place — the read policy would hide half of what was just
  written — and it **touches neither `status` nor `updated_at`**, because saying what a job is
  about is the tail of capture. It is its own function so nobody can smuggle the link in beside
  eight other fields, the argument `set_part_bought` and `set_quote_status` are separate for.
- **The card draws itself from the row.** `snags_with_details.linked_things` carries id, name,
  room, make, model and kind, so the page needs no second read and cannot drift from what the
  database holds. Deliberately not whole `Thing` rows: a job carrying a spec sheet per link pays
  for it on every open.
- **Cascade, unlike `snags.thing_id`.** That column is `on delete set null` because what was wrong
  with the old dishwasher is still what was wrong — the *job* outlives its subject. A row in the
  join table is not a job, it is the statement that two things are related, and that statement
  outliving one of them is worth nothing.

The picker itself: **checkboxes rather than chevrons**, because the row's job there is to be
chosen and a chevron promises navigation; **nothing written until Done**; **opens filtered to the
job's room** and says so, with *Everywhere* as the way out, since houses are not laid out the way
a catalogue thinks; and a **search that reaches the whole house past that filter**, because
somebody typing a model number has named the thing precisely and answering "not in the Kitchen"
would be the filter overruling the better signal. `assetPickerOrder` puts what is already linked
first, then the room, then the rest — alphabetical inside each band, because a card is read rather
than ranked.

**A ghost still cannot appear, and that is the type rather than a filter.** The sheet takes
`Thing[]`; a suggestion is a `RoomSuggestion` with no id, so a dashed prompt for a rangehood nobody
has recorded can never be checked.

**A row is stacked — the noun, then the model beneath it**, with the room as a muted chip and the
× as a sibling of the door rather than a child of it. It was one line with the name flexed and the
mono spec beside it, which meant the spec took its intrinsic width and the name shrank to whatever
was left: *Microwave* rendered as **M** next to `Samsung MS32J5133B/MS40J5133B`. That is a
two-column row having nowhere to put a long answer — the same failure the thing page's spec sheet
and a project's totals both fixed by un-columning themselves. Neither line can be the one that
gives way: the noun is how you find the row and the model is what you came to read.

**And the asset's own history is pulled through.** A card under Notes — *Also said about the heat
pump* — carries the comments from that asset's **other** jobs, each naming the snag it came from and
tapping through to it (`getThingNotes`). The heat pump has been serviced twice and had a fault
once; what somebody wrote last time is the most useful paragraph in the app when it plays up again,
and it was buried in a job nobody would think to open. Three rules: it sits **under** this job's
notes, because what the other person wrote *here* is still why the screen was opened; **this job's
own comments are excluded by id**, or they would read as duplicates rather than as history; and a
read that fails is **not fatal**, because history nobody can fetch must not take the page down.

RLS does the filtering rather than the query pretending to: the comments policy asks each snag's
property, so this returns exactly what this person could have read by opening those jobs one at a
time.

**The date and the repeat are one *When* card, and setting up a repeat is one tap.** It was a
due-date card, then a *Schedule a recurring job* card holding only Yes and No, then a modal behind
the Yes asking how often and — again — *"When's the next one due?"* with its own date presets. Two
sets of controls writing one `due_at` had people asking which date was real, and *Yes* opened the
modal without writing anything, so dismissing it left *No* lit. Now: the `DateField` with **This
weekend** and **Next week** a tap away, then a **Repeats** row — *Never* and the `REPEAT_PRESETS`
as chips that write when pressed, plus the job's own cycle when it is not a preset (a heat pump's
730 days from the thing page must not read as *Never*). Choosing a cycle dates an undated job a
cycle out; a date already set is left alone. One sentence under it says what marking it done does
and that it comes up under **Due soon** on the list — *Snag doesn't send reminders* is still said,
because a repeat is exactly what somebody expects to be reminded about.

**The box shows the day it is due.** It was `formatLooseDate`, which is built for date columns and
reads a timestamp's day as nothing, so a job due on the 8th showed back as *Nov 2026*. `dueText`
is `formatDayFirst(dayKey(due_at))` — the local day, round-tripping with what was typed.

`SnagDetailScreen.test.tsx` pins the edit sheet writing both fields in one call, the refusal on a
photo-less job with no words, the linked-assets list offering this room only and writing nothing,
its absence when the room is empty, the page surviving a failed record read, the history card and
its exclusion, the due date's day-first parse and its refusal of `31/02/2026`, the When card —
one-tap repeat, a date left alone, a cycle the presets lack, the quick dates, the day shown back —
and leaving: no Save or Close, nothing written when nothing is typed, one write for both boxes on
`beforeRemove`, staying put on a failure or a date no calendar has, the boxes committed before
*Mark done*, and a calendar pick committing at once.

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
- **The trip sheet groups by room, and the room is a heading.** It was a flat run with the room
  repeated down the right-hand edge, which says "Outside" nine times over where one word would do
  and groups nothing. Batching is the whole argument for the list grouping by room in the first
  place — you do the garage once — and a trip to the shop is the same shape: the tomatoes and the
  basil are one stop. Seeded `locations` order, like everywhere else, so the trip sheet and the
  rooms below it cannot disagree about how the house is arranged; a room the vocabulary no longer
  holds sorts after the seeded ones rather than jumping to the top, because `snags.room` is TEXT
  precisely so history survives a tag being removed. Each room folds, keeping its heading and a
  count of **what is left to get** rather than what was ever listed — the card's existing rule.

  **The card claims nothing about the trip.** It carried a line reading *"One trip clears 5 jobs"*,
  which is a promise about the world rather than a fact about the list: five jobs across a hardware
  shop, a garden centre and a paint counter are three trips, and a card that tells somebody
  otherwise is a card they stop believing — the same argument that keeps the pill from asking for
  what was bought on Saturday. The heading and the counts say everything true that line was
  reaching for.
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

**The tab is a grid of rooms, and a room is a page** (`HouseRoomScreen`) — see *A room is a
page* below.

**The tab arrives furnished.** Every room holds greyed, dashed entries for what a house of this
kind probably has — a rangehood in the kitchen, a dryer in the laundry — until somebody records
the real one. A room with nothing recorded still has a tile, reading *Not recorded yet ·
Oven, Cooktop, …*, and its page is that list. This is the answer to the thing that kills every
inventory product: an empty record answers nothing, and a tab that answers nothing on the day it
ships never gets opened again.

**The rule the whole arrangement rests on, and the easiest one to erode: a ghost is not a row.**
It comes from `ROOM_SUGGESTIONS`, a constant in `shared-types`; it never reaches `home.things`,
never appears in a search result, and can never be pointed at by a snag. A record full of entries
nobody has confirmed *looks* full and answers nothing, and that is worse than an empty one — you
believe it, check it in the shop, and find nothing there. **If the ghost/real distinction ever
blurs, the furniture goes rather than the distinction.** Three places it would blur first, all
pinned by `HouseScreen.test.tsx`: the header count says "recorded" and counts only real things, a
search returns real things only, and a tile naming suggestions says *Not recorded yet* before it
names them.

Three consequences:

- **Progress is per room, never a percentage.** "Kitchen · 2 of 8" — on the tile, "2 of 8" under
  the name — is a unit of work somebody can finish on a Saturday. A global completeness meter is the shaming number that gets an app closed
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
  this tab and the List tab cannot drift apart about how the house is organised. Grouping by kind
  *inside* a room's page is a heading, not a second layout, and there is no control for it.

### A room is a page

The tab was one long list — every room's records and suggestions inline, a dozen rooms running to
two thousand pixels, and a fold control to manage it. **It is a 2-column grid of rooms now** (the
layout was chosen from a preview, over grouped rows), and each tile opens that room on
`HouseRoomScreen`. The search field stays on top of the grid, and a search is still one flat
answer across every room.

- **A tile says three things**: the name, the count, and what is in the room by headline
  (`houseRooms`, `describeHouseRoom`). The count is `2 of 8` while anything is still suggested and
  a bare total after, and it goes muted while nothing is recorded, because then the line under it
  is suggestions — and says so first, in words. Seeded order, a room the vocabulary lost after
  the seeded ones, Whole house last; a room with nothing recorded and nothing to suggest gets no
  tile, as `Elsewhere` and `Under the house` never did.
- **Two to a row, as pairs rather than a wrapped flex line.** React Native cannot express a
  percentage width with a gap, and a lone last tile must stay half width rather than stretching
  into a banner. White on plaster, `Radius.card`, no outline and no shadow — a tile is a V2 group
  of one row.
- **The page is a push, not a sheet**, like `ProjectDetail`. A thing on it opens `ThingDetail`,
  which is a modal screen, and a room drawn as an RN `Modal` sheet would sit *above* it — the spec
  sheet would open underneath. Pushed, the thing opens over the room and back lands in the room.
  `HouseRoom: { room: string | null }`, with null for Whole house; not in `linking.ts`, on the same
  terms as `ThingDetail`, because a room is not something anybody sends.
- **Grouped by kind only when there is more than one kind** (`thingKindGroups`): *Appliances*,
  *Paint and finishes* (a tile goes with paint, for paint's reason) and *Other* for the three
  unbuilt kinds, drawn only if a row of one exists. A hallway with one paint is just the paint.
  That is the Projects tab's implicit-layer rule — a middle layer appears only when it earns its
  place — and a heading over the only group there is, is a heading pretending to be a category.
- **Not recorded yet is its own section, under the records and open.** Not a drawer that starts
  shut: a closed drawer is the furniture taken away, and on a page of one room the scroll it
  would save is short. Under a heading of its own a ghost cannot be read as one of the rows above
  it, which is the distinction made *more* visible rather than less. The ghost card itself lost
  its *Not recorded yet* line for the same reason: under that heading it was the heading repeated.
- **Recorded things are rows in a white `Group`**, 17pt with the mono answer at 15pt under it and a
  chevron, where they were separate shadowed cards — the V2 grouped list, like every other list of
  things to open in this app. A ghost stays a dashed, transparent card outside any group.
- **The + is in the page's header**, opening the walkthrough on step two with the room chosen;
  the FAB on the grid opens it on step one. Both screens share `useAddThing`, so recording a thing
  is one write path wherever the + was.

`HouseRoomScreen.test.tsx` pins the kind headings appearing only at two kinds, a tile under *Paint
and finishes*, the suggestions under their own heading after the records, a dismissal that is
final and put back on a refusal, the + and a tapped ghost opening the walkthrough where they
should, Whole house never furnished, and only this room's covers being signed.

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

**A room added on the House tab is a room everywhere.** The *Add a room* row under the grid and
the *Add a room…* chip on step one of the walkthrough both call `home.create_location`
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

### A + on every room, and a picker that admits houses differ

Every room's page carries a **+ in its header**. (It was a subtle, muted + at the end of each room
heading, when the rooms were headings in one long list.) It opens the walkthrough on **step
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

### The photographed label is read, and nothing it says is saved unseen

Step three has always photographed the rating plate "because it carries the make, model and serial
at once" — and then asked somebody to type all three off the photo they had just taken.
`supabase/functions/read-label` reads it, and the walkthrough lays the answer into the boxes.

**This is the one place the app calls a model, and it is a deliberate exception** to the rule the
assessment loop states (*no key, no queue, no edge function*). That rule is about *judgement* — an
assessment is advice nobody can check at the moment it arrives, so it stays outside the app and
comes back by hand. A label is the opposite case: a transcription of something the person is
holding, which they check against the object in front of them before anything is written. Four
rules keep it that way, and they are the whole feature:

- **It writes nothing to the record.** The function returns text (it counts the read, below). The walkthrough still writes only on its last
  step through `create_thing`, so a reading nobody confirmed cannot reach the record — the same
  guarantee the ghost design and the handover's confirm step exist for.
- **It fills only the boxes still empty** (`applyLabelReading`), and says which ones in words
  (*Read from the photo: make, model, serial*). Somebody who typed the model before photographing
  the plate has already answered, and a reading that overwrote them would be the app deciding a
  photograph knows better than the person holding the appliance. It also makes a late answer safe:
  the read is never awaited, and whatever was typed while it was out is kept.
- **It transcribes into boxes, and suggests only as offers.** An ambiguous character is null,
  never a best guess — a plausible wrong model number is worse than none in a shop. Every box it
  fills was printed on the thing in somebody's hand, where they can check it. `hex` is the one
  box it fills that was not printed, and it is **the maker's published value or nothing**: the
  model gives it only when the brand and the colour named on the tin identify a colour on that
  maker's chart, never judges it from the photo (a white under a kitchen bulb photographs grey),
  and `applyLabelReading` refuses one that arrives without a colour name or code to be the value
  *of*. A paint with no swatch is honest; a swatch that is somebody's guess at a colour is the one
  part of a paint record people believe at a glance. A serial, which the
  walkthrough never asks for, appears in a box of its own when read, so it is checked rather than
  saved unseen.

  **What it takes is the exception, and it is fenced rather than forbidden.** It used to come
  "off the label or not at all", which in practice meant never: a heat pump's plate does not print
  its filter code, so the step asking *Anything you re-buy for it?* came back empty on every real
  appliance — and it was asked for. So the model also returns `suggestedConsumables` and
  `suggestedServiceMonths`, **from what it knows about that make and model**, and they arrive as
  offers on step four under *Suggested for this model · check before you buy*: a row with a + per
  part, tapped to take, and a line saying the usual service cycle. **`applyLabelReading` never lays
  one into a box, even an empty box**, and no cycle is chosen for anybody. That is the distinction
  the unsourced-tradesman rule actually protects — a guess must not look like something read —
  and a heading naming it a suggestion plus a tap to accept it keeps that true. The instruction
  asks for a part code only when the model is confident of it, and the item in plain words
  otherwise; "Air filter" with no code still tells somebody what to ask for.
- **A brand is written the way the brand writes itself.** Rating plates shout, and "MITSUBISHI
  ELECTRIC" in the record reads as a label rather than a name. The model is asked for the brand's
  own casing; `brandCase` is the fallback when it copies the capitals anyway — it touches only a
  make with no lower-case letter at all (so *iRobot* and *De'Longhi* are left as given) and keeps a
  word of three characters or fewer in capitals (LG, AEG, 3M). The model and serial keep the
  label's capitals, because those are read back character by character.
- **It reads the photo as the caller.** The client sends a storage path, never bytes, and the
  function downloads with the caller's token — so the `home-photos` policies decide what can be
  read, exactly as everywhere else, and `docs/` paths are refused outright.

A failure is **a sentence under the boxes, never an alert** — the step is still on screen and
typing is what they would have done anyway. A missing key says *Label reading isn't set up yet*
rather than reading as an unreadable photo. It has its own deadline (`LABEL_TIMEOUT_MS`, 45s): a
model looking at a photograph takes seconds even when it works, and 20s would word a slow answer as
a dead connection. The function gives the model 40s, so it answers in words before the app gives
up. `connect-src` already covers `*.supabase.co`, so the CSP did not change.

**The model is Gemini, over plain REST, and the app does not know that.** `gemini.ts` holds the
request (the photo inline, the instructions, `responseJsonSchema` fixing the shape) and
`readingFromGemini`, which tells apart the four ways a reply is not a reading — blocked, empty, cut
off at `MAX_TOKENS`, not JSON — and never reads a thought part as the answer. It is pure, with no
Deno and no imports, so jest tests it directly. No SDK: one POST is not worth a dependency to keep
current inside an edge function. Swapping models means changing that file and nothing in the app.

**A busy model is asked once more, on a different model.** The first two live reads both came back
`503 "This model is currently experiencing high demand"` from `gemini-3.8-flash`, with the key, the
photo and the count all fine — and the function gave up on the first refusal. Now a 503, 500 or
429 (`isBusy`) moves on after a one-second pause to `FALLBACK_MODEL` (`gemini-3.6-flash`;
`GEMINI_FALLBACK_MODEL` overrides) and then to `LAST_RESORT_MODEL` (`gemini-3.5-flash-lite`):
demand is per model, and the next read after that fix saw *both* Flash models answer 503 in turn.
Google's 503 is capacity, not quota — paid projects get it too, so upgrading a plan does not clear
it — and its own advice is a pause and a less contended model. Flash-Lite is last because a
transcription needs less model than anything else here, not because it is preferred. Anything else
— a bad key, a malformed request — would fail the same way on every model and is not retried. Every
attempt but the last is capped at 15s so a hang cannot spend the whole 40s budget, one claimed read
covers every attempt, and when both are busy the sentence says *busy, try again in a minute* rather than
implying the photo was the problem.

**A household gets fifty reads a day** (`home.claim_label_read`, `20260923110000`). The key is the
operator's, and nothing but a session stood between it and a loop. Per household rather than per
person, so a second account is not a way round it; claimed *before* the model is called and never
refunded, because a read that failed at the model still cost a request and a refund is a second
write that can itself fail. It returns false rather than raising, so *used up for today* and *not
your household* stay two different sentences. `label_reads` has RLS on and no policies — nothing
browses it.

**Setup lives outside git**, and the order matters: apply the migrations, set `GEMINI_API_KEY`
(and optionally `GEMINI_MODEL`) as function secrets, `supabase functions deploy read-label` with JWT
verification left on, try one real plate, then merge. **Use a paid-tier key**: on Google's free
tier submitted content may be used to improve their products, and these are photographs of the
inside of people's houses. Until the key is set the feature says it is not set up and everything
else works.

`label.test.ts` pins `swatchColour`, `consumableOnList`, the defensive parse, `brandCase`, the
suggestions kept apart from what was read, and the fill-only-empty rule — including that a
suggestion never fills a box; `readLabelGemini.test.ts` pins the request's shape and every refusal in
`readingFromGemini`; `AddThingSheet.test.tsx` pins the boxes filled and named, a typed box
surviving a late reading, the failure sentence, a paint's tin reaching `create_thing` as code,
sheen and swatch, and the suggestions — offered not entered, gone once tapped, carried into the
write beside what was typed, and the suggested cycle never chosen.

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
  **every field the kind can answer is on screen, empty or not.** A paint still gets no Serial
  box: "every field" means every field the kind can answer.

  **It writes each box when the box is left, and says *Saved*.** It had one Save button for a
  while, and a back gesture over typed words asked *Leave without saving?* — a question with a
  wrong answer that loses the words, on the one page in the app where every other kind of edit
  (a tap, a photo, the room) already wrote on its own. What the reversal was really fixing was the
  silence, and the toast fixes that. So a box commits on blur, **only what changed** is sent, an
  emptied box clears its column, anything still being typed is written on `beforeRemove`, and a
  date no calendar has holds the page. `draftRef` beside the state, because the calendar fills a
  box and blurs it in one gesture before React has re-rendered.
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
- **Paperwork lives beside the photos, and so does the way to add either.** The section is
  **Photos and paperwork**, and one row carries all three offers: **Take photo**, **Choose
  photos** and *Attach a PDF*. **Two photo controls, and that is a reversal.** It was one, on the
  belief that `<input type="file" accept="image/*">` is answered by the phone's own sheet with
  *Take Photo* above the library. iOS Safari does; **Android Chrome drops the camera from that
  sheet whenever `multiple` is set**, and the native build was the library only — so photographing
  the thing in front of you meant leaving the app. `addPhotos(prefix, save, 'camera' | 'library')`
  is the one path for both, and the job page's strip, `Attachments` and this page all offer both.
  **The library takes several at once**, capped at
  `PHOTO_PICK_LIMIT` — five is a plausible number of angles on one appliance, and the cap exists
  because each photograph is decoded, resized and re-encoded before it is sent, so *select all* on
  a camera roll would otherwise be minutes of spinner with no way back. Three rules in the upload:
  **one write at the end** (eight photographs must not be eight round trips, eight re-reads and
  eight stacked toasts), **one after another rather than in parallel** (repeated compression is the
  most memory-hungry thing this app does, and eight simultaneous uploads is how the request
  deadlines start firing), and **what arrived is kept** — six uploaded with two refused is six
  added and a sentence about the two, the same rule the PDF export follows for a photograph that
  will not come. Anything past the cap is said out loud, because a cap nobody is told about is
  indistinguishable from photographs that failed. The camera used to sit under the strip at the
  top, five hundred pixels
  above the PDF button — so somebody wanting a second photograph of the dishwasher went looking in
  the section that attaches things and found only a PDF, which reads as a record that does not take
  photographs at all. The strip itself stays at the top, because a rating plate is what this page is
  opened to *read*: the answer goes above the form and the controls that grow it live with the rest
  of the attaching. The plate photo at creation is the walkthrough's step three and has not moved;
  these are for the extras that come later. `things.document_paths` holds PDFs in the
  **`home-photos`** bucket under `<household_id>/docs/`, reusing the four storage policies and
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

  **A paint swatch is not an exception to that**, and the distinction is worth holding: the palette
  is what the *app* spends colour on, and a swatch is the record's own data — the same as the
  photograph of the tin beside it. `spec.hex` holds it (jsonb, so no migration), typed on the thing
  page or supplied with the label reading as the maker's **published** value for the colour the
  tin names (below) — never a colour judged from a photograph. `swatchColour` draws it only when it parses as three or six hex
  digits, and draws **nothing** otherwise rather than a guess, because a swatch is the one part of a
  paint record somebody believes at a glance without reading the code beside it; a box holding
  something else says *Six hex digits draw a swatch*. It carries a hairline edge because most paint
  is a white. It is always approximate — no screen shows paint true — so it sits **beside** the
  colour code and never replaces it: the code and the tint formula are what the counter matches.

### Five kinds, two built

`home.thing_kind` is `appliance | finish | tile | fitting | fabric | contact`. `THING_KINDS` is
the three that are offered: appliances, paint and tiles.

**A tile takes paint's shape, not an appliance's**, and for paint's reason: a bathroom holds one
tile on the floor and another on the walls, the colour is what somebody came to read, and the
only thing telling the two apart is where each went. So `THING_KIND_FIELD_LABELS` gives it
*Range* / *Colour or code* / *Where it went*, and the note renders on the card as a finish's
does. It arrived with the projects work, because a renovation's most durable answer is which tile
went on the bathroom floor.

**`alter type ... add value` must be alone in its migration.** Postgres will not let a new enum
value be used in the same transaction that added it, and a migration runs in one — so
`20260918092000` adds `tile` and does nothing else. A file that both adds a value and refers to
it fails whole.

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
  with the old dishwasher is still what was wrong. **Capture and triage no longer set it**: the
  capture step that wrote it and the picker on the job's page have both gone, and *Linked assets*
  answers the question they existed for without asking anything (see above). Rows linked before
  that keep their link, and everything that *reads* it still works — the *Also said about…*
  history card, the extract's *About* column, `thing_name`/`thing_make`/`thing_model` on
  `snags_with_details`. The column and the join stay because the data is real and because the
  cheap place to ask is capture, with the room already chosen, if it is ever wanted back.

  **The thing page does still set it**, through three doors — *Report a problem*, *Schedule
  service* and the cart beside a consumable — and since `20260920100000` that meant a job filed from the
  heat pump's own page arrived with *Linked assets* empty and did not count towards "on the list",
  because both read `home.snag_things`. `20260923100000` is an **insert-only** trigger that puts
  the link in the join table as the job is created. It keeps nothing in step afterwards, which is
  what keeps it from being the second writer `20260920100000` warns about: from then on
  `set_snag_things` is the only way the set changes. It deliberately does **not** backfill — a job
  whose link somebody removed in the picker looks identical to one that never got it, and
  re-adding it would contradict them.
- **Pointing a snag at a thing would NOT start the job.** Saying what something is about is the
  tail of capture, the same gesture as tagging the room. Assignee, due date, repeat and parts
  start it; `thing_id` doesn't, and the `v_started` expression in `update_snag` still says so.
- **Nothing copies a thing's consumables onto a snag's parts list on its own.** Filling the parts
  list is what moves a snag to 'doing', so a job that started itself because somebody named the
  appliance would empty the status from the same end the *Start it* button did.

  **A person can, in one tap: the cart beside each consumable.** The shopping list is not a list
  of its own — it is every open job's `parts` — and that is kept: a thing to buy with no job to use
  it on is how a list fills with cartridges nobody fits. So the cart files a small job about the
  thing (*Water filter — RFC-24*), linked to it, and gives it the part through `update_snag`. **That
  starts the job, and that is right**: deciding to buy the filter is deciding to change it, which
  is the rule the triage page's own `+` already follows. What would be wrong is the page doing it
  unasked.

  **It asks before it files.** `consumableOnList` looks for an open job about this thing still
  waiting on that item — a second tap, or the other phone an hour ago — and answers *already on
  the shopping list* instead of a second row on the trip sheet. A **bought** one does not count,
  because pressing the cart again after the trip means another. The read is one request and never
  fatal: if it fails the cart files anyway, since a duplicate costs a tap and a missing filter a
  trip. Two writes (create, then parts), and if only the second fails the alert says the job
  landed without its part rather than claiming either outcome. `ThingDetailScreen.test.tsx` pins
  all four.
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

  **One service job per thing, and the page edits it rather than filing another.** Every press of
  *Schedule service* used to `createSnag`, so changing a heat pump from six months to a year left
  the six-monthly job running beside the new one, and *Stop servicing it* cleared only the thing's
  column while the job went on coming round. `serviceJobFor` finds the open repeating job about the
  thing (by `thing_id` or `snag_things`), read once when the page opens and never fatally. When it
  exists the modal says *Next one due* and *Update the service job*, writes through `update_snag`,
  and — because a date or a repeat is one of the things that start a job — puts an `open` job back
  to `open` with `set_snag_status` if the update moved it to `doing`. *Stop servicing it* clears the
  repeat and **finishes** the job rather than deleting it: its notes are the appliance's history.
  The *Servicing* line reads the cycle and next date off that job, so the page and the list cannot
  disagree.

  **The walkthrough's cycle files the same job.** Step four asked *Serviced how often?*, stored it,
  and put nothing on the list — the failure this bullet opens with, one screen over. `fileServiceJob`
  (`lib/serviceJob.ts`) creates it, dated a cycle out, after `create_thing` on the House tab and in
  the project handover; a job that cannot be filed is said, never thrown. The chips are
  `SERVICE_CYCLES` — the walkthrough had a third, local list of three.

- **Report a problem goes through the capture bar.** The thing page's *Add something about this*
  created a job the moment it was pressed, described as *"Heat pump — "*, and opened it — so a press
  walked away from left a half-written job on everybody's list. It opens `ComposeBar` in a sheet
  now (`embedded`), and nothing exists until it is sent; the job arrives about the thing and in its
  room.

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

`HouseScreen.test.tsx` pins the furnished day-one grid, the per-room counts, the *Not recorded
yet* words before any suggestion a tile names, Whole house last and unfurnished, a tile opening
its room (null for Whole house), a search answering flat with no ghosts and no tiles in it, a
dismissed suggestion leaving the count, and the absence of any grouping or fold control.
`houseRecord.test.ts` pins `houseRooms`, `describeHouseRoom` and `thingKindGroups`. `houseRecord.test.ts` pins the catalogue being deduplicated, reaching across
rooms and carrying only describable kinds, the substring matcher (including "wash" finding the
dishwasher, which is right rather than a near miss) and the miss that puts *Add it yourself* on
screen. It also pins the consumables search (the
`GU10` case), the headline rules, `describeCycle`, the loose dates, and `ghostsForRoom` — including
the case where a thing filed as "Bosch dishwasher" counts as having answered the Dishwasher
prompt, and the paint rules above: one general prompt per room, answered by any finish in it and
by nothing in another room, with the colour leading and the code searchable.

## Projects: what we're *changing*

`ProjectsScreen` is the **Projects** tab, and `home.projects` is the table behind it. The third
noun. The list holds what is wrong with the house; the House tab holds what is in it; neither could
hold a renovation — a body of work with a budget, a span of rooms, a folder of quotes, and an
answer to "what did the bathroom actually cost".

### V2: the page somebody who has never run a renovation can read

The money model underneath this section is unchanged and still right. **The page on top of it was
rebuilt in September 2026** after five renovations — a $6k ensuite up to a $420k whole-house job
with an extension — were entered through the old screens by somebody holding the paperwork, and
every one of them came out wrong. Several subsections below describe screens that no longer
exist; where they conflict with this one, this one wins. `supabase/tests/project_scenarios.sql`
replays the five and asserts the figures.

**The reader is somebody who has never done this before.** They do not know *committed*, *PC sum*,
*progress claim* or *basis*; they know the paper in their hand — a quote, a bill, a receipt — and
they are doing two things in the same evening: **deciding** (three toilets, three kitchen designs)
and **paying** (a builder's bill arrived). So the page answers four questions, in the order they
are asked:

1. **Are we on budget?** *Expected total* in large type, with **Agreed** and **Undecided** as the
   rows under it — they add up to it, on screen — then *Budget remaining* (or *Over budget*, in
   words and clay; brass within 15% — the list card's figure and colours), then *Budget*. Two tiles: **Paid** and **To pay**. Committed, Invoiced, Quoted and
   Forecast are no longer words on the page; they are the accounting, and nobody asked it.
2. **What's left to decide?** Every thing not yet chosen, with its option count and price range.
3. **What do we have to pay?** Every bill still owing, with a **Paid** pill on the row — and,
   under it, what is earmarked and not billed yet (*Expected to pay*, below).
4. **Where is it going?** One row per room plus *Whole job*, the rows summing to the total.

`projectSummary` (`packages/supabase-queries/src/summary.ts`) is that arithmetic, pure and pinned
by `projectSummary.test.ts`:

- **Agreed** = committed − the builder's *open* set-aside amounts. An allowance nobody has chosen
  against is not something the household has agreed to spend.
- **Undecided** = each open set-aside in full; what is left of one partly chosen against while
  other things on it are still open; each undecided thing with no set-aside **at its dearest
  option** (so the total never surprises upwards); unpriced expected costs; additional ballparks.
  The user chose "dearest", not "cheapest", and chose to show it as its own row rather than hide it
  inside the total.
- **An open quote for the whole job or a room counts in Undecided too**, at the dearest
  (`openScopeQuotes`), but only where nothing at that level is agreed or billed yet. A planned job
  whose one price was a tree surgeon's unagreed quote read $0 and had no row to find it under; the
  quote was neither agreed nor a thing. Once something there is agreed or billed, an open quote
  could be a variation or an alternative and the app cannot tell which, so it is listed, not
  counted. The *Whole job* row appears whenever such a quote exists, saying *N quotes not agreed*.
- **Paperwork on a price, a part or a payment is listed on the page**, grouped by supplier under
  *Documents* — a quote's PDF was on the record and on no screen but the quote's. See *The list
  card, status, suppliers and files* below.
- The list card shows **Budgeted, Quoted and Paid**, and **Budget remaining** once something is
  paid. It used to lead with Agreed, which households did not read; see the section below.

**Every line of small text is a fact the reader can add up** — a count, a date, a supplier, a
figure compared with another figure on the screen ("$1,400 over the $8,000 set aside"). The
paragraphs of explanation that sat under sections are gone, and the rule for new ones is that a
sentence the app cannot check does not ship.

**One way in for money** — the + in the header, `MoneySheet`, which asks *what have you got?*:

- **A quote for a thing** is an **option** on it. It is never asked whether it was agreed;
  comparing is the point. *Choose* on the thing's own sheet (`ThingSheet`) decides it.
- **A quote for the job or a room** asks *Have you agreed to go ahead?* with **no answer chosen**.
  The old walkthrough defaulted to *Signed*, and a quote somebody was only comparing went straight
  into Committed.
- **An agreed quote** then asks *Does it set money aside for things you'll choose?* Each answer is
  an allowance line **and a thing in its room linked to that line** (`project_items.set_aside_line_id`).
- **A bill from a supplier with an agreed price** asks *Is this part of an agreed price?* —
  listing every one they have, with what is billed so far and what is left after this one. The old
  walkthrough stopped offering the claim once a supplier had two signed prices, so the progress
  bill after a variation went in as extra.
- **A receipt** is a bill and its payment in one step. **A cost we're expecting** needs no supplier.

**Choosing settles the set-aside, and that is the fix for the allowance rules never running.**
Every rule in *A builder's number is not one number* was right and unreachable: nothing on any
screen could set `supersedes_line_id` or `billed_through_id`, so an allowance and the thing that
replaced it both counted ($12,000 over, on the scenario bathroom). Choosing an option for a thing
that has a set-aside asks one question — **who will bill you for it?** — and `chooseOption` writes
both links, then accepts. Several things may share one set-aside (a toilet, a vanity, a mixer are
all "bathroom hardware"); what is left of it stays Undecided until the last is chosen, and then the
room says the saving or the overrun in dollars.

**Several options per thing, again.** *One price, and a header that says where it's up to* below
moved an item to one active price. That was right for recording a bill and wrong for choosing a
toilet; `ThingSheet` lists every option cheapest first, *Choose* on each, the unchosen ones faded
and *Undo* on the chosen one.

**Every bill opens** (`PriceSheet`): Mark as paid (a payment for exactly what is owing, dated
today — never a flag), a part payment, Edit, Delete. Before V2 a bill on the whole job or a part
could not be tapped, so it could never be paid, corrected or deleted and *To pay* only grew.

**A supplier who has sent more than one is one heading.** An engineer billing monthly was four
rows reading *MSC Consulting Group Ltd* on the *Whole job* sheet, and the same again under *To pay*.
`groupBySupplier` (`summary.ts`) gathers them on the trimmed, lower-cased name — the rule
`project_supplier_totals` groups on — shown in the most recently dated spelling, keeping the list's
own order. The bills sit beneath as indented rows, each still opening and still carrying its own
*Paid*, and the heading folds (open by default) without losing its figure. **The heading's figure is
only drawn when it is the sum of the rows under it**: on *To pay* that is what is owed; on a room
sheet it is drawn for bills alone, because a quote and a bill from one supplier add up to nothing
(the bill may be a draw on the quote), so a mixed heading says *$X billed* in words instead. A row
naming nobody is never grouped — two bills with no supplier are not known to be from one place.
A supplier with one price is the one row it always was. Pinned by `RoomSheet.test.tsx`,
`projectSummary.test.ts` and `ProjectDetailScreen.test.tsx`.

**A bill that looks like one already on the job says so, and never refuses.** The same bill got
in twice on the live job — INV-15879 and 25.010 twice each, 81914 three times — by being forwarded
again, or typed in and then emailed in too, and was found by eye and deleted. `project_quotes`
had no place for the invoice number (allocating copied it into `notes`, the money sheet folded it
into `detail`), so nothing could compare it. `20260924110000` gives it a column, backfilled from
the allocated cards, and `create_quote`, `update_quote` and `approve_invoice_review` carry it.
`findDuplicateBill` (`duplicates.ts`) is the check, pure and run over the page already in hand:
**the same number from the same supplier** is the same bill (compared ignoring case and
punctuation, and backed by the figure when one side names no supplier); **two different numbers
are two bills** whatever else matches, which is what keeps ReliaBuilder's two $43,987.50 claims
apart; and with a number missing, the same supplier and figure on dates that do not disagree. An
older bill with its number folded into `detail` is searched for it as a whole word. A waiting card
that matches says so above its buttons (*Looks like INV87022 from MSC … already on the job*) with
*Open that one*, and so does the later of two cards for one bill; the money sheet says it under the
invoice number and its button reads *Save anyway*. **A warning, never a lock, and no unique
index**: two claims for one figure are two bills, and only the person holding the paper can tell.
Pinned by `duplicates.test.ts`, `MoneySheet.test.tsx`, `InvoiceReviewCard.test.tsx`,
`PriceSheet.test.tsx` and `ProjectDetailScreen.test.tsx`.

**Nothing new can be typed over a figure.** `EditFigureSheet` is deleted. Overrides already in the
database still count, so the page says *Some figures were typed in by hand*, names what the prices
come to, and offers **Use the prices** (`clear_figure` on each). The view columns stay.

Deleted with the old page: `ItemSheet`, `RecordMoneySheet`, `CommitmentCard`, `EditFigureSheet`
and their specs. `BuildUpSheet`, `ScheduleSheet`, `ExpectedCostSheet`, the invoice-review deck,
handover, punch list and documents are reused as they were.

The vocabulary change is **Projects-tab only**, by the user's decision: the rest of the app keeps
its words and takes only the V2 look (see *Design System*).

### The list card, status, suppliers and files (September 2026)

Four changes asked for together, and each reverses something written further down. **Where they
disagree, this section wins.**

**The card says Budgeted, Quoted, Paid.** Three stacked rows, label left and figure right, on one
line each: project totals are the longest answers in the app, and three across a phone cuts
`$182,103.71` in half. Budgeted is the typed budget grossed to incl GST, Quoted is
`getProjectsQuoted` (the supplier rows' sum, never fatal), Paid is `paid_total`. A figure nobody
has is words, never `$0`: *Not set*, *No quotes*, *Nothing yet*. While the quoted read has not
answered, Quoted says *—*, because *No quotes* is a claim. The facts line (*N to decide · $X to
pay*) stays: it is the list's denominator rule. A complete project carries the same figures,
dimmed.

**Budget remaining is budget less the page's Expected total, and only once something is paid.**
It was budget less paid for one commit, by the user's first decision, and the first real job
showed why that was wrong: two of the builder's four claims were paid and the other two were
earmarked as expected costs, so the card read *$68,101.19 left* while the page said $54,230.18
over. Money that has not gone out is still money the budget has to cover — the user's words were
"technically we are over budget". So the card now carries a fourth row, **Expected total**, and
*Budget remaining* / *Over budget* is budget less that.

- **The figure is the page's own**, never a second sum. `getExpectedTotal` reads `project_page`
  and runs `projectSummary`, because the page counts undecided things at their dearest and open
  quotes on the job, which no column in `projects_with_totals` carries. A cheaper sum would be the
  card saying "left" beside a page saying "over". The page's line is renamed *Budget remaining* to
  match and takes the same tone (`remainingTone`), since it is the same number.
- **It is the heaviest read in the app, so the list asks one project at a time**, and only for
  cards that show the line (a budget and something paid). A newer load abandons an older loop.
  Until the figure arrives, or if it cannot be read, *Expected total* and the line say *—* —
  never budget less paid in the meantime, which is the figure being replaced.
- **The figure stands alone on its row and never shrinks**; the label gives way. It was
  *$68,101.19 · 38% l…* on a phone. Every figure on the card is `flexShrink: 0` now. The
  percentage moves to a line of its own beneath, with what the total counts that nobody has billed
  (*30% over · $87,975 not billed yet*, expected less `invoiced_total`), so colour is never the
  only cue and the reason a job with money in the bank is already over is on the card.
- **The bar is paid, then the rest of the expected total, against the budget**: paid solid, the
  rest the same hue lighter, drawn to the total when it runs past the budget with a notch where
  the budget ends.

Tone as before: `budgetRemaining` / `describeRemaining` (`summary.ts`) colour it **fern** while
more than 15% is left, **brass** from 15% down to just over 5%, and **clay** at 5% or less and
over. What is left is rounded *up* so the words agree with the colour at the edges. Brass and clay
are the palette's warning and alarm hues, so no hue was added.

**Status is a pill beside the date.** `done` reads **Complete** (`PROJECT_STATUS_LABELS`); the
enum is unchanged. Nothing could change a project's status after it was started. The pill under
the name opens `ProjectStatusSheet`: Planned · Underway · Complete, with the date each move needs
(Started, Finished) filled when empty — today, or the finish when the project already finished (see
*A project finishes after it starts* below). It is one `update_project` on Done, and a date
the calendar has not got holds the sheet open. Leaving Complete clears the finish date, and going
back to Planned leaves the start date alone. The pill takes the status hues a job's
`StatusBadge` uses. It replaces nothing: the status chips below were removed for the height they
cost, and a pill in the caption's line costs none.

**Suppliers can be renamed and merged**, in a *Suppliers* section above *Documents*.
- The list is `supplierDirectory` (`suppliers.ts`): every name the job's quotes, bills and
  expected costs use, declined ones included, grouped on the trimmed, lower-cased name like the
  money.
- A tap opens `SupplierSheet`, which renames across the job and lists every other supplier to
  merge into.
- **A merge is a rename to the other spelling**, since that is all the rollups need to see one
  supplier. `home.rename_supplier` (`20260926090000`) now reaches expected costs and bills still
  waiting as well as prices, matches on `reach_project_id`, and refuses a blank name.
- **A merge can move Agreed.** Under the pair rule a bill from a supplier with a signed price at
  that scope is a draw on it, so merging "RELIABUILDER LIMITED" into "ReliaBuilder" can turn a
  variation into a draw. The confirm says the figures may change, and `project_scenarios.sql`
  (S6) pins it with the supplier rows still summing to Committed.

**Merging is press, hold and drop** (`SupplierList`): hold a supplier for 400ms, drag it onto
another, confirm, done. Four things are load-bearing:
- **It is hand-rolled on `PanResponder`**, like `PhotoViewer`. A long press on the row's
  `Pressable` lifts it. The list's responder then claims every move
  (`onMoveShouldSetPanResponderCapture`), which ends the press so no tap fires. The target is
  the row under the lifted row's centre, read from `onLayout` bands, so no window coordinates
  are involved.
- **The page stops scrolling under it.** `scrollEnabled={!dragging}`, and on web a non-passive
  `touchmove` listener cancels the move for the drag's length. `touch-action` is read at
  touchstart, and the hold means the first move is still cancelable.
- **Nothing under the finger may unmount mid-drag.** A touch belongs to the element it started
  on. When the row swapped its facts line for *Drop to merge into…* as a new element, the
  browser stopped delivering the touch: the row followed the finger and never heard it lift.
  Mouse events are hit-tested afresh, so this only broke on a phone. The line now changes its
  words in place, and `SupplierList.test.tsx` pins that.
- **It is never the only way.** A name that looks like another business (`businessKey`) says
  *Looks like ReliaBuilder · hold and drop onto it to merge* and carries a Merge pill. The
  sheet lists every supplier with a Merge beside each. The row's accessibility action opens that
  sheet. The drag does not auto-scroll, so a supplier off screen is merged from the sheet.

**Every file is listed, grouped by supplier** (`FilesBySupplier`, `filesBySupplier`).
- `home.project_files` now carries `supplier` and `owner_detail`, and includes **payments' and
  expected-cost payments' files**, which were on the record and on no screen.
- Groups are sorted by name, with **Not from a supplier** (the job's own files, a part's, an
  item's) last. Each row says what the file hangs off (`describeFileHome`).
- The **×** is only on the job's own files; everything else is removed where it is attached.
- `TaggedFiles` keeps its tag headings (*where's the CoC* is a different question) and lost *On
  prices and parts*. The job's add controls are `Attachments` with `controlsOnly`, so the upload
  rules are still in one place.

`ProjectsScreen.test.tsx`, `suppliers.test.ts`, `ProjectStatusSheet.test.tsx`,
`SupplierSheet.test.tsx`, `SupplierList.test.tsx` and `ProjectDetailScreen.test.tsx` pin the
above; `project_scenarios.sql` S6 pins the merge and the payment file.

### A project finishes after it starts, has a name you can change, and every price says what it is

Four fixes asked for together (September 2026). **Where they disagree with anything above, this
section wins.**

**A project cannot finish before it started.** The status sheet filled an empty *Started* with
today whenever *Complete* was chosen and never looked at *Finished* — and `Segmented` fires on the
option already lit, so tapping *Complete* again on a roof finished in June 2024 made it start in
September 2026. Now:
- **The box just changed wins, and the other moves to meet it**, with one line saying which moved
  (*Started moved to 25/06/2024 — a job can't finish before it starts.*). Pull the finish back
  and the start follows; push the start past the finish and the finish follows. The user chose
  this over refusing. `orderProjectDates` and `defaultStartDate` (`projectDates.ts`, pinned by
  `projectDates.test.ts`) are the rule, and both date sheets use them: `ProjectStatusSheet` and the
  *Already finished* step of `AddProjectSheet`.
- **It runs on blur and again on Done**, because on native a press does not reliably blur a box.
  The boxes live in a ref beside the state, for the reason `draftRef` does on the thing page: the
  calendar fills a box and blurs it before React re-renders.
- **An empty start takes the finish when the finish is already past**, never today.
- **Pressing the status already lit does nothing**, as every chip row here does.
- **The server refuses it in words.** `20260927090000` adds a `before insert or update` trigger
  on `home.projects` (*A project can't finish before it started*) and a check constraint
  underneath it; no live project broke it when it was added.

**A project's name changes from its title.** It was asked on the first step and never again.
`ProjectTitle` makes the large title, with a pencil beside it, a box in the same type. It follows
the saving rule: Return, leaving the box, and leaving the page (`beforeRemove`) write it; an
unchanged name writes nothing; an emptied one puts the old name back, as an item's title box
does. The box stops at the column's 80 characters, and the trigger words a longer name rather than
letting `projects_name_check` surface. A one-box sheet with a Save button was rejected because the
saving rule keeps buttons for sheets that edit two fields together.

**Every price says what it is — `KindPill` — and the pill is how you change it.**
- **On an emailed card** the *Invoice / Quote / Paperwork* pill opens `KindSheet`, and a press
  writes `update_invoice_review(kind)`, clearing *guessed*. The pencil's sheet still asks it too;
  the pill exists because nobody found it behind the pencil.
- **On a price** (`PriceSheet`) the pill above the figure opens *Quote / Invoice*. Paperwork is
  not offered, because a price cannot be paperwork. The change goes through
  **`home.set_quote_kind`**, its own function for `set_quote_status`'s reason: it moves money
  between Agreed and Invoiced. It refuses, in words naming the fix, every change the money model
  says cannot exist:
  - **To a quote:** refused while payments are recorded against it, while it is a claim or pays a
    schedule stage, or while it sits inside another bill or holds one.
  - **To an invoice:** refused while claims are against it, while it is broken into lines or sets
    money aside, while it has a schedule, or while it answers a set-aside.
  - **Either way** the status goes back to `tbc` (a declined quote that becomes an invoice counts
    again, since an invoice counts unless declined), and a quote drops its due date.
- **`update_quote` no longer changes the kind.** It keeps `p_kind` in its signature, because a
  positional gap is a different function, but refuses one that differs. `QuoteUpdate` has no
  `kind`, so a caller trying it gets a compile error.
- **Every row under *Quotes and bills*** in a room sheet carries the pill as a label, through
  `Row`'s `tag` slot. It is never a control there: the row is the tap, and the price's sheet is
  where the kind is changed. Lists that hold one kind (*To pay*, *To decide*) do not repeat it.

**The paper is an *invoice*, by the user's decision.** Where the project page names a single paper
or counts them, it says invoice: *An invoice* on the + sheet's first question, *N invoices* under a
supplier's heading, *Delete invoice*, and the pill. *To pay*, *billed* (a verb), *Bills waiting*
(a deck that also holds quotes and paperwork) and *Part of another bill?* are unchanged.

`ProjectStatusSheet.test.tsx`, `AddProjectSheet.test.tsx`, `ProjectTitle.test.tsx`,
`InvoiceReviewCard.test.tsx`, `PriceSheet.test.tsx`, `RoomSheet.test.tsx`, `updateQuote.test.ts`
and `ProjectDetailScreen.test.tsx` pin the above. `supabase/tests/kinds_and_dates.sql` replays
every refusal through the functions against a local stack, and asserts that Invoiced moves when a
kind changes.

**It is a fifth tab, and five is the ceiling rather than a direction.** List · House · Projects ·
Schedule · You. Projects sits third because it and House both describe the fabric of the place;
Schedule stays last because it is the tab you go to with a question rather than the one where work
is done. Folding this behind a switch on the House tab was considered and rejected: that is the
`By room / By kind` rail coming back, and a tab with two minds is how a tab becomes two tabs badly.
At 375pt each tab gets 75pt and `Projects` and `Schedule` are both eight characters at 11px — they
fit with nothing to spare. **If a sixth noun ever arrives, the answer is not a sixth tab**; it is
that two of these five were never really different.

### Four levels, and the rule that stops them being four

A downstairs laundry renovation is a bathroom, a laundry and a storage area; the bathroom is a
toilet, a shower mixer, tiles and waterproofing; the toilet is three quotes of which one gets
chosen. Storing that needs four tables — `projects`, `project_elements`, `project_items`,
`project_quotes`. *Showing* it needs two.

**A middle layer appears only when it earns its place.** Every project gets an element the moment
it is created — named after the room when one room was chosen, after the project when none was —
and that element is flagged `implicit`. The client does not draw an implicit element; it draws its
items directly, under the heading *What it takes*, and the word never appears. Adding a second
element clears the flag on every element of the project, and the layer becomes visible at the
moment somebody actually made it exist. The same shape repeats at the bottom: an item with one
quote shows that number inline and never says "quote".

Three consequences worth holding on to:

- **`implicit` is stored, not derived from "is this the only one".** Derived was the first shape
  and it is wrong: deleting the second of two elements would silently re-hide the first, which by
  then had a name somebody chose and paperwork attached to it. Once a person has seen the layer, it
  stays.
- **An implicit element with nothing in it is removed when a real one arrives**, rather than
  becoming a phantom "Downstairs laundry" part inside the Downstairs laundry project. One that
  *does* hold something stays and becomes visible, because what it holds is real even though its
  name was never chosen.
- **Elements come from step two of the start sheet, never from a concept anybody has to learn.**
  "Which rooms does it touch" produces one element per room, already named. Pick one room and
  elements never appear at all. The alternative — a nullable `element_id` on an item — was rejected
  because it gives the rollup two paths to sum through, which is how a total starts disagreeing
  with itself.
- **A room the seed never guessed at is made on that step**, through the same *Add a room…* chip
  the walkthrough's first step carries, and for the same reason: the moment somebody notices the
  storage area under the house is not on the list is the moment they are describing a renovation
  that touches it, and sending them to Profile → Location tags and back loses the flow. It calls
  `home.create_location` against the active property and then `reloadLocations()`, so a room added
  here is a room on the List tab and the House tab too — **one vocabulary, or the tabs stop
  describing the same house**. The chip is dashed rather than sunken, the field appears only when
  asked for, and the new room is **selected the moment it exists**: somebody who has typed
  "Storage area" into a question asking which rooms are touched has answered it, and making them
  tap the chip they just made would be the sheet asking twice.
- **Leaving step two commits a name still sitting in the box**, and this shipped broken. The tick
  beside the field was the only thing that created the room, so pressing *Next* with "Workshop"
  typed discarded it and created no room either — a project came out with two parts where three
  were asked for, and nothing anywhere said so, because from the sheet's point of view nothing had
  happened. A half-typed answer in a box is still an answer, and the only honest readings of *Next*
  are "take it" or "say why you can't". Forwards, backwards and *Skip for now* all commit it; a
  refusal (`create_location` rejects a duplicate in words) **holds the step open with the words
  still there** rather than advancing past a name it did not take.

### Money that cannot lie about itself

This is the one part of this app that can actually hurt somebody, and the rules are not negotiable.
`home.snag_advice` keeps costs as **text**, quoted back with the date, because parsing "180-260"
into a number is the app asserting a precision the answer never had. A project cannot do that:
rolling elements up into a total is the entire reason elements exist. So amounts are numeric, and
they buy that back with three rules:

- **A total always ships its denominator.** Never `$8,990` on its own; always `$8,990 · 5 of 9
  items priced`. `ProjectTotals` carries `itemCount` and `pricedCount` in the same object as
  `committedTotal`, and every rollup view computes all three in the same row, so no screen *can*
  render a figure without having been handed its denominator. `describeTotals` writes the line and
  there is no path through either project screen that draws a total without it.
- **An unpriced item is not zero.** It is counted in `itemCount`, excluded from every sum, and the
  gap is named in words — "3 not priced". `sum` over nothing is null here, never 0, and
  `numberOrNull` in the query package exists because `Number(null)` is `0`, which is exactly the
  lie this feature cannot tell.
- **Nothing read out of an attachment reaches a figure unconfirmed.** It used to be that nothing
  read one at all, and every amount was typed by somebody looking at the quote: a scraped total has
  a source nobody can check, and it will be wrong about GST, about provisional sums, and about which
  of three revisions it read. That is still true of what a scrape *is*, which is why the one place
  it now happens — an emailed bill, see *A bill can be emailed in* — lands on a pending
  `invoice_reviews` card that reaches no total, marks every guessed field, and counts only when a
  person allocates it through `create_quote`. The rule moved from "never read" to "never believed
  unseen"; a reading that went straight into `project_quotes` would break it.

**Five figures, and nothing under them.** *Budget* is what you said you'd spend;
**Forecast** is what it is going to cost; *Committed* is what has been agreed; *Invoiced* is what
has been charged; *Paid* is what has gone out. Four of
them are **derived in the views**, never stored — the `needs_parts` argument applied to a far
more dangerous number, since a maintained total and the quotes it describes will disagree the
first time somebody edits an amount from the other phone.

**The prose under the strip is off the page, and the helpers that wrote it are not.** It carried
eight sentences at once — the denominator, how much of the forecast was a guess, the over-budget
variance, the discrepancy line for every edited figure, which side of the budget committed had
landed, what was unallocated across the parts, the two gaps, and the GST basis — permanently, on
a page whose first question is *a bill arrived, where does it go*. Every rule they state is still
`projects.test.ts`' to pin and every extract still prints them; what went is the **recital at the
top of this page**, not the arithmetic.

Two of those readings are still reachable and that is what makes the removal survivable. The
denominator rule holds **in full on the list** — `ProjectsScreen.test.tsx` still pins that no card
renders a total without one, which is where somebody meets a figure they have no other way to
qualify. And an edited figure still renders in clay and still opens `EditFigureSheet`, which
carries **THE PRICES SAY** the whole time somebody is typing — so the derived figure is one tap
away rather than on the page. **If the clay or that sheet's derived row ever goes, the
discrepancy line comes back**: an override whose evidence is unreachable is the one shape this
feature must not take.

**And there are no status chips.** *Planned / Underway / Done* sat under the figures; the list
groups on the same column and is where a renovation is read as finished, so a second writer here
was three taps of vertical rent on a page opened for a different question. (Status is changed now
from a pill in the caption line, which costs no height — see *The list card, status, suppliers and
files*.)

Three rules inside that, and each answers a way the first pass was wrong:

- **Charged and paid are different figures.** `spent` summed invoices and receipts together, so
  an $84,000 invoice and the payment settling it read as $168,000. It had not yet produced a
  wrong number only because `receipt` was being used to mean "paid in full, no invoice" — the
  bug was latent, not absent. A payment now hangs off the invoice it settles
  (`home.project_payments`), so a deposit and a balance are two payments against one bill and
  the double-count is unrepresentable rather than merely fixed. `receipt` leaves the vocabulary:
  existing rows became an invoice plus a payment, and the enum value stays unused because
  Postgres cannot drop one.
- **An invoice is the commitment when nothing was ever quoted.** A consultant billing time by
  the month has no quote and never will. Reading that as "not priced" while money goes out of
  the door is how `committed - paid` comes out negative — it did, on the live project, against
  three suppliers at once. So `committed` is the accepted quote at a level, *or* its invoices
  when nothing was quoted there.
- **The Quoted *band* is gone; a Quoted *figure* is back.** What went was the low-to-high
  range across undecided quotes — it answered a question nobody asks after the first
  fortnight, and per-line allowance variance (below) answers the same thing far better and
  against real numbers. `rangeLabel` and `hasOpenRange` stay deleted. What came back is one
  number sitting directly above Committed: **what the suppliers have actually said**, counting
  every price of kind `quote` that has not been declined, accepted ones included. Committed on
  its own cannot tell a job nobody has priced from a job where three contractors have quoted
  and nobody has signed — both read as nothing agreed — and the gap between the two is what is
  still to decide.

  It is the **sum of the supplier rows** (`projectQuoted`), not a sixth expression in
  `projects_with_totals`, and that is the whole of why it can be trusted: every money line now
  opens to show what it is made of, and a line and its rows that are computed two ways are two
  numbers waiting to disagree. There is no override for it, so its row does not open an editor
  — this figure is the prices and nothing else.

### Committed is not the answer to "are we over"

It was the headline figure and it is the wrong one, because it lags reality by **everything
nobody has priced yet**. On the live renovation that read $103,574 against a $187,000 budget with
five items unpriced and a $176,755 contract nobody had marked accepted — the page reported nearly
$89,000 of headroom that did not exist. Committed fails in the direction that costs money, and it
fails quietly right up until the last quote lands.

    forecast = committed + additionalOpen + expectedOpen + budgetGap

**A forecast is by construction partly invented, so it always says how much of itself is.**
`forecastGuess` rides beside `forecastTotal` exactly as `itemCount` rides beside every sum, and
`describeForecast` is the only thing that writes the line — there is no path through either
project screen that renders a forecast without it. It is worded **"still a guess"** and never
"still an allowance": the guess is three different things and only one of them is somebody's
written number inside a contract. Collapsing the wording collapses §3.4's distinction.

`budgetGap` is the only term that invents anything and it is fenced hard: a part must have a
budget, it must still have unpriced items, it is the remainder of that budget or nothing, and a
part whose items are all priced contributes zero — the money left over there is a **saving**, not
a cost still to come. A project with no part budgets gets no term at all, which is the honest
answer when nobody has said what the unpriced work is worth.

**The variance warning names its cause and is silent under.** Past 5% over, `describeForecastVariance`
writes *"$23,000 over budget — 5 items aren't priced and $17,645.78 is still a guess"*. A
percentage with no cause is a number people learn to ignore. It says nothing when the forecast is
under budget, because it is a warning rather than a running commentary, and nothing at all against
a budget nobody typed — "0% over" there would be the app inventing a reassurance.

### A cost you know about, that nobody has quoted

The architect says *"you'll need an engineer, and the council will want their share."* No vendor,
no quote, no invoice. That beat had nowhere to go: an **item with no price** contributes nought to
every figure, so a cost the household knows about read as zero (which is exactly what *Geotech
engineer* was doing on the live job), and a **quote nobody gave you** is a fabricated commitment
against a firm that has never heard of you.

`home.project_expected_costs` is the third kind of row and the only one in this feature whose
number is allowed to be somebody's estimate. The distinction that must not blur: an **allowance**
is a written number inside a contract you signed, so it counts as committed and is merely soft; an
**expected cost** is not committed, because nobody has agreed to anything.

**"Because nobody has agreed to anything" is a state, not a property of the row**, and that is
what `confirmed` (`20260921120000`) finally says. The architect's $4,000 is a guess in week one
and an agreed fee in week three, and until then the only way to say the second thing was to invent
a quote from a firm that never sent one — the fabrication this row exists to refuse. So the fence
does not move; it gains a gate:

- **Unconfirmed** — exactly what an expected cost has always been. Forecast alone, counted in
  `expectedOpen`, worded as a guess, owed to nobody.
- **Confirmed** — it counts in **Committed**, it is owed to `likelySupplier` under *Who we're
  paying*, and it leaves `expectedOpen`, so the forecast stops calling it a guess.

**It still never reaches Invoiced or Paid**, confirmed or not: nobody has billed for it and no
money has moved. So confirming one widens *still to be billed*, which is the true reading — agreed
work nobody has claimed for yet. **And it never reaches Quoted**, because that line is what the
suppliers have actually *said* and nobody said this. Quoted sitting below Committed on a job whose
costs were agreed rather than quoted is not a contradiction; it is the page saying which of the two
this money is.

**Summed from exactly one place, as ever.** A confirmed expectation is **added** to a scope's
committed figure rather than folded into the accepted-or-invoiced fallback beside it — it is a
different kind of row, not another quote at the same scope, and putting it inside the `coalesce`
would make one suppress the other:

    committed(scope) = coalesce(accepted, invoiced) + confirmed expectations

A part's confirmed expectations roll into the job through that part's `committed_total` exactly as
its items do; only the ones belonging to the job rather than to a room are added again at the top.
And the same figure joins `project_supplier_totals`, because **the supplier rows sum to the
project's committed total** and money in Committed owed to nobody would break that on the first
confirmed row. Measured on the live job rather than asserted: confirming the $4,000 architect took
Committed from $880 to $4,880, left Forecast at $4,880 untouched, took `forecast_guess` to nought,
and the supplier rows still added to $4,880.

**Default false, so nothing on any page changes until somebody presses it.** Confirming is a
deliberate act and it is the only write on an expected cost that moves a total, so it is its own
function — `set_expected_cost_confirmed`, the reason `set_part_bought`, `set_quote_status` and
`set_item_excluded` are theirs. `update_expected_cost` does not take it and `ExpectedCostUpdate`
omits it from its type, so trying to send it beside a corrected name is a compile error rather
than a write that quietly does nothing. The one exception is **creation**, where there is no total
to change yet because the row is being made: `create_expected_cost` takes `p_confirmed`.

**The sheet asks in two named halves and the row says which it is.** *Has anybody agreed this?* ·
**Confirmed** · **Not yet**, in the app's one chip shape, with a line under it saying what each
answer does to the figures. On *Also expecting* the row's own sub-line reads *"confirmed — counts
as committed"* or *"unconfirmed — forecast only"*, and a confirmed amount renders in ink against
the muted default, because the difference is whether the figure beside it is inside Committed — and
a reader left to work that out from the total is a reader who stops trusting the total. The reader
who wants the rest opens Committed's own breakdown, where a confirmed expectation appears under
the supplier it is owed to. `ExpectedCostSheet.test.tsx` pins the two halves, the no-op press, the
write going through its own call rather than Save, the revert on a refusal, the wording of both
answers, and the create path carrying the answer in rather than writing it twice;
`ProjectDetailScreen.test.tsx` pins both sub-lines and the re-read after the write.

**It is replaced, not added to.** `settled_by` points at the real price when one arrives and the
expectation stops counting, or the forecast double-counts as the job firms up. It is kept rather
than deleted because "we thought the engineer would be $4,000 and it was $5,600" is the only way
this app can make the next renovation's guesses better. **The amount is optional**: "there will be
council costs" with no figure is still worth recording, as a named gap rather than as silence.

**The row can be opened again, and it can be deleted.** A guess made in the first week of a job is
rarely the final word — the architect's estimate gets revised, the likely supplier turns out to be
somebody else — and until now the only way to fix one was to delete it and lose whatever had
already been recorded against it. Tapping a row on *Also expecting* opens the same
`ExpectedCostSheet` in edit mode; the `+` beside the heading still starts a new one.

**A payment against it is its own thing, and it is deliberately thin.** An initial payment to the
architect, a second instalment — `home.project_expected_cost_lines` holds them, each with a name,
a reference number, a value, and somewhere to put a photo or a document, because that is what
somebody standing at a bank statement actually has to record and nothing more. **It never reaches
Committed, Invoiced or the forecast, confirmed or not.** The parent expected cost still carries the one guessed
figure that feeds Forecast — a payment on account is a record of what has moved, not a second
opinion about what the job will cost, and letting it count twice is exactly the double-counting the
rest of this feature is built to avoid. Read the way a bank statement is read, not priced.

**Leaving the sheet commits a payment still sitting in the box**, and this shipped broken. The
only thing that wrote a line was the small *Save* beside it, so somebody who filled in a value
and an invoice number and then pressed the sheet's own Save had it discarded — silently, with
nothing anywhere saying so, because from the sheet's point of view nothing had happened. On the
live job that was every payment ever typed here: `project_expected_cost_lines` had no rows at
all. It is the project sheet's *typed-and-not-ticked* bug, one screen over, and it takes the same
fix: the line is committed first, and a refusal **holds the sheet open with the words still
there** rather than closing over something it did not take. The payment's own Save is live with
an empty name rather than dead, and says what it wants — a disabled button is indistinguishable
from a button that did nothing, and here that difference is a payment somebody typed and lost.
`ExpectedCostSheet.test.tsx` pins all four cases, the untouched box included.

### Two gaps, not one, and only one of them is about today

`Outstanding` was committed less paid, and it answered neither of the two questions people
actually ask:

| | | Answers |
|---|---|---|
| **Still to be billed** | committed − invoiced | *"ReliaBuilder have $88,780 left to claim."* |
| **To pay** | invoiced − paid | *"$43,987.50, due 20 October."* |

`stillToBill` is deliberately **signed**: negative means somebody has billed more than was ever
committed, which is the over-billing signal and the last thing to floor away into a tidy zero.

`dueToPay` is **the only figure in this feature that is about today** — everything else on the
page is a position and this is a task, which is why it is the one with a date. `project_quotes`
carried `dated` (the date on the paper) and had no due date at all; `due_on` is that column.
`home.project_bills` lists the live bills with what is still to go out on each, and **its `overdue`
flag is computed against the server's `current_date`** — comparing to `toISOString().slice(0, 10)`
is a UTC comparison that reads a bill due today in Auckland as late for half the year, the same
`dayKey` trap the Schedule tab already pays for once.

The helper is `describeToPay`, not `describeDue` — that name already belongs to the snag list's
due-date phrasing, and two functions called the same thing on two kinds of due date is how a
screen ends up saying "3 days overdue" about an invoice. **Nothing sends anything**: a due date is
a fact a page sorts by, and money does not get an exception to the no-notifications rule.

### Signed, not accepted

The word is the fix for the one genuinely wrong number the live page was showing. ReliaBuilder's
$176,755 contract sat at `tbc` for five months, so it contributed nothing to Committed and the two
progress claims against it stood in for it instead. *Accepted / TBC / Declined* is the vocabulary
of **comparing three prices for a toilet**; nobody looks at a contract they signed in March and
thinks "I should mark that accepted" — and the control was six levels deep besides.

So a commitment is signed under *Who we're paying*, **two taps from the top of the page**.
*Accepted / Declined* stays on the item sheet, on the one price an item now carries — see *One
price, and a header that says where it's up to* below. The enum underneath is unchanged.

### A number you can type over, and the app saying so in red

Every figure on the project page is derived, and that is the rule the rest of
this section rests on. **This breaks it deliberately, on one condition: both
numbers survive.**

`home.project_overrides` stores an override, never a total. The derivation is
untouched — `committed_derived` goes on being what the prices add up to — and
the view carries three columns where it carried one: `*_derived`, `*_override`,
and `*_total` which is `coalesce(override, derived)`. So the page can say
*"Committed is edited: $200,000 typed · the prices say $103,574.22 — $96,425.78
more"* and go on saying it for as long as the edit lasts. A stored total that
replaced its own evidence would be unrecoverable; this is a sticky note on the
glass, and *Use the prices again* is a real undo rather than a recovery from
nothing.

**`describeOverride` always names the derived figure**, never merely that
something was edited. That is the half that makes an override honest, and
dropping it would leave a reader eight months later with no way back to what the
paperwork actually supports. An edit that happens to match the prices is said
plainly and **not** reddened — a discrepancy the app manufactures is an alarm
nobody will believe the next time.

**It is no longer printed on the project page, and the rule is unchanged rather
than relaxed.** The helper still exists and still words it exactly that way; what
carries it now is the clay row plus `EditFigureSheet`, which the row opens and
which shows **THE PRICES SAY** while somebody types. The reader's way back to the
paperwork is one tap instead of nought — so the two things that must not go are
the colour and that sheet's derived row. Lose either and the line goes back on the
page: red on its own says *something was typed here* and never *what the prices
actually say*, which is the half the rule is about.

Four rules, three of them enforced in the view rather than left to a screen:

- **The page cannot contradict itself.** `still_to_bill`, `due_to_pay` and
  `forecast_derived` are computed from the **shown** figures. Override Committed
  and let the gap read off the derived one, and two numbers a line apart stop
  adding up — which is precisely the incoherence overriding is meant to be
  honest about rather than cause.
- **A part's override rolls up.** `parts_committed` sums each element's *shown*
  total, so the job's figure never contradicts the sum of the parts listed
  directly under it. A project-level override then sits on top of that.
- **Suppliers are not overridable.** *Who we're paying* is a second view over the
  same rule and the check worth keeping is that those rows sum to Committed. An
  override there could not be reconciled with anything — it would be money owed
  to a named person that no price supports. Override the total if you must; who
  you owe stays what the paperwork says.
- **Clearing is its own function.** `clear_figure`, not `set_figure(null)`, for
  the reason `set_part_bought` and `set_quote_status` are theirs: putting the
  derived figure back is the act that changes what the page claims, and it must
  not be reachable from a form somebody happened to empty.

**An edited figure renders in clay**, and that is the *third* thing in this app
to earn red after overdue and priority-high. It earns it on exactly the same
terms: a fact about a number rather than a judgement about importance — this
figure is not what the paperwork says. The whole row is the tap target rather
than a pencil beside it, because four stacked 48px rows with a separate
affordance each is four more controls on the densest part of the page, and the
label already says which figure is which. `editing` beats `over` for the colour
when a figure is both, because being typed over is the more surprising of the
two.

### A builder's number is not one number

The load-bearing rule of the money model, and the one everything else hangs off.

ReliaBuilder's $176,755 is a list: demolition, labour, waterproofing — and, against the fittings
and the tiles, an **allowance**. A figure the builder wrote down for something they are not
themselves supplying, or have not yet priced. In a New Zealand building contract these are
provisional and PC sums, and they are the lines that move.

So a quote carries **lines** (`home.project_quote_lines`), a line may be an allowance, and a
later quote **supersedes** the line it was got for (`supersedes_line_id`). When the plumbing
merchant quotes $890 for the toilet, that quote points at the *Bathroom fittings* line; once it
is accepted, the line contributes what was actually quoted instead of what was allowed. The
price build gets more granular as real numbers arrive.

Four rules make that honest, and each prevents one failure:

- **Money is summed from exactly one place.** A quote that supersedes a line contributes only
  through that line, never also on its own account. That is the whole answer to "is the toilet
  inside the contract" — linking is the answer, and linking is the same act that produces the
  breakdown. A price pointing at nothing is a separate purchase and sums normally. The failure
  it prevents is the one the element layer already names: *a rollup with two paths to sum
  through is how a total starts disagreeing with itself.*
- **A quote says whether its number can move.** `basis` is `fixed` or `estimate`. A fixed-price
  contract stays what it says whatever the fittings cost — the variance is the builder's, and a
  real change costs a variation, which is a new quote. An estimate moves. The app cannot infer
  which it is holding and guessing would be a lie about somebody's contract, so it asks once,
  defaulting to **fixed**: the answer that does not silently move.
- **A recomputed total says how much of itself is still a guess.** `allowance_open` rides beside
  every build-up for the same reason `item_count` rides beside every sum. It is worded *"still
  an allowance"* and never *"not priced"* — **an allowance is not an unpriced item**: an
  unpriced item contributes nothing and is counted in the denominator; an allowance is somebody's
  written number and it counts. Collapsing the wording collapses the distinction.
- **Per-line variance is the early warning, and there is no forecast anywhere.** *"Tiles were
  allowed $12,400; Tile Depot has quoted $15,900 — $3,500 over, if you accept it"* is a real
  number from a real quote, months before the invoice, and nothing had to be estimated to
  produce it. That is why the app never puts a figure on work nobody has priced.

**Three things the app must ask about an allowance and can never infer**, each a number-sized
lie when guessed:

1. **Is it inside the quoted total, or on top of it?** $150,000 "including a $10,000 laundry
   allowance" and $150,000 "and budget another $10,000" differ by exactly $10,000. `additional`
   is that answer, and an additional line nobody has priced is **not committed** — it is a
   ballpark outside a contract, so it goes to Forecast as `additional_open`, never to Committed.
2. **Which word did the contract use?** `allowance_kind` is `pc_sum | provisional | ballpark`.
   The arithmetic does not differ; at final account the argument is the householder's to have and
   they need to know what they signed.
3. **Does the head contractor keep a margin on a direct buy?** `attendance_pct`, a percentage of
   the **actual** and never of the allowance — their cut moves with the real price, which is why
   they ask for it.

**And a fourth question, which decides who is owed rather than what it costs: who is billing
you?** `project_quotes.billed_through_id` is null when a supplier invoices the household direct
and names the head contract when the price is passed through it. The total is the same either
way; the answer to *what do we owe, and to whom* is completely different, and the supplier rollup
was silently wrong about it — a cabinetmaker showed as owed $12,000 the household will never pay
them.

**So an inside allowance resolves four ways**, and the last two are the ones that were wrong
until `20260921090400`:

- **Not superseded** → contributes what was allowed, counted in `allowance_open`. Committed, and
  flagged soft.
- **Additional and not superseded** → contributes nothing to committed; it is Forecast's.
- **Superseded, billed *through* the contract** → the contract sum adjusts to the real number.
  That is what a PC sum is *for*. An estimate's build-up already carried it; a fixed price needed
  `allowance_absorbed`, without which the contract went on carrying the $14,000 it allowed while
  the $11,800 actually charged landed nowhere and the household's saving was invisible.
- **Superseded, billed *direct*** → the allowance **leaves** the contract sum and the attendance
  stays. The sub's own price then counts **on its own account** — which is the clause §3.1 was
  missing. "A superseding quote never counts on its own account" was right only while the
  allowance stayed inside the contract; once it leaves, that filter dropped the money entirely.
  Counted **once** either way, which is all the rule was ever protecting.

The check that holds all of this together, pinned against the live database rather than a mock:
**the supplier rows sum to the project's committed total.** Mike and Alyssa's scenario — a
$150,000 contract, a $10,000 allowance bought direct at $12,000 with 10% attendance, a $14,000
allowance the builder supplied at $11,800 — comes out ReliaBuilder $139,000, Gibson $12,000,
Kitchen Mania $12,000, Elite Bathroomware absent because they bill the builder. $163,000, and
Committed is $163,000.

**A quote knows its project, and that is a stored column.** `home.quote_reach(id)` is still the
*definition* — coalesce the quote's own `project_id`, its element's, or its item's element's — but
it stopped being what the views compute per row. `project_quotes_with_totals` exposed it as
`reach_project_id` and the client filters on that, so the planner saw `Filter: (home.quote_reach(id)
= $1)` over a **seq scan of every quote in the table**, running a four-table join once per row;
`project_bills` and `project_supplier_totals` paid the same. It is
`home.project_quotes.reach_project_id` now: written by a trigger, indexed, and **safe because the
join can never change** — exactly one of `item_id`/`element_id`/`project_id` is set at insert, and
nothing anywhere re-parents a quote, an item or an element, so the trigger is the only writer. That
is the distinction from `needs_parts`, which was derived precisely because two writers *could*
disagree. The three views were **replaced, not rebuilt**: each keeps its column list exactly, so
`create or replace view` took them and the four rollups above them were never touched — and the
migration was checked by diffing every row of all six views before and after, which came back
identical.

**It missed `project_files`, and that was the expensive one.** `20260921100100` finished the job.
The view is not merely a file list: `projects_with_totals` counts it in a lateral for
`file_count`, so a project card, the Schedule tab and the You tab's loose ends were each dragging
a seq scan of every quote through a per-row function to print "3 files". Fixing it took
`projects_with_totals` from 149ms to 53ms and the whole project-page read from 414ms to 242ms.
Note the replace had to restate `with (security_invoker = true)` — leaving it off would have
reopened `20260921100000`'s leak on the file list.

**A quote attaches to one level — an item, a part, or the whole project.** A main contractor's
contract covers the bathroom *and* the laundry, so it belongs to neither; forcing it onto the
item layer meant inventing an item called "Main contract — ReliaBuilder" sitting beside the
vanity, which is how the item layer stops meaning "a thing being bought". Exactly one of
`item_id` / `element_id` / `project_id` is set, enforced by a check constraint and said in words
by `create_quote`.

**Accepted / TBC / Declined, where there was a `chosen` boolean.** A boolean could only ever say
"not chosen", which read the same whether nobody had decided or somebody had said no. A declined
price leaves every total and **stays on the record**, dimmed: what you were quoted and by whom is
what makes the next renovation's numbers credible. `set_quote_status` is its own RPC for the
reason `set_part_bought` is — it is the only write that changes what a total says, and alone it
cannot have its sibling-clearing skipped by a caller passing a status among eight other fields.

### A bill can claim against a contract

`project_quotes.against_quote_id` (`20260922090000`). *This bill is claim 2 of that contract* —
the sentence the model could not say, and whose absence made every ReliaBuilder number on the
live job wrong in one of two ways. Record the $176,755 contract as an **invoice** and the page
reports the whole thing as billed, with *still to be billed* at $0. Record each progress claim as
a **payment** against that invoice and the money is right while the bill is fiction. Both
happened: one project carried $87,975 of payments against a single $43,987.50 bill, the other a
$176,755 "invoice" with two payments on it. The references typed into those payments were invoice
numbers, which is the tell — **payments were standing in for claims because they were the only
repeating control on the screen.**

The arrangement it makes possible, and the one the money model always wanted:

```
One scope — the job, or a part
  ├── quote, SIGNED  $176,755     → Committed, and it does not move
  ├── invoice  claim 1            → Invoiced, + a payment
  ├── invoice  claim 2            → Invoiced, + a payment
  └── invoice  claim 3            → when it arrives
```

Committed stays the contract. Invoiced is the claims. *Still to be billed* is what the builder
has left to claim, and *to pay* is what has been claimed and not settled. Both gaps already
existed; nothing could feed them.

**Summed from exactly one place, enforced at the write rather than patched in five views.** A
contract and its claims must not both reach Committed. That is already true when they sit on the
same scope — `coalesce(accepted_total, invoiced_total)` lets the accepted quote win and drops the
invoices — and false the moment they do not. So `create_quote` **refuses a claim that does not sit
exactly where its contract sits**, which makes the double-count unrepresentable rather than
something every rollup has to subtract around. Not one view expression changed, and
`20260922090000` proves it: every rollup came back byte-identical after the migration. Four more
refusals, each a way a claim could lie: only a bill can claim, only against a quote, only in this
job, and `on delete set null` so deleting a contract never takes the claims with it.

`project_quotes_with_totals` gains `claimed_total`, and `describeClaimed` always names the
contract beside it — *"$131,962.50 claimed of $176,755 — $44,792.50 still to claim"*. The
denominator rule, one figure further in: a claimed-so-far number without what it is claimed
against is the same misleading half-answer as a total without its item count. `stillToClaim` is
never negative — an over-claim is `stillToBill`'s to report with its sign intact, and here the
question is only how much is left.

### Recording money is a walkthrough, not a form

`RecordMoneySheet`, behind the one filled button on the project page. It replaces
`RecordBillSheet` rather than sitting beside it — one door, or people find the one that teaches
nothing.

**The fields were never the problem.** The old sheet asked the right four things on one page —
what kind of paper, who from, how much, what it's against — and the live job still came out wrong
three ways at once: a contract recorded as an invoice, its claims recorded as payments, and both
hung off items named after the paperwork inside a part called "Builders Quote". Four independent
questions teach nothing, so somebody who does not already hold the model in their head answers
them plausibly and wrongly. **Note that "Builders Quote" is the second time** — "Whole job" was
the first. A shape somebody invents twice is a shape the UI is asking for.

So the questions are asked in an order where **each answer narrows the next**, in the words
somebody holding a piece of paper would use rather than the schema's.

**Who first, which is what pays for the rest.** The supplier is the one thing you know without
reading the document, and it is the most powerful key: once it is ReliaBuilder, the app knows
there is a signed contract and can offer *a claim against it* with what is left to claim
underneath. Rows with a search rather than a wall of chips — `RoomPicker`'s argument and its
substring match, so "relia" finds them and "build" does too. A name that is not there is typed
and added in the same control, because **supplier stays free text**: a list you must fill in
before you can record a quote is setup, and this app does not do setup.

`getSupplierNames` reads across the **whole household**, not this project. Starting a second job
and being offered nothing is how one household ends up holding both "ReliaBuilder" and
"Reliabuilder", which is exactly what happened and what `rename_supplier` then had to fix. One
request, made when the sheet opens rather than on the project page's own path — the pool is ten
connections — and never fatal, because a name list that will not load leaves you typing the name.

**A step only appears when it has a real answer to offer**, and that is the whole of what keeps it
simple:

| | Step | When |
|---|---|---|
| 1 | Who's it from? | always |
| 2 | What have they sent? | always |
| 3 | Does this replace something? | only when there is something |
| 4 | Amount, invoice number, dates | always |
| 5 | What's it against? | never for a claim |
| 6 | What's it made of? | quotes only, always skippable |
| 7 | Attach the paperwork | not for an expected cost |

A claim from a supplier already on the job is **three screens**; a first contract from a new
supplier with a full build-up is all seven, and that is the once-per-job moment somebody is at a
desk with the contract in front of them — the thing walkthrough's own argument. It is the answers
that decide, never a mode switch, and the step counter says so honestly.

Five things inside it are load-bearing:

- **A claim never sees step 5.** It inherits its contract's scope, which is the double-count fix
  made invisible rather than explained — and `create_quote` refuses anything else, so the rule
  holds even if this screen is ever wrong about it.
- **Nothing is written until the last step.** The sheet collects a `RecordPlan` and the screen
  performs it. A half-created invoice is a wrong number in a total, not merely a thin record —
  the thing walkthrough's rule with more force. It is also why the build-up lines ride along
  rather than being written as they are typed: a contract with three of its five lines saved is a
  build-up that does not add up.
- **Step 6 is what finally makes the allowance machinery reachable.** Flagging a line as an
  allowance is what turns a later price into *"tiles were allowed $12,400, Tile Depot has quoted
  $15,900 — $3,500 over"*, months before the invoice and off real numbers. Every rule about
  allowances was written, granted and tested five months before `BuildUpSheet` existed and has
  **still never run on the live contract**, which is one opaque $176,755 figure to this day,
  because breaking it up was a separate trip nobody makes.
- **A quote may name a new category; a bill may not.** *Consent and council*, *Scaffolding*,
  *Engineering* — a renovation has parts that are not rooms, and the picker alone insists
  otherwise. The relaxation is deliberate and bounded: a quote is a planning moment where you are
  describing what the job is, a bill is a recording moment where the job is already described,
  and a bill that can invent a bucket is how the paperwork-shaped part came back twice.
- **A cost to expect is the third option on step 2**, routing to `project_expected_costs` with its
  confirmed/unconfirmed answer. So *Also expecting* keeps its card and loses its separate pill:
  one front door for money. It is deliberately **not** called an estimate — `basis = estimate`
  already means whether a quote's number can move, and collapsing those two is a 15%-shaped
  mistake.

`RecordMoneySheet.test.tsx` pins the supplier step naming what you already have, the claim option
appearing with what is left to claim, a claim never being asked its scope and carrying
`againstQuoteId` with the contract's own, the step counts, a quote being asked whether it is
signed, the new-category box being a quote's alone, *replaces* staying away when there is nothing
to replace, the expected-cost branch writing no price, and nothing being written before the last
step. `projects.test.ts` pins `stillToClaim` never going below nothing and refusing the question
of a bill, `describeClaimed` always shipping its contract, and `supplierSuggestions` — the signed
contract it names, the two-contract case where it offers no shortcut, and names carried in from
other jobs.

### Each figure opens onto who it is made of

Every line in the strip that suppliers can be named for — Quoted, Committed, Invoiced, Paid —
carries a chevron beside it, and opening one lists the suppliers behind it largest first. The
chevron is a **sibling** of the row rather than inside it, because opening a figure and editing
it are two different acts and a `Pressable` inside a `Pressable` is a coin toss about which one
gets the tap.

**Budget and Forecast deliberately have none.** A budget is what somebody typed and no supplier
has said anything about it; a forecast is committed plus three kinds of guess, two of which are
by definition money nobody has quoted. Attributing either to named suppliers would be the page
inventing a debt, which is the one thing this feature must never do.

**A supplier with nothing against that figure is left out, not drawn as a zero.** "Tile Space,
nothing invoiced" is not part of what Invoiced is made of, and a column of noughts is how a
breakdown stops being read.

**And where the rows cannot add up to the line, the page says so.** An override is the only
thing that can cause that, and it causes it by design: the rows are the prices and the line is
what somebody typed instead. So the breakdown ends with what the prices actually come to — the
same rule `describeOverride` follows, never merely that something was edited — because a reader
who notices the gap unaided concludes the breakdown is broken.

### Who is owed what

One row per supplier on the project page — committed, invoiced, paid, and what is still to go to
them — absent entirely when nobody is owed anything, the same rule as the shopping pill at zero.
**The check worth keeping: these rows sum to the project's committed total.** They are two views
over one rule, and if they ever disagree one of them is lying about who is owed money.

**The section is folded by default**, and the heading keeps the count and what is still to go
out. Five supplier cards is most of a page, and what somebody arrives with is *a bill arrived,
where does it go* — which is the button above the money, not this. A fold that took the count
with it would be a filter rather than a fold, which is the list tab's own rule one screen over.
The figures' own breakdowns (above) are the quick answer; these cards are the long one.

The fallback belongs to the **scope**, not the supplier, and getting that wrong is subtle: group
by supplier and then ask "accepted quotes, or failing that the invoices" and a consultant who has
only ever invoiced comes out owed nothing, while a builder with a contract *and* a separate
pre-start invoice has that invoice swallowed. `20260918090500` exists for exactly that — and
**`20260921090400` lost it again**, restating the rule as a flat `filter (where kind = 'quote'
and status = 'accepted')` while fixing the direct-buy case. The rows added to $7,773.47 under a
Committed line reading $103,574.22 for three days, with nothing on screen able to show it;
opening the figures is what found it. `20260921110000` restores the scope fallback on top of
090400's direct-buy handling, measured against the live rows rather than asserted.

**`20260923090000` moves the fallback from the scope to the pair — this supplier, at this scope.**
The scope rule was still wrong the other way: once *anybody* signed at a level, *every* invoice
there stopped counting, so the builder's contract on the whole job hid the architect's, the
engineer's and the council's bills, and one signed plumber's quote hid the vanity, the tiles and
the paint on an ensuite ($1,450 committed against $3,929 invoiced). An invoice now counts unless the
same supplier has a signed price at that scope, or it claims against a quote (`against_quote_id`).
It is done by redefining `project_scope_money.accepted_total` so the eleven
`coalesce(accepted_total, invoiced_total)` expressions above it give the right answer unchanged,
and `project_supplier_totals` applies the same pair rule so the rows still sum to Committed. **One
known limit:** a bill from the builder *before* the contract (a pre-start investigation) reads as a
draw once the contract is signed — nothing on the row tells the two apart.

Supplier stays **free text**, because a supplier list somebody has to fill in before they can
record a quote is setup, and this app does not do setup. It groups on the trimmed, lower-cased
name and displays the spelling used most recently, and `home.rename_supplier` fixes a typo across
a whole job — a rollup nobody can correct is a rollup nobody trusts. The page's *Suppliers*
section is where that happens, by rename or by dropping one supplier onto another.

### One price, and a header that says where it's up to

The item sheet used to hold a shortlist — several quotes on one item, each with its own
*Accepted / TBC / Declined*, kept for comparing suppliers side by side. **An item now carries one
active price**, and the sheet's header is that price's own lifecycle rather than a second decision
sitting above the quotes list: **Quote** or **Invoiced** first, then whichever question follows
from the answer — a quote is *Accepted* or *Declined*, an invoice is *Paid* or *Not paid*.
**Accepted doesn't finish anything**: the next real event on a job is the bill, so an accepted
quote reads **Pending invoice** underneath the toggle until somebody moves it to Invoiced. Tapping
the state already chosen clears it, the same toggle-off every chip row in this app already gives —
there is no third pill for "not decided" the way `tbc` used to render as a visible option.

**Paid writes a payment, it doesn't just flip a flag.** Marking a price Paid records
`home.add_payment` for exactly what `unpaid` still says is owed, so the figure behind the button
and the figure in the rollup can never disagree; marking it Not paid removes the payments recorded
against it. Nothing here reads a figure out of an attachment, same as everywhere else in this
feature — the amount is whatever `unpaid` already computed from what was typed and what has
actually been paid.

### A bill paid in lots, under the price it settles

*Paid* and *Not paid* are the whole answer only when the money went in one transfer. A $15,000
price gets invoiced in lots — a deposit, a progress claim, the balance — and until now the app had
two states for that and no way to record the three that actually happened. **Add a payment** sits
under the price and takes what somebody standing at a bank statement has in front of them: the
value, the **invoice number**, the day it went out, the bill itself as a photo or a PDF, and a
line of free text.

The table was already right and did not change shape: `home.project_payments` has always hung off
the invoice it settles, which is what makes a deposit and a balance two payments against one bill
rather than two bills. `20260921094000` adds only `photo_paths` and `document_paths`, and
`update_payment` beside them.

Six rules, and each answers a way this could lie:

- **A payment settles a bill, not a price.** `add_payment` has always refused anything but an
  invoice, in words, because money recorded as gone out against a price nobody has been billed for
  is the sibling-row shape the table exists to end. So the control is **absent under a quote**
  rather than offered and refused — a button whose write the server is going to turn down is worse
  than no button.
- **The chips are derived from these rows, not asserted over them.** `unpaid` is computed in the
  view from exactly the payments recorded, so the last one landing is what flips *Paid*. Nobody
  can mark a part-paid bill paid, and nobody has to remember to.
- **The optimistic patch is a subtraction, never a zero.** A $3,000 deposit against $15,000 leaves
  $12,000 owing, and a chip reading *Paid* on the strength of it would be the page asserting
  something its own rows flatly contradict. Removing one adds back **that payment's** figure, not
  the whole bill — the others are still recorded. A correction patches nothing at all and waits for
  the re-read: it moves `unpaid` by the difference between two figures, one of which is on the row
  being replaced, and getting that wrong is more expensive than the round trip.
- **Not paid now asks, when there is something to lose.** It exists to undo the one-tap *Paid*,
  where what it removes is a figure and nothing else — so a bare payment still goes without
  ceremony, and one carrying an invoice number, a date or an attachment is **named in counts
  first**. That is the same distinction removing a part of the job already draws, and the reason
  it matters is the same: demanding a confirm for a row holding nothing is how people learn to tap
  through the one that holds something.
- **A payment can be corrected rather than retyped.** `update_payment` takes `p_clear` like every
  other update in this schema, so an emptied box is *set it to nothing* rather than *not touched*.
  The **amount is deliberately not clearable**: a payment with no figure is not a correction, it is
  a row that should not exist, and `delete_payment` is how that is said. The box loads the figure
  **as it was typed**, never the GST-inclusive one — the same trap the price form already pays for,
  where loading the normalised figure raises an ex-GST payment by 15% every time somebody opens it
  to fix an invoice number.
- **One column for the reference.** The invoice number goes in `reference`, which already held
  "Deposit" and "Progress claim 2". A second column beside it would be two writers of one fact,
  which is the failure this schema keeps naming.

The paperwork reuses everything: `home-photos` under `<household_id>/docs/`, through
`HOUSEHOLD_FILES_BUCKET`, `getFileUrl` and the one `Attachments` component. Not one storage policy
changed.

`ItemSheet.test.tsx` pins the control's absence under a quote, the value/invoice-number/day round
trip with its day-first date, the refusal of a payment with no figure, what is paid and what is
still to go read off the rows themselves, a correction going through `updatePayment` rather than
adding a second payment, the un-normalised load, and both halves of *Not paid* — silent on a bare
row, asking on one somebody typed.

**Editing a price is three fields: who from, what exactly, the amount.** Kind and paid-ness used to
live in the same form as a chip row and a hint paragraph; both are decisions now made from the
header, and a correction that could also silently move an invoice to a quote is exactly the
kind of two-controls-for-one-fact this codebase keeps removing elsewhere. The date field is gone
with them — nobody was asking "when was this quoted" often enough to earn a permanent box, and nothing
downstream reads it. `updateQuote` still accepts `dated`; the sheet simply never sends it, so an
edit leaves a date typed before this change exactly as it was.

**A second price is no longer created through this sheet**, and an item that already had more than
one before this change keeps every one of them — shown read-only, under *Also on record*, each
still removable. Hiding them would be lying about what still counts in the rollup; the only thing
that changed is that comparing them is no longer this sheet's job.

**Installed moved out of the header and became its own control.** It used to be one of four chips
sharing a row with Considering/Chosen/Ordered — the only one of those four anybody could tell apart
from the others, since the rest collapsed into "the price is being sorted out" the moment Quote and
Invoiced took over that meaning. It is the one state still changed by hand, because only a person
knows the dishwasher is actually sitting in the kitchen, and it is what lets *Record it in the
house record* offer itself once something is genuinely in.

**And it asks in two named halves, where it was one tick.** *Is it in?* · **Yes** · **Not yet**,
in the app's one chip shape — a sunken well, solid fern on the half that is true, ~34px inside a
48px target. A single tick has one lit state and one unlabelled one, so *not installed* was only
ever the absence of a press, indistinguishable from nobody having got to it yet — on the one fact
that decides whether the handover list offers this row at all. It is the argument the GST pill
and the You tab's project switch both make. Pressing the half already lit writes nothing.

**The sheet no longer asks what an item is twice.** It opened on a title box reading *"What is
it?"* and then asked *What exactly* four rows down in the price form — two boxes for one fact,
because on a line item they **are** one fact: a toilet is a toilet whether it is being named or
being priced. So *What exactly* names the row, the heading shows what is being typed rather than
asking for it again, and a sheet walked away from without saying what it is still writes nothing
at all — the guarantee the old two-step gave, on the same terms. An item that already exists
keeps its title box, because renaming is a real act.

**Save is at the foot of the sheet and says only *Save*.** It read *Save this price* and sat
directly under the amount, which put the one button that commits anything half way up a sheet
that keeps scrolling past it. It is outside the ScrollView now, for the reason the snag page's
bar is the last flex child: a button that scrolls away is a button people assume is not there.
By the time a thumb is down there, the form above it is what is being saved, and naming it twice
was the button repeating the field it belongs to.

### Adding an item is a pill and a modal, not a box and a +

Every part of the job carried a text field reading *Add an item* with a `+`
beside it, and *Also expecting* carried a bare `+` at the end of its heading
rule. Both are replaced by **the app's one pill** — sunken well, no border, the
label inside it, ~34px in a 48px target, exactly as `FoldAllPill` is — reading
**Add an item**, and both open a modal.

Two reasons, and the first is the one that matters. **The inline box was the
compose bar's gesture in the wrong place.** That gesture is right for a snag
filed in ten seconds standing in front of the problem; a renovation's line item
is named at a desk beside a quote, which is the same argument that keeps the
compose bar off the House tab and off this one. And it could only ever take the
**name**: `create_item` accepts notes too, and there was nowhere to type them,
so anything worth remembering about the item had to be added by opening it
again straight afterwards — the one journey this app keeps removing.

Second, **a bare `+` at the end of a rule reads as punctuation on the heading**
rather than as something to press, which is the same thing the list tab already
decided when a chevron beside muted text turned out to read as a caption.

**And the modal the pill opens is `ItemSheet` itself, not a smaller one in
front of it.** For one commit it was its own sheet asking a name and a note and
then shutting — which fixed the inline box and immediately bought back the
journey it was supposed to remove. The next thing anybody does with a new item
is put a price on it, and that lived one screen further in, so naming a toilet
was: pill, name, *Add it*, find the row, tap it, and only then the form. Two
modals and five presses for one act, on the page whose entire redesign was
about what a bill costs to record.

So the pill opens the item's own sheet, the **title is a box**, and everything
an item can hold — the price with its GST pill, installed, the notes, the
paperwork — is on screen from the first keystroke. `AddItemSheet` is deleted
rather than kept for the create case: two sheets for one noun is how they drift
about what an item is.

**The row is created the moment the name is committed**, and that is the rule
to keep. `create_item` refuses an empty name in words, so a sheet opened by
mistake and walked away from writes **nothing at all** — the same guarantee the
two-step gave, since what it really turned on was the name and never the button.
What changed is only *when*: on the blur of the title rather than on a press.

Every control below the title calls `ensureItem` before it writes, and that is
not belt-and-braces. **On native a press does not reliably blur a `TextInput`**
— this file already says so about the snag page's Save button — so typing
"Toilet" and reaching straight for the amount is *one* gesture that has to
create the row on its way past. Without it that gesture would write nothing and
say nothing, which is the precise failure a Save button exists to prevent. An
empty name at that moment is said under the box, in `create_item`'s own words,
rather than as a toast: it is a fact about the box.

The same box **renames** an existing item, because naming and renaming are one
act. An emptied name is put back rather than stored — the create path refuses
one and so does this.

**The price is in the sheet because the sheet is where the price lives**, not
because adding gained a second place to enter an amount. There is still exactly
one: `onAddQuote` now takes the item id, so a price saved before the row
existed creates it first and hangs the quote off the real id. Only the name is
ever required, for the reason the thing walkthrough gives — a field somebody
must fill in before they can record what is in front of them is how a record
ends up empty.

*Also expecting* keeps its own pill and its own sheet: an expected cost is a
different row with a different shape, and it has never had a second screen in
front of it.

`ProjectDetailScreen.test.tsx` pins the pill replacing the box rather than
merely relabelling it, that the pill opens the item sheet already pointed at
the part it was pressed inside, that nothing is created until it is, and the
same pill under *Also expecting*. `ItemSheet.test.tsx` pins the rest: the whole
sheet being there from the first keystroke, the row created on the title's
blur, a price saved without blurring creating it on the way past, a sheet
walked away from writing nothing, the rename, and the emptied name going back.

### Include or exclude, without deleting it

Every item under *Parts of the job* used to carry a tick on its left — *decided*, in the words of
the comment that explained it, not *done*. The item's price could still be wrong for the household,
though: a vanity gets swapped for a cheaper one after the fact, or an item turns out to already be
covered by the builder's contract and pricing it again would double it up. Until now the only way
to stop an item counting was deleting it, which throws its quotes and its history away with the
decision not to buy it.

**`excluded` is the other option, and it is a toggle on the right, not the tick on the left.** The
tick's job — telling committed items apart from undecided ones — is what the amount column already
does; a second control saying the same thing a second way is exactly the duplicate-control failure
this codebase keeps naming. Include/Exclude is a different fact, and it lives where a fact that
isn't "open this row" belongs — the far side, as its own sibling `Pressable`, never nested inside
the row's own tap target, for the reason opening and removing a photo are siblings everywhere else
in this app: one `Pressable` inside another is a coin toss about which one gets the tap.

**Excluded stays on the record and keeps its own price.** `project_items_with_totals` and
`project_scope_money` at the item level are untouched by the flag, so opening an excluded item
still shows what it would have cost — greyed in the list, never struck through, because this is
not done, it is simply not counted. What changes is everything the item rolls *into*:
`project_elements_with_totals` skips an excluded item's committed, invoiced and paid when summing
its part, and its quotes drop out of *Who's owed what* and the bills due, so "the supplier rows
sum to committed" — the invariant the whole money model is built to keep — stays true rather than
counting money for work the household decided against. `home.set_item_excluded` is its own
function for the same reason `set_part_bought` and `set_quote_status` are theirs: the only write
here that changes what a total says, so it cannot have anything else riding along with it.

### What a press costs, and why parallelising it made things worse

The project page felt slow and the database had nothing to do with it. Every
query behind it runs in single-digit to low-double-digit milliseconds —
`projects_with_totals` is the worst of them, and it is a view whose *planning*
costs more than its execution. The cost was never the SQL.

**The first fix was the right diagnosis and the wrong prescription.**
`getProjectContents` had been six sequential round trips and `load()` three
more, so they were batched: two waves, everything independent fired together.
That removed the latency and created a far worse failure, because **PostgREST's
pool on this project is ten connections**. One open of the page fired fourteen
requests and one chip press eleven. Past ten they queue; a queued page looks
like a page that ignored the press; the press comes again with eleven more.

It is a congestion collapse and it is in the logs. One minute of the live job,
21 September 15:43 — a quote recorded, two corrections, then a toggle pressed
three times in one second:

```
15:43:10  create_quote      → 14 reads, all 57–452ms
15:43:15  update_quote      → 11 reads, 190–662ms
15:43:21  update_quote      → projects_with_totals  17,354ms
15:43:23  update_quote  ×2  → items 12,945ms, elements 13,847ms
15:43:29  set_item_excluded ×3 in one second
15:43:42  add_payment       12,061ms
15:44:08  still draining
```

Over 24 hours: 227 PostgREST *Thread killed by timeout manager*, 14 statements
cancelled at the `authenticated` role's 8s `statement_timeout`, and ten HTTP
500s — from one household with one project. **Making any single query faster
would not have touched this**, which is the thing to remember before optimising
a query here again.

Four rules now, and the second is the one that matters:

- **A toggle answers before the network does.** Include/Exclude, Quote/Invoiced,
  Accepted/Declined and Paid/Not paid all patch local state on press, write,
  then reconcile. A refused write **puts it back** and says so — optimistic is
  not the same as dishonest, and a control that silently keeps a state the
  server rejected is worse than one that was slow. Only columns the client can
  predict exactly are patched: `kind` and `status` are plain values, and
  `unpaid` is set to what paying the outstanding balance must leave. Anything
  derived in a view is left to the re-read.
- **The page is one request.** `home.project_page` returns the project, its
  parts, items, prices, lines, payments, milestones, expected costs, bills,
  suppliers, files, handover things and punch list as one `jsonb` object —
  reading **the same views with the same filters and the same orders** the
  fourteen separate reads used, so no figure can be arrived at a second way. It
  is SECURITY INVOKER over `security_invoker` views, so RLS filters it exactly
  as it filtered the REST calls; a non-member gets the refusal `.single()` used
  to give. plpgsql rather than SQL because the raise is what the client already
  words.

  **One request, but seventeen statements inside it.** It was written as one
  `return jsonb_build_object(...)` holding every subquery, on the belief that
  plpgsql would plan it once per connection. It did not: that statement was
  re-planned on every call, and planning seventeen views-of-views at once was
  nearly all of its cost — a 1.6s mean over 289 calls, a 7.9s worst, and
  once 11.5s against an 8s `statement_timeout`. It lived just under the line
  until the list card started reading it too (*Budget remaining*), and then
  the Downstairs job would not open at all. `20260926100000` gives each key
  its own `select … into`: the same views, filters and orders, output
  byte-identical on every project, and ~0.3s warm, 0.4s cold. **Do not fold
  it back into one statement** to tidy it.
- **A refresh is single-flight, and the next one is queued rather than started.**
  One arriving while another is in flight sets `pending` and returns; the one
  running loops. However many presses land, there is at most one read on the
  wire and one more owed. This also removes a bug that had never been noticed:
  with two reloads in flight the older could land last and silently revert a
  change the server had accepted.
- **There is one reload, not two.** `reloadMoney` and `load` are gone. There is
  nothing to save by fetching less when the whole page is one request, and the
  split had required all 29 write handlers to answer correctly which of the two
  they owed. The seven single-purpose reads they used — `getProjectContents`,
  `getProjectFiles`, `getSupplierTotals`, `getProjectThings`, `getExpectedCosts`,
  `getProjectBills`, `getExpectedCostLines` — are **deleted rather than left
  exported**, because a dead one sitting beside `getProjectPage` is an
  invitation to fetch the page the slow way again without noticing.

**One thing was genuinely given up, rather than preserved quietly.** Three of
the fourteen reads were `allSettled`, so the suppliers rollup, the handover
offer and the punch list could each fail while the money strip still drew. That
guarded against *one endpoint* failing and there is one endpoint now. The page
says it could not load instead of drawing a renovation's Committed total with
the supplier rows silently missing — which is the better answer anyway, by this
file's own rule that a total never appears without what it is made of.

**`project_files` is the view to watch.** `projects_with_totals` counts it in a
lateral for `file_count`, so every read of a project card, the Schedule tab and
the You tab's loose ends pays whatever it costs. It was still calling
`home.quote_reach(q.id)` per row — the four-table join `20260921093000`
replaced everywhere else with the stored `reach_project_id` — and fixing that
alone took `projects_with_totals` from 149ms to 53ms and the whole page read
from 414ms to 242ms.

`ProjectDetailScreen.test.tsx` pins the flip happening while the write is still
pending, the revert on a refusal, one read per press, and — with a read that
does not settle until the test says so — that three presses in one gesture
still put exactly one write and one read on the wire.

### The parts of the job fold independently

`openElements` is a Set, not a single id. It was one id, so opening the laundry
shut the bathroom — the wrong model for a page somebody reads two parts of side
by side, and it made the second tap feel like the first one had been undone.
Each heading is now its own answer.

The money strip above it is deliberately the other way: **one breakdown open at
a time**. That is a five-row strip at the very top of the page and two open at
once pushes the work itself off the screen, where two open parts are exactly
what somebody is comparing.

### A budget has parts, and the gap is named rather than resolved

`project_elements.budget` carries each part's share. **`projects.budget` stays and stays typed.**
A renovation is budgeted top-down and broken down later, the breakdown deliberately does not add
up (the contingency lives nowhere), and a derived figure that silently replaced the typed one
would be the app insisting somebody did not mean what they typed. So both exist and the page says
*"parts budgeted $172,000 of $180,000 · $8,000 unallocated"* — the denominator rule, applied to
budget.

**The Budget row is tappable, and it is a plain edit rather than an override.** Every other figure
in the strip carries the derived/override pattern — a build-up of prices sitting beside whatever a
person typed over it — but budget has no build-up to sit beside: it is the one figure on the page
nobody adds up from anything else. So `EditBudgetSheet` is a single `MoneyField` and a Save, not
`EditFigureSheet`'s comparison against a derived number, and leaving the box empty clears the
budget rather than asking for a second control to do it.

**And they are stacked down the page, not laid across it.** They were cells in a row, which works
until a renovation gets past five figures and one of them has to hold `$192,354.22` in a third of
390pt — it wrapped mid-number and the whole strip went ragged. It is the same failure the thing page's spec sheet already fixed by un-columning itself: a
two-column row has nowhere to put a long answer, and a project's totals are the longest answers in
the app. Label left in a fixed column, figure right-aligned and pinned to `numberOfLines={1}`, so
the three share an edge the way a column of money is read. The same rule covers an item's own price
— it does not shrink, the name beside it does, because the figure is what the row is opened for and
**half a number is worse than a clipped noun**.

**A row shows a figure wherever there is one to show, and says in colour whether it counts.**
An item whose one price is still a quote nobody has accepted read **"1 price in"** — a count of
one, standing where the money goes, on the row somebody is scanning precisely to find out what
this part costs. The number is right there and was being withheld to say something the row could
say another way. So `itemPriceLabel` returns the undecided quote's own amount, rendered in
**slate** — the palette's blue, which already means *open*, against ink for a figure that is
committed. Two states, one glance, and no hue invented for it.

The count survives for the one case it was ever the honest answer: **more than one price in and
nobody has decided between them**, where there is no single figure to show and *"3 prices in"* is
exactly what is true. `Not priced` is still its own answer, because nothing is not zero.

### GST is a fact about each amount, never a household setting

New Zealand quotes come both ways — a trade supplier writes ex-GST, a retailer writes inc — and the
difference is 15%, which on a renovation is the difference between on budget and two thousand over.
So **every money column is a pair**: the number as it was typed, and `*_incl_gst` recording what
that number meant. `MoneyField` puts the pill beside every box, defaulted to *incl*, as **two named
halves rather than one chip that toggles** — one chip leaves the other answer as the unlabelled
absence of a press, and here that unlabelled answer is worth 15%. The same argument that made
capture's priority step two named pills, back when it had one.

The line under the box shows the *other* figure as it is typed, which is what makes it trustworthy.
**Nothing is converted on save**: the figure stored is the figure typed. The rollups normalise to
**inclusive**, because that is what leaves the bank account, and `home.incl_gst` is the single place
the arithmetic happens server-side — `inclGst` in the query package is its client twin and
`projects.test.ts` pins that `GST_RATE` is the 0.15 the function uses. If those two ever disagree,
the figure on screen and the figure in the rollup disagree, and the one people would trust is the
wrong one. Every extract says *all figures incl GST* in its subtitle, because a forwarded PDF is a
copy of these numbers nobody can ask a follow-up question about.

### Files belong to one level, and they roll up rather than down

A council consent belongs to the project; a tiling quote belongs to the item it prices. **Every
level takes photos and PDFs**, through one `Attachments` component rather than four copies of the
upload rules — it inherits every rule the thing page already paid for: one photo control (the
phone's own sheet offers *Take Photo* above the library), several at once capped at
`PHOTO_PICK_LIMIT` with the cap said out loud, one write at the end, one upload after another
rather than in parallel, what arrived is kept, opening and removing as siblings, and a PDF opened
with a signed URL rather than embedded (`object-src 'none'`).

**`home.project_files` is the union that rolls them up**, and it names which level each file came
from — and, since `20260926090000`, who it came from and payments' files too. So the project's page shows the whole folder with a line saying where each file lives, and
opening the bathroom does *not* show the project's consent — because that document is not about the
bathroom. No second bucket: `home-photos` under `<household_id>/docs/`, through
`HOUSEHOLD_FILES_BUCKET` and `getFileUrl`, so not one storage policy changed.

### What it joins to, and what that deliberately does not do

- **`snags.project_id`** — the punch list, in the app's own word: the defects list at the end of a
  renovation is literally a snag list, which is where the word comes from. A project does not get a
  to-do list of its own; it gets a filter over `home.snags`, and those jobs sit on the List tab in
  their rooms with everything else. One place work lives, or neither is trustworthy.
- **Filing a snag against a project does NOT start it.** `project_id` is excluded from `v_started`
  in `update_snag`, exactly as `thing_id` is: naming which renovation a dripping cistern belongs to
  is the tail of capture, the same gesture as tagging the room. A link that marked twelve jobs
  'doing' at once would empty the status from the other end than the retired *Start it* button did.
- **`things.project_id`** and **`things.project_item_id`** — what the project left behind, and the
  payoff for keeping the record at all. Three years on nobody asks what the laundry cost; they ask
  what the model number of the machine is and whether it is still under warranty. The thing page
  carries an *Installed during* row through to the project, where the invoice is attached to the
  quote that bought it. Both are carried into `create_thing` rather than written afterwards — a
  create-then-update is two chances to write half of it.

  **`project_item_id` is what lets the handover stop asking.** `project_id` alone could say a
  record came out of a renovation but not *which* item it came out of, so a checklist had no way
  to stop offering the dishwasher it put in the record last week. Not unique: a tiled bathroom
  leaves a tile record and a grout record from one line item.
- Both are **`on delete set null`, never cascade**: deleting the record of the renovation must not
  delete the washing machine, and what was wrong with the cistern is still what was wrong.

### Projects can be put away, per person

`profiles.projects_enabled` (`20260920090000`), written by `home.set_projects_enabled`. A
renovation is a third noun and not every household has one, so somebody with no project in
progress was paying a tab — a fifth of the only navigation this app has — for a feature answering
nothing about their house.

**It is the one setting in this schema that belongs to a person rather than to the house**, and
that exception is the thing to hold on to. Everything else it remembers is per household or per
property, because there is one house and two people disagreeing about whether it has a dryer is
not a state worth modelling. This is not that: it is a statement about what one person wants on
their screen, and one member putting Projects away must not take it off the other's phone. Stored
server-side rather than on the device for the reason `last_reported_property` is — a preference
kept in a browser resets on the next phone. Default true, so nothing changes for anybody who never
opens the setting.

Three things follow from the answer:

- **The tab is not registered**, rather than hidden with a null tab button. A route that exists but
  cannot be reached is one deep link away from a screen the person has said they do not want, and
  both `snag://` and the web build have deep links. `ProjectDetail` *does* stay on the root stack,
  though: a `/projects/<id>` link somebody was sent before they turned it off should open the page
  rather than fall through to the list with no explanation. The setting is about what the app
  offers, not what it refuses when asked directly.
- **The punch list goes with it.** A job filed against a renovation is reachable from that
  renovation's page, and with the tab gone there is no page — so what would be left is a row naming
  something nothing can open. `excludeProjectSnags` on `SnagFilter` adds `.is('project_id', null)`.
- **It is asked of Postgres, never filtered afterwards.** The header count, the shopping pill, the
  Schedule tab, the loose-end list and both extracts each read snags separately, and a subtraction
  applied in one of them is five screens disagreeing about how much there is to do. The Schedule
  tab also skips `getAllProjects()` entirely, since the fifth kind of mark is a read of dates set
  on a page that is no longer reachable.

Two named halves on the You tab rather than a switch, the same argument the GST pill and capture's
priority pills made: one control leaves the other answer as the unlabelled absence of a press, and
here that unlabelled answer removes a tab. Pressing the half that is already lit writes nothing.
The write goes through `reloadAccount()` rather than local state, because the answer decides
whether a *tab* exists and the navigator reads it off the profile in context.

`ProfileScreen.test.tsx` pins the two halves, the no-op press, the re-read after the write, the
hint naming what else goes, and both reads being skipped once it is off.
`ScheduleScreen.test.tsx` pins the filter reaching `getSnags` and `getAllProjects` not being
called.

### A bill can be emailed in

Every project has an address, `<token>@bills.snaghq.co.nz`, and a bill **forwarded** there lands on
that project as a card in the *Bills waiting* deck — the `invoice_reviews` waiting room that
`20260922100000` built and nothing had ever put a card in. `20260924090000` is the door. The deck
is the prompt: opening the project shows what arrived, and nothing counts until somebody allocates
it.

**One address per project, not one per household.** The link between a bill and its job is then a
fact the address carries rather than a guess somebody has to check — and a guessed job is the
field on a card most likely to be approved without being read. `projects.inbox_token` is minted by
`home.project_inbox_token` the first time anybody opens *Email bills to this job* (in the money
sheet, under *What have you got?*), so a project nobody emails has no address to leak.
`rotate_project_inbox` replaces it, quietly and without asking, because an address that got out is
exactly when somebody presses that.

**Only the addresses people sign in with are accepted.** `home.inbox_for` returns a sender only when
their `auth.users` email is on that project's place. Forwarding is the gesture; accepting mail from
anyone holding the address would make a leaked address a way to put cards in front of somebody that
look exactly like their builder's, and the only defence would be reading every one. The token is
sixteen hex digits and is **not** the security model on its own — the sender check is.

**`supabase/functions/inbound-bill` does the work, and it is the second place the app calls a
model.** Resend receives the mail and posts `email.received`; the function checks the Svix
signature (JWT verification is off — Resend has no Supabase token — so the signature is the lock),
finds the project, fetches the attachments, stores PDFs under `<household>/docs/` and photos beside
the others (the app's own layouts, so no screen needed changing to open them), asks Gemini what
**each paper** is, and files **a card per paper** through `home.file_emailed_bill` — see *One
email, one card per paper* below. Four rules:

- **It answers Resend at once and works afterwards** (`EdgeRuntime.waitUntil`). Reading a PDF takes
  longer than a webhook waits, and a retried webhook is a second set of cards — which
  `file_emailed_bill` refuses anyway, one card per email id and paper (`invoice_reviews_one_per_part`,
  which replaced both older indexes; the one keyed on `invoice_number` also refused two papers in
  one email carrying the same number).
- **Every field is checked before it reaches a card** (`paperFromReading` in `bill.ts`, pure and
  pinned by `inboundBill.test.ts`). An amount must be a positive number; a date must be one the
  calendar has; a GST basis the bill did not state defaults to *incl* **and is marked guessed**, so
  the card says it beside the figure; and a paid flag with no sentence behind it is dropped, the
  rule the review table was built on.
- **A reading that fails still files the card.** The bill arrived; the card carries the PDF and the
  subject and the person types the rest. A card that silently never appeared would be the worst
  outcome, and it is also why a missing Gemini key degrades to unread cards rather than to nothing.
- **Fifty a household a day**, counted in `file_emailed_bill`. A renovation does not produce that
  many bills; a mail loop does, and the key reading them is the operator's.

**The card now opens what came with it and can be corrected.** It lists the attachments (the
invoice is what every field has to be checked against), marks a guessed supplier or figure, and
its pencil opens `ReviewEditSheet` — who from, what for, the amount with its GST pill, the numbers
and dates, and **which part of the job**, which nothing reading an email can know. That writes only
to the card; allocating is still the card's own button, and it now carries the attachments into
`create_quote` so they become the bill's paperwork and roll up into the project's files.
`20260924090100` makes answering the GST pill or the description clear their *guessed* mark, which
it did not. Deleting a card from the bin clears its files too, since nothing else points at them.

`inboundBill.test.ts` pins the address parsing, the signature (a changed body, a wrong secret, a
stale timestamp, a rotation's two signatures), the attachment filter (the signature logo dropped,
PDFs first, the caps), the stored paths, and every refusal in `paperFromReading`.
`InvoiceReviewCard.test.tsx` pins the attachments and the guessed marks; `ReviewEditSheet.test.tsx`
the load, the one write with an emptied box as a clear, the part chosen, no part offered while the
layer is implicit, and a date the calendar has not got holding the sheet open.

**Setup is outside git** and is in `SNAG_INFRA_NOTES.md` under *Resend*: the `bills` MX record,
`RESEND_INBOUND_API_KEY` and `RESEND_WEBHOOK_SECRET` as function secrets, and the function deployed
with `--no-verify-jwt`. **Nothing sends anything**: no reply to the forwarder, no notification. If
a forward does not appear, the function's logs say which of the four reasons it was.

### One email, one card per paper

The first real email forwarded to a job carried four PDFs and a photo: the builder's variation
invoice (INV-0184), a plumber's and an electrician's variations **made out to the builder**, the
electrician's certificate of compliance, and a picture of the deck. It landed as one card, and had
the model been answering it would have been asked for one supplier and one total from five papers.
There was no way to allocate the invoice and file the certificate, and the two subcontractors'
variations are already inside the builder's invoice — recorded as bills to the household, the same
money counts twice. `20260924120000` is the fix, and it has four parts.

**Each paper is read on its own.** `inbound-bill` sends every attachment to the model as its own
request (`read.ts`, in parallel so ten papers cost about what one does), with the email's words
beside it and the other papers named only so it knows to ignore them. A figure or a name on one
paper cannot be read off another, because the model is only ever shown one. The attachment cap
went from five to ten.

**A card says what kind of paper it is** (`invoice_reviews.kind`): **invoice**, **quote** or
**paperwork**. The model also answers *photo* and *nothing*, which never become a kind of their
own: photos of the work share one *Photos* card, filed as paperwork, because six pictures of a
deck are one thing to put on the job rather than six decisions. `cardsFromReadings` decides the
cards and is pure; every file lands on exactly one card, and a PDF nobody could read is still an
invoice card with its kind marked *guessed*, which is what the one card per email always was.

- **An invoice** allocates exactly as before.
- **A quote allocates as a quote, `tbc`.** `approve_invoice_review` used to hard-code `invoice`, so
  an emailed $49,482.20 deck quote would have landed in *Invoiced* and *To pay* unsigned. It is
  never paid and has no due date.
- **Paperwork is filed, never allocated** — `approve_invoice_review` refuses it in words.
  `file_review_paperwork` appends its files to a bill on the job, a part, or the job itself, so
  they roll up through `project_files` like any attachment, and **no figure moves**. The card's
  button says *File it*, never *Allocate*, and `FilePaperworkSheet` asks only where: the bill from
  the same business first and chosen already (`paperworkHomes`, matched on `businessKey`, which
  reads *RELIABUILDER LIMITED* and *ReliaBuilder* as one business), then the job and its parts, then
  every other live bill. A declined quote is never offered.

**A bill made out to somebody else is paperwork, with the name kept.** The model is told who is on
the job (`home.project_people`) and asked whether each bill is made out to them. Only a plain *no*
turns a bill into paperwork, with `addressed_to` set, and the card says *"Made out to
ReliaBuilder, not you — kept as paperwork so it isn't counted twice"*, the figure beside it muted
and counted nowhere. A bill that names nobody stays the household's, because that is the ordinary
case. Paperwork is also kept out of the duplicate check: a subcontractor's variation can carry the
figure of a line on the builder's invoice, and a warning about that would teach people to ignore
the warning.

**A blank card can be read again.** On the day this was first used every model answered 503 for
three minutes and three of four cards arrived with nothing on them, with no way to try again. A
card nothing was read off (`isUnreadReview`, the same test as `home.review_is_unread`) shows
*Read again*, which calls `reread-bill`: it downloads the card's files **as the caller**, reads
them exactly as the inbound function would, and `home.refile_review` replaces the blank card with
the cards that reading makes — one or several. Three refusals keep it honest: only a pending,
blank card (a reading must not throw away somebody's answers); only files the card already held;
and **every** file it held, because a file no card points at is one nobody can open or delete.
Nothing changes when nothing was read, and the toast says why in words. It spends one of the
household's fifty daily model reads per paper, the ceiling label reading keeps.

The cards from one email stay visibly one email: the page groups them (`reviewGroups`) under a
line counting what arrived — *"Fwd: Variations — 1 bill · 3 to file"* — so what was forwarded can
be checked against what landed. A card nothing could be read off is named by its own file rather
than the subject every card from that email shares.

`inboundBill.test.ts` pins the one-paper request, a bill made out to somebody else becoming
paperwork, a quote and a certificate never paid, and `cardsFromReadings` — a card per paper, every
file on exactly one card, photos gathered, an unread PDF an invoice with a guessed kind.
`supabase/tests/emailed_papers.sql` replays the Variations email through the functions: a retried
part filing nothing, the pre-migration call still filing an invoice, paperwork refused by
allocate and filed onto the builder's bill and the job without moving Committed, a quote staying
`tbc` and off the bills, and `refile_review`'s three refusals. `FilePaperworkSheet.test.tsx`,
`InvoiceReviewCard.test.tsx`, `ReviewEditSheet.test.tsx`, `invoiceReviews.test.ts` and
`ProjectDetailScreen.test.tsx` pin the rest of the page.

### A bill can be inside another bill

The Variations email showed the gap the reader cannot always close. Good Connections' invoice said
it was made out to "Relia Builder LTD", so it became paperwork; Force Plumbing's did not say, so it
came in as the household's own bill and the $1,138.71 inside ReliaBuilder's INV-0184 counted twice.
A reading can only see what the paper says, so **a person has to be able to say it too**.

*Part of another bill?* on `PriceSheet` points a bill at the one it is inside. **It is not a new
column and not an "ignore" flag**: it writes `billed_through_id`, which every rollup already reads as
*passed through* — the invoice leaves Invoiced, Paid and the scope's fallback in
`project_scope_money`, the supplier rows and `project_bills` — so not one view changed and the
supplier rows still sum to Committed. `agreedContribution` drops it the same way, so the room
breakdown agrees. Two rules:

- **It names the bill, never merely "ignored".** A figure that stops counting says why, in words the
  paper can be checked against: *Inside RELIABUILDER LIMITED · INV-0184 — not counted on its own*. A
  generic ignore switch is a way to make any figure vanish with no reason on record, which is the
  shape the override rules exist to refuse.
- **The bill it is inside says what it includes**, with *the rest of this bill* as the figure the
  builder charged for their own work. That is the reconciliation somebody would otherwise do by hand.

Offered only on a bill of its own (`billHosts`, `papers.ts`): not on a progress claim, which counts
through its contract already; not on a price answering a set-aside, where the same link means
billed through the builder's contract and `ThingSheet` decides it; never pointing at a bill that is
itself inside another, because a chain leaves the reader following links to find what counts; and
not on a bill that already holds others. The room sheet lists an inner bill under its host, as it
lists a claim under its contract. `billsInside.test.ts` and `PriceSheet.test.tsx` pin it.

### Expected to pay, and the bill that pays it off

The Downstairs job had two of the builder's four claims earmarked as expected costs (*Reliabuilder
payment 3/4* and *4/4*, $43,987.50 each). When claim 3 arrives it is recorded as a bill and the
earmark goes on counting, so the Expected total, *Over budget* and the list card carry the same
claim twice until somebody deletes the earmark by hand — which also loses what was guessed.
Measured on the live job, rolled back: recording claim 3 took Forecast from $234,230.18 to
$278,217.68; linking it put Forecast back to $234,230.18 with Committed up by the claim and the
supplier rows still summing to it.

**No migration.** `project_expected_costs.settled_by` has always been that link, every rollup
already drops a settled expectation, and `update_expected_cost` already refuses a bill from
another job. Nothing in the app ever set it. Now three places do, and one undoes it:

- **The money sheet.** A bill or receipt from the business an earmark names, within 10%, shows
  *Pays off Reliabuilder payment 3/4 · $43,987.50* under the invoice number, **ticked** (the user's
  choice: a line to tick every time is one that gets forgotten). *Not this one* steps to the next
  match and then to none. Saving creates the bill, then links it. A refused link never holds the
  sheet open over a bill that exists, because saving again would record it twice — it says so, and
  leaves it to *Billed*.
- **An emailed bill.** The same line on `InvoiceReviewCard`; allocating links the quote
  `approve_invoice_review` returns. `matchExpectedEach` takes the waiting cards oldest first and
  sets each one's best match aside, so two claims waiting side by side offer 3/4 and 4/4 rather
  than 3/4 twice.
- ***Billed*** on the earmark opens `SettleExpectedSheet` — *Which bill paid this?* — for a bill
  already on the job, with *Record the bill* opening the money sheet filled in from the earmark and
  already paying it off. A tap on *This one* links it; a pill, not a chevron, because it is a choice
  rather than a door.
- **The bill's own sheet** says *Pays off …* with **Undo**, which clears `settled_by`.

**The match** (`expectations.ts`, pure, pinned by `expectations.test.ts`): the same business by
`businessKey`, read from `likely_supplier` or, when there is none, from a run of whole words in the
earmark's **name** — which is how the live earmarks were written, and whole words so "cabinet" is
not the business "AB". GST-inclusive both sides; **strong** within 1% or a dollar, **possible**
within 10% or when the earmark has no figure, nothing further out. Strong first, then closest, then
oldest. Only a live bill that counts on its own can settle one (not a quote, not declined, not
inside another bill); a progress claim can, since that is exactly what these earmarks are. One bill
pays off one earmark. And **a bill recorded before the earmark was made is never a suggested
match** on the *Billed* sheet — the deposit and claim 2 are the same $43,987.50 as claims 3 and 4,
and offering them would be offering to count a paid claim as the unpaid one. They stay listed
under *A bill on the job*, where a person can still choose one.

**On the page**: a full-width *Expected to pay* tile under *Paid* and *To pay* (three six-figure
figures at that size do not fit across a phone), the unpriced counted in words, and a section of
the same name under *To pay*, grouped by supplier with `groupBySupplier` so the two builder claims
sit under the builder. Both are absent when nothing is earmarked. The figure is every unsettled
earmark, agreed or not — it is what is still to be billed, not what is decided. Each row says
*agreed* or *undecided*, the words the top of the page files them under; never *estimate*, which is
a quote's `basis`.

`ProjectDetailScreen.test.tsx` pins the tile, the grouping, the absence, the sheet's link and its
*Record the bill*, and the card's tick, untick, refused link and the two-card split;
`MoneySheet.test.tsx`, `InvoiceReviewCard.test.tsx` and `PriceSheet.test.tsx` pin their halves.

### A file says what it is

A job's paperwork was a pile of PDFs by filename, and the one somebody gets asked for — the
certificate of compliance, at code compliance or by an insurer — could only be found by opening
every file. `home.file_tags` (`20260925090000`) tags a file **Compliance certificate**, **Product
sheet**, **Warranty** or **Other**.

- **The tag belongs to the file**, keyed by storage path like `label_readings`, not a column on each
  of the six arrays a file can live in. A file removed from its record stops being shown; a stale
  row names nothing anybody can see. Absence is untagged. Invoices and quotes are never tagged —
  the price they sit on already says what they are. `set_file_tags` takes several paths and checks
  each one's household folder against the caller.
- **The tags ride in `project_page`** (`fileTags`), limited to the files `project_files` shows, rather
  than a read per sheet — the pool is ten connections and every sheet shows files.
- **Set on the file**, as a pill beside each document in `Attachments` (on the job, a part and a
  price) opening `FileTagChips` — the app's one chip, wrapping because four long labels do not fit
  across a phone, and pressing the lit one clears it.
- **Asked when paperwork is filed**, because that is the one moment it is in somebody's hand.
  `guessFileTag` reads the card's words and filenames and lights a suggestion, said as one;
  compliance first, because a certificate's title often names the product it certifies; *Other* is
  never guessed. A card with no PDF is not asked — a photo of the deck is not a certificate.
- **Gathered on the project page** by `TaggedFiles` — *Compliance certificates*, *Product sheets*,
  *Warranties* — each row saying where the file is attached. A read over `project_files`, never a
  second place a file lives, and absent until something is tagged.

### A bill can be shared between rooms

A tile order goes on the bathroom floor and the laundry splashback. A bill could sit on **one**
part of the job or on the whole job, so that order was either filed under a room it only half
belonged to or under *Whole job*, where nothing said which rooms it was for — and "which tile went
in the laundry" had no answer on the record. `20260924100000` adds `home.project_quote_rooms`.

**The price stays on the whole job; the table only says how the room breakdown reads it.** A quote
attaches to exactly one level and every rollup sums it from there, so not one view changed:
Committed, Invoiced, Paid, the supplier rows and the bills are exactly what they were. What moves is
`projectSummary`'s room rows, which were already the rooms plus a *Whole job* **remainder** — a
share (`roomShares`) takes its slice out of *Whole job* and puts it on the room. **A wrong split can
put money in the wrong room and cannot make the total disagree with itself**, which is the property
`projectSummary.test.ts` pins. `agreedContribution` mirrors the views' rules to know what a whole-job
price puts in Agreed (a signed quote less its open set-asides; a bill unless it is a claim or a draw
on the same supplier's signed price) — and getting that wrong only leaves money on *Whole job*.

Three answers, not two, and the third is the one that keeps it honest:

- **No rooms** — the whole job.
- **Rooms, not split** — the contract covers the bathroom and the laundry and nobody itemised it.
  The rooms go on record (the room sheet lists the bill, *Shared, not split*) and the money stays on
  *Whole job* rather than a split the app invented.
- **Rooms and amounts.** Evenly is the default because it is the commonest true answer for materials
  bought for two rooms, and it is **stored as dollars**, worked out to the cent by `evenSplit` — a
  third of $1,000 is $333.34, $333.33, $333.33, never three rows and a cent left on *Whole job* for
  ever. By amount says as it is typed what stays on the whole job. Amounts are in the bill's own GST
  basis and are grossed with its flag; the server refuses shares that add up to more than the bill.

Only a price **on the whole job** can be shared: one on a part already says which room, one on a
thing is in its thing's room, and a **claim** counts through its contract, so the contract is what
gets shared. `set_quote_rooms` replaces the whole set in one call and touches nothing on the quote.
Taking a room off the job cascades its share away, which hands it back to *Whole job*.

**On a waiting bill the rooms are ticked, not chosen.** `ReviewEditSheet`'s single *Which part of the
job?* became `RoomSplit`: tick rooms, and *Add a room…* makes one there and then — a room of the house
through `create_location` if it is not one yet, then a part of this job through `create_element`,
ticked the moment it exists, because the moment somebody notices the laundry is in this bill too is
the moment they are checking the bill. `set_invoice_review_rooms` is the one writer of where a card
lands: one room puts the bill **on** that room, exactly as `element_id` always meant; two or more keep
it on the whole job and `approve_invoice_review` carries the rooms into `set_quote_rooms`. The card
says where it will land (*For*) before anybody presses Allocate. A price already on the whole job
takes the same control from a *Rooms* row on `PriceSheet`.

`split.test.ts` pins the cents and the read-back of a stored split; `projectSummary.test.ts` the
shares moving between rows and never the total, the partial split, the unsplit tag, the ex-GST
bill, the draw, claim and declined cases, and the over-share scaled back; `ReviewEditSheet.test.tsx`
and `PriceSheet.test.tsx` the picker, the three answers, the refusals and the room made in place.

### Four things that stay exactly as they are

- **No compose bar on this tab, ever.** A project is started deliberately, at a desk, like a thing —
  not in ten seconds standing in a doorway. The ten-second gesture would produce a project with a
  name and nothing else at the one moment nobody is at a workbench.
- **No notifications, still.** "Your quote expires Friday" would be the first thing in this product
  that speaks unasked.
- **No ghosts.** The House tab arrives furnished because a catalogue can guess a kitchen has a
  rangehood. Nothing can guess a renovation, and a suggested project would be a fabrication rather
  than a prompt — the ghost rule's own argument, one noun further on. Day one is genuinely empty,
  and the empty state names the second use instead: the renovation you have already done.
- **Done dims and sinks, and does not leave.** The list's rule is that finishing makes the list
  shorter, because the reward is the item going away. A renovation is the opposite — the finished
  one is the record you open in four years in front of a valuer — so it takes the same
  `opacity: 0.62` a parked repeat takes and stays where it can be found.

`ProjectDetailScreen` is a **push, not a sheet**, unlike SnagDetail and ThingDetail: those are a
dozen small decisions taken against a list still visible underneath, where a project is a page you
*read*.

**And it is ordered by question, not by schema.** It ran status, four figures, who's owed, parts,
punch list, handover, paperwork — which is the order of the data model and the order of no
question anybody asks. On a live job the questions are, in frequency order: *a bill arrived, where
does it go* (several times a month), *are we over* (every time the first one happens), *who have we
still got to pay*, *what's left to decide*, and — once, at the end, for four years later — *what
did the bathroom cost*. The first was the deepest buried: six levels down, and only if a scope item
already existed to hang the bill on, which is why the live job grew a part called "Whole job"
holding five supplier accounts wearing items' clothes.

So the page runs: **Record a bill or a quote** (the one filled button, and the first thing on it) ·
the money · **Who we're paying** · **Also expecting** · what we're doing · to sort out · hand it
over · paperwork. `RecordMoneySheet` is behind that button — see *Recording money is a
walkthrough* below. **It never creates scope for a bill.** An invoice maps to something that
already exists or it is a cost against the whole job; it does not get to invent a part, which is
the rule that stops another "Whole job" appearing.

`BuildUpSheet` is the screen that finally makes the provisional-sum rule reachable. Every rule
about allowances was written, granted and tested five months before it existed and had **never once
run against real data**, because nothing anywhere could create a line — the live contract was one
opaque $176,755 number, so none of the early warnings the feature exists for could ever fire.

**The rooms a job touches are answerable afterwards.** Step two asks once, which froze the answer at
the moment somebody knew least — a renovation grows a room more often than it loses one, and
finding out the laundry is coming in too is the normal middle of a job. The + on *Parts of the job*
opens `ProjectRoomsSheet`: every room as a chip, the ones already a part lit and inert (adding one
twice is two elements with one name and no way to tell them apart), *Add a room…* writing through
`home.create_location` like everywhere else, and underneath a naming box for **the parts that are
not rooms** — a renovation has a *Consent and council* and a *Scaffolding* that belong to no room,
and a picker alone would insist otherwise.

It replaced a free-text field, which was the wrong control: adding the bathroom meant typing
"Bathroom" and hoping it matched the tag the rest of the app files things under. **A picker is the
only control that cannot misspell the vocabulary.**

Removing one is a **×** on the part's own heading with a confirmation naming what goes in counts —
its items, their quotes and their files — and saying **the room itself stays**, because taking a
part off a job is not deleting a room. The server refuses the last one in words.

**A part that holds something asks for the word to be typed; an empty one does not.** Removing a
part with items or files on it destroys work that does not come back, which is the same shape as
deleting a place, so it takes the same gate — `ConfirmDialog`'s `confirmText`, set to **Delete**.
An empty part is a heading and nothing else, and it stays an ordinary two-button confirm:
demanding a typed word to remove a heading is the ceremony that teaches people to type the word
without reading the sentence above it, which is how the gate stops working on the day it matters.
**Files count as holding something, not just items** — a part with no items but a council letter
attached is not empty, and "Nothing is on it yet" would be the screen saying something untrue
immediately before acting on it. `elementHoldsSomething` is the one test both the wording and the
gate read from, so they cannot disagree.

Two smaller rules. **`delete_element` refuses the last one** — items hang off an element, so a
project with none is a project nothing can be added to. And **`set_quote_chosen` is its own
function**, for the reason `set_part_bought` is: it is the only write in the feature that changes
what a total says, and alone it cannot have its sibling-clearing skipped by a caller passing
`chosen` among eight other fields. The server clears the sibling *first*, because
`project_quotes_one_chosen` is a plain unique index and not a deferred constraint.

### Hand it over — what the renovation puts in the house record

A standing section on the project page, not a prompt at the end. The model number gets recorded
the week the thing goes in and the invoice is in somebody's hand — not eight months later, and
not only if the project ever gets marked done.

**It offers what is installed, and nothing else.** The items are already listed above under
*What it takes*, and offering all eighteen again puts the same list on the page twice; an item
nobody has fitted has nothing to record, because the model number is on the box. It is also the
subtraction the You tab's loose ends already make (`installed_count - thing_count`), so the two
screens cannot disagree about what is outstanding. Absent entirely while nothing is installed,
and capped at five with a *Show all* — the same sitting's-worth the loose-end list is capped at.

**Each row opens the walkthrough filled in, and you confirm.** Not a bulk write, and the rule is
the one the snag page already states about creating a thing from a job, with more force because
there are twelve of them: *a record created from here has to be as strong as one created on the
House tab, or this is the back door that fills the house record with rows nobody can read in a
shop.* Twelve confirmations is slower than one tap; an 8%-complete house record is worse than
none, and this is the exact door it would come through.

What is pre-filled: the name, the room from the part, the make from the accepted quote's
supplier, the model from its detail, the invoice as paperwork, and the installed date from the
invoice. **The supplier is not the make** — "Plumbing World" is the merchant and "Caroma" is the
maker — which is precisely why there is a confirm step rather than a bulk write. Photos are
deliberately not carried: a photo of a quote document is not a photo of the fitting, and the
thing page's strip is the one part of it that has to be worth opening.

### A schedule of claims, and nothing that reminds anybody

The builder bills 25% at each milestone. That lived in free text on whichever invoice turned up —
*"INV-0208 — claim 2, 25%"* — where nothing could read it, so the app knew about the claim in
front of it and nothing about the three still coming.

`home.project_milestones` holds them, and three rules keep it from becoming a second scheduler.
It is **optional and absent by default** (a tile shop takes payment and that is that), so it is
offered on a signed commitment and never asked for. **A milestone is not a bill**: it is what
somebody said would be claimed, and the claim is the invoice that arrives carrying
`settles_milestone_id` — which is what lets the page say *milestone 3 hasn't been claimed yet*
rather than only counting what has already landed. A milestone carries a **percentage or an
amount, never both**, said in words by `add_milestone` rather than left to the check constraint,
because two ways to say one number is two numbers that can disagree and this one gets multiplied
by a six-figure contract.

And **nothing sends anything**. This is the same rule as everywhere else and money does not bend
it — `ScheduleSheet` says so on screen, because a thing called a payment schedule is exactly what
somebody would expect to remind them.

### Nobody types Committed, Invoiced or Paid

All four are derived, and the only thing anybody enters is **one amount per price** plus three
decisions: whether it is accepted, what kind of paper it is, and — on a contract — whether its
number can move. Recording money that has actually gone out is a **payment against the invoice it
settles**, never a sibling row: a chosen $4,600 quote, a $4,600 invoice and an $1,840 payment
read as Committed $4,600, Invoiced $4,600, Paid $1,840, Outstanding $2,760. That is how a deposit
works, and it is why `home.add_payment` refuses a payment against anything but an invoice, in
words.

**A saved price can be corrected**, through a pencil beside the amount — the same affordance the
snag headline carries for the same job. It reuses the one form rather than opening a second sheet,
because the fields are identical and a separate editor is a second place the GST pill and the kind
chips would have to be got right.

Three things about it are load-bearing:

- **The box loads the figure as it was typed, never the normalised one.** The rollups work in
  GST-inclusive dollars, so a form that loaded $1,150 for a $1,000 ex-GST trade price would raise it
  by 15% every time somebody opened it to fix a typo in the supplier's name. Pinned.
- **A correction never carries `status`.** Accepting stays on `set_quote_status` for the reason
  above; a correction is not a decision, and routing it through the general update would be exactly
  the caller-with-eight-other-fields that function exists to prevent.
- **An emptied box clears the column** rather than leaving the old value — `updateQuote` turns a
  null into `p_clear`, the same convention `update_snag` and `update_thing` use. An emptied supplier
  is somebody saying they no longer know.

There is also a way out that does not save, because otherwise the only escape from a form opened by
mistake is closing the whole sheet and losing the item somebody was looking at.

`ItemSheet.test.tsx` pins the pencil, the un-normalised load, the day-first date round-trip, the
correction going through `updateQuote` rather than adding a second price, `chosen` never riding
along, the emptied field clearing, the way out, and the add control hiding while a correction is
open.

`projects.test.ts` pins the money rules as properties rather than examples — the denominator, the
unpriced item that is never zero, the GST gross-up, and that an extract states its GST basis and
gives an unpriced item its own row. It also pins the second pass: outstanding as committed less
paid rather than invoiced less paid and never negative, a bill and its payment never summing
together, a fixed price whose build-up is ignored beside an estimate's that is not, the allowance
variance in both tenses, "still an allowance" never collapsing into "not priced", the budget line
grossing an ex-GST budget before comparing, the parts budget naming what is unallocated rather
than rewriting the total, and an item committed on an invoice nobody ever quoted for.
`MoneyField.test.tsx` pins the two named halves and the other-figure line.
`AddProjectSheet.test.tsx` pins the new-room chip writing through the shared vocabulary rather than
keeping its own, the field staying shut until asked for and open when a name is refused, the new
room being selected without a second tap, the step still being skippable, and the whole of the
typed-and-not-ticked bug — committed on Next, on Skip and on Back, held open on a refusal, and an
untouched step still passing through untouched.
`ProjectsScreen.test.tsx` pins the grouping order, the dimmed done card, the empty day-one screen
inventing nothing, the absence of a compose bar, and that no total renders without its denominator
— which caught a real regression the moment the card started leading with a forecast, because
`describeForecast` is silent where there is none while the card still shows committed. It falls
through to `describeTotals` for exactly that reason.
`projects.test.ts` pins the forecast rules as properties: the denominator that always rides with
it, "still a guess" never collapsing into "still an allowance", the variance naming its cause and
staying silent under budget and inside 5%, an ex-GST budget grossed up before comparing, the two
gaps as separate subtractions with the over-claim reported rather than floored, `describeToPay`
absent at zero, and an allowance movement read in **both** directions — a design that only warns
on overruns never tells anybody they got money back.
`projects.test.ts` also pins the override rules: that a discrepancy line always names the derived
figure rather than only saying something was edited, that it reads in both directions, that a
typed figure matching the prices is stated plainly rather than reddened, and that edited parts are
counted rather than listed. `ProjectDetailScreen.test.tsx` pins the edited figure rendering in
clay, an untouched one not, and the discrepancy line staying off the page now that the sheet
behind the clay row carries it.
`ProjectDetailScreen.test.tsx` pins the implicit layer staying hidden, the layer appearing once a
real element exists, charged and paid staying apart with no "Spent" anywhere, the strip being five
figures with none of the eight sentences under them, an unpriced figure reading as blank rather
than as zero, no status chips anywhere, six-figure
totals on one line, the supplier section absent at zero and saying *Settled* rather than a zero,
the page surviving a failed rollup read, the handover list offering only what is installed and
stopping once something is recorded, that files roll up without rolling down, the + opening the
room picker rather than a naming box, the × naming what goes with a part, and no × while the layer
is still implicit.
`ItemSheet.test.tsx` also pins the three named states where a tick could only say "not chosen", a
declined price staying on the record, and a correction never carrying one. It pins the two named
halves of *Is it in?* — the no-op press on the lit one and the way back off — that the sheet asks
what an item is once rather than twice, that *What exactly* is what names the row, and that a
sheet walked away from still writes nothing.
`ProjectDetailScreen.test.tsx` pins the Quoted line and that it is the supplier rows' own sum,
each figure opening onto who it is made of, a supplier with nothing against a figure being left
out rather than drawn as a zero, the line that names the prices when an override means the rows
cannot add up, Budget and Forecast having no breakdown at all, *Who we're paying* being folded
with its count intact, and the parts of the job folding without shutting each other.
`projects.test.ts` pins `projectQuoted` as the rows' sum, null rather than zero where nobody has
quoted, and that a breakdown adds up to what it is a breakdown of.

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

Setting one up is **one tap on the *Repeats* row**, under the due date on the same card: *Never*
first and lit by default, then the presets. It was a yes/no card with the cycle and a second set of
date controls in a modal behind the Yes — see *the When card* under triage. A repeat with no date
on it would never surface, so choosing an interval sets one; an existing date is never clobbered.

## A date is typed or tapped, and never only tapped

Every date field in the app is a `DateField`: a box that takes what somebody
writes, and a calendar beside it that takes a day. Both, and **the typed half is
not the fallback** — that is the rule to keep if this is ever tidied.

A calendar can only say one exact day. `installed_at` on a forty-year-old villa
is honestly answered *"Nov 2019"*, or just *"1998"*, and `parseLooseDate` stores
a missing day as the first of the month while `formatLooseDate` then declines to
show it back — precisely so the record never claims a precision nobody offered.
Replacing the box with a picker would force everybody to invent a day. So the
calendar is an **addition**, never a replacement.

**`8/11/2019` is the eighth of November, never the eleventh of August.** This is
a New Zealand app and `dd/mm/yyyy` is what people write — and it is what the
calendar writes back into the box, so the two halves of one control round-trip
through `formatDayFirst` and `parseLooseDate`. Day-first was not merely
undecided before: the three-part numeric form matched no pattern at all and came
back `undefined`, so the most natural way to type a date was the one way that
did not work.

Two smaller rules that were each a real bug:

- **A two-digit year is refused, never guessed at.** `8/11/98` is 1998 on a
  villa's wiring and 2098 on nothing at all. The field saying it cannot read it
  is recoverable; a silently wrong century is not — and a wrong warranty date is
  not re-read until the day it matters.
- **Every branch is checked against a real calendar.** `31/02/2026` and
  `2019-13-45` come back `undefined` rather than reaching Postgres as a `22008`
  raised from inside an RPC, which is the failure `parseLooseDate` exists to
  prevent and which its numeric branches could previously still produce. The
  check is a round trip through `new Date`, because the constructor rolls 31
  February forward into March.

**The calendar is hand-rolled, and the dependency is the trap.**
`@react-native-community/datetimepicker` is a native module first, so on the
build people actually install it is react-native-web's problem — the same shape
of failure `Alert.alert` and `KeyboardAvoidingView` have already caught this
codebase out with twice. The deployed CSP is `default-src 'self'` with no CDN
reachable and `"output": "single"` means anything added ships in the one bundle
that has already paid 490 KB for the PDF renderer.

**And the arithmetic already existed.** `monthGrid` and `dayKey` were written for
the Schedule tab, so this is a rendering job rather than a date-maths job — which
also means the calendar somebody picks a due date from and the grid the Schedule
tab draws can never disagree about what a month looks like. Two month grids built
two ways drift at exactly the edges nobody tests: the lead-in week and the leap
year. A day is a **local** day for the same reason it is there —
`toISOString().slice(0, 10)` files a September evening in Auckland under the next
day for half the year, and the suite runs under `TZ=Pacific/Auckland` so the test
is a real assertion.

**No example value in a date box.** The rule about `7A204871` under SERIAL covers
`Nov 2019` under INSTALLED explicitly, and now covers `dd/mm/yyyy` too: the
calendar sitting in the box says what it wants better than grey text does. A
placeholder goes in only when it says something an example never could — *"No
date — that's fine"*.

It reaches every date in the app: the project sheet's three, a quote's date, the
thing page's *Installed* and *Warranty until*, the service regime's first date,
and the snag's due date — which had **no way to name a day at all** before this,
only *Today*, *In a week* and *A full cycle away*. A *Pick a date…* option sits
beside them, lit whenever the date set is not one those three would have
produced.

`DateField.test.tsx` pins the day-first read, the refused two-digit year, the
refused 31 February, the month-only answer surviving, the round trip between the
two halves, the absent placeholder, the calendar opening on the month already
set, the Monday-first week, and the tapped square giving back the local day it
shows.

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

## Worth finishing: the quiet list, and the meter it must never become

The You tab carries one muted line — *"3 things worth finishing"* — that expands into a short list
and is **absent entirely at zero**. It exists because the app now holds four kinds of record that
are supposed to inform each other, and the places they fall out of step are knowable.

**The rule it is built against is the House tab's, one screen further on:** a global completeness
meter is the shaming number that gets an app closed and not reopened, and there is deliberately no
such meter anywhere. So there is no percentage, no progress bar, and no denominator of everything —
only a count of concrete things somebody could do, the same shape as the shopping pill's "2 things
to get". `ProfileScreen.test.tsx` asserts that no `%`, no `N of M` and no "complete" ever reaches
the screen.

**Three tests every entry has to pass**, and anything failing one is left out — which is why the
list is short and usually empty:

1. **The app is certain.** A fact from a column, never "this looks thin".
2. **There is one obvious next action**, and a tap that starts it.
3. **The payoff is nameable in a sentence**, and it is a payoff to the household rather than to the
   record's tidiness.

Three things pass today. **What a renovation has not handed over** —
`installed_count - thing_count` on `projects_with_totals`, added by `20260916120000` — because
three years on nobody asks what the laundry cost, they ask the model number and the warranty, and
that answer only exists if somebody recorded the machine. A **photo with no words and no room**,
which is named elsewhere in this file as the weakest thing the app can hold: `snagHeadline` has
nothing to work with and the list reads "Something to sort out". And a **place with no suburb or
town**, because `set_property_location` is what lets a briefed extract ask for somebody *local*.

What is deliberately **not** listed is the more instructive half: a project with items nobody has
priced (nagging about work in progress), a thing with no make or model (the photo of the rating
plate may well be the answer), a subtraction that comes out negative (recording the old dishwasher
beside the new one is not a loose end), and a finished snag however it was worded — there is
nothing to sort out about a job that is done.

Four smaller rules. It is **collapsed by default**, because somebody opening the You tab came to
change their name or sign out. It sits on **no card, in no colour, at no elevation** — everything
else on that screen is a white card on the plaster ground and this is quieter than all of it. It is
**capped at `LOOSE_END_LIMIT`** (five, a sitting's worth) with the count above staying honest and
one line saying *"More once these are done."* And the two reads it needs are **never fatal**: this
screen is also the escape hatch from a broken session, so a list of optional tidying must not be
what stops somebody signing out.

`looseEnds.test.ts` pins every rule above as a property, including the four refusals;
`ProfileScreen.test.tsx` pins the absence at zero, the collapsed line, the payoff wording, the
missing meter, and Sign out surviving a failed read.

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

### A code you can hold up — and a link you can send

**The link is the first thing *Add someone* offers**, as **Share an invite link** through the
phone's own share sheet (`lib/share.ts`: `navigator.share` on web, `Share` on native, the clipboard
where there is neither). The address invitation sends nothing, so the other person had to be told
anyway and had to sign up with exactly that address; a link carries the invitation itself. It
**reuses the live code** rather than minting one, because minting kills the old one and a second
share must not break a link the first person has not opened. The QR code and the address
invitation stay, beneath it. And the waiting screen (*Someone else set ours up*) takes a **pasted
link** — `parseJoinToken` reads the code out of whatever a messaging app wrapped it in — and hands
it to the same `JoinScreen` gate a tapped link reaches, through `SetupScreen`'s `onJoinToken`.

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
content on the List and House tabs — the list's `ListFooterComponent` and the foot of the House
tab's grid, deliberately **not** pinned to the
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
succeed. Deleting a place destroys somebody else's work rather than a row of your own, so it asks
for the place's **name to be typed** (`ConfirmDialog`'s `confirmText`) and names what goes with it
in counts rather than warning in general. Removing a **part of a job that holds something** is the
only other action that earns the gate, and it asks for *Delete* rather than a name — see *The rooms
a job touches*. Everything else stays a two-button `ConfirmDialog` — never `Alert.alert`, which is
a no-op on the build people install.

`HouseholdScreen.test.tsx` pins that the last member has no ×, that Leave and Delete are never both
on screen, that a place delete is gated on the typed name and hands its returned keys to
`deleteStoredFiles`, that a household delete clears its files *before* the membership that
authorises clearing them, and that a new member goes to the places that were picked.
`household.test.ts` pins the newest-join-first read.

## Design System (DO NOT deviate)

All tokens in `apps/mobile/src/constants/theme.ts`. Never hardcode colours, spacing or shadows.
`apps/web/src/app/globals.css` and `apps/staff/src/app/globals.css` mirror the light values — change all three.

**V2 (September 2026) is an iOS grouped-list look over the same palette.** White rounded groups on
the plaster ground with hairline separators (`Colors.separator`), no outlines on cards, 34pt large
titles, 20pt sentence-case section titles, 17pt rows with 15pt facts under them, tabular figures,
tinted pills for inline actions, one full-width filled button per screen. The primitives are
`components/Grouped.tsx` (`Group`, `Row`, `SectionTitle`, `Pill`, `AddRow`, `PrimaryButton`,
`TextButton`, `Segmented`, `RadioRow`) and `components/Sheet.tsx`; new screens use them rather than
their own. `Radius.card` is 14 and `Radius.button` 12. The new colour tokens (`separator`,
`chevron`, `track`, `undecided`, `scrim`, `segment`) are mobile-only — the web app's two recovery
pages use none of them. Colour is still spent only on state and interaction: the palette did not
grow a hue.

Two rules govern the palette, and they are the whole system:

1. **The ground is warm.** `#FAF7F2` is plaster, not near-white. This is a household list, not
   software you are logged into.
2. **Colour is spent on state and interaction, never on decoration.** Four hues, one job each.

The corollary that gets second-guessed: **fern is the brand, so fern is not "done"**. A finished
snag goes neutral. The reward for finishing a household job is the item leaving the list, and
spending the brand hue on completion would make the list's calmest state its loudest colour.

- **Ground** `#FAF7F2` · **Surface** `#FFFFFF` · **Sunken** `#F4EFE7` · **Border** `#E7DFD3`
- **Fern** `#2E6A4F` — every primary action and the active tab. Tint `#E4EFE7`.
- **Clay** `#9E3522` — overdue, and nothing else since priority left. Tint `#F9E7E1`.
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

Two badges carry the triage vocabulary, and their colour budget is deliberate:

- **`StatusBadge`** — open (slate) / doing (brass) / done (neutral).
- **`PriorityBadge` is deleted**, with priority itself. It gave `high` an alert colour and `low` a
  neutral pill, so a second saturated hue could not collide with status on the same card — which
  was the right answer to a question the list no longer asks. Clay now appears on exactly one
  thing: an overdue date.
- **The parts pill** on a card — deliberately colourless. What a job needs from the shop is a fact
  about a trip, not an alarm. One item is named ("L-brackets"), more are counted: the name is what
  tells you what the trip is for, and a count never did.
- **`DueBadge`** — overdue is the one thing on a household list that has earned red. It's a fact
  about a date, not a judgement about importance.

### One chip, every rail

The "Show me" sheet on `SnagListScreen`, the repeat modal's rails on `SnagDetailScreen`, the
project-mode pair on `ProfileScreen` and the room rows in `RoomPicker` all say the same thing the
same way: **a sunken well when off, solid fern when on, no border either way.** Two rules follow from that:

- **Never put an inactive control on `surface` with a border.** On a plaster ground a white
  bordered box is a *card*, so a row of filters styled that way reads as a row of things to read
  rather than a row of things to tap.
- **`primaryLight` is not a selected state for a control.** It is the tint behind fern *text* (a
  capture tag chip, an avatar). Using it for one rail and solid fern for another made two controls
  doing the same job look like two different controls.

**Nothing in a chip row gets a hue.** *Urgent* filling with clay used to be the one exception,
because it was the only alert in the capture path; with priority gone there is no exception left,
and clay is spent solely on an overdue date.

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
- **Never call `Linking.openURL` directly — use `openUrl` from `src/lib/openUrl.ts`.**
  react-native-web implements `openURL` by assigning `window.location`, which *replaces the app*.
  That is right for a `tel:` and wrong for a link in a note: this is a single-page app holding
  unsent state — a half-typed note, an open sheet, a scroll position somebody spent a minute
  reaching — and navigating away drops all of it to show a supplier's website, while stripping the
  app from the back stack in exactly the way that makes people think they have lost their work. So
  web gets `window.open('', '_blank')`, guarded because a blocked popup returns null rather than
  throwing, then `opener = null` and only then the address; native keeps `Linking.openURL`, which
  is the OS handler and therefore the default browser. Cutting the opener is not optional — without
  it the opened page gets a live `window.opener` handle back into a signed-in session — **but it
  must not be done with `noopener` in the features string**, which by spec makes `window.open`
  return null on success too. That shipped: every PDF opened fine and then *Your browser blocked the
  new tab* came up the moment somebody closed it and came back.

  **An address typed into prose is tappable** (`LinkedText`, over `linkify`). With no
  notifications anywhere in this product a note is the only way one person tells the other
  anything, and what they are most often telling them is *where*. Where a link stops is pure and
  pinned as a property rather than a screenshot: a trailing full stop belongs to the sentence, a
  closing bracket counts only if the link opened it, and a bare `www.` gets a scheme — because
  `window.open` resolves a schemeless string against the app's own origin, which re-opens the app
  and reads as nothing having happened.
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

## The staff portal: SnagHQ answers a job it was asked about

A household taps **Ask SnagHQ about this** on a job and types a question. A SnagHQ employee picks it
up at `staff.snaghq.co.nz` (`apps/staff`), reads that job, and replies — with words, and optionally with an
assessment. The assessment is an ordinary `snag_advice` row, so it lands on the job as the same
card a pasted assessment fills; the household gets **one email** saying there is an answer.

It is the assessment loop (*The PDF can carry the question*) with a person on the other end, and
it keeps that loop's rules: an answer is a suggestion, a tradesman needs the page he was found on,
money stays text, and recording it does not touch the snag.

### What an employee can see, and for how long

**The job that was asked about, and nothing else in the house.** There is no RLS policy anywhere
that lets a staff member read `home.snags`, `home.comments` or any other household table. The
portal reads through SECURITY DEFINER functions — `staff_queue` and `staff_request_page` — which
return that one snag, its notes, its linked items and shopping list, the advice already on it, and
the place's name, suburb and town. Never a street, never another job, never the house record or a
project. The sheet the household asks from says exactly that list before anything is shared.

**While the question is open, and not after.** Open is `waiting` (SnagHQ's turn), or `replied`
within **14 days** of SnagHQ's last reply (`SUPPORT_ACCESS_DAYS`). It is a date comparison —
`home.support_is_open`, twinned in the client by `supportIsOpen` the way `inclGst` twins
`home.incl_gst` — so nothing has to run for access to lapse. A lapsed question is closed as
`expired` the next time the household asks about that job. Closing (either side) ends it at once.

**The photographs are the one read that cannot go through a function**, because Storage signs
them. So there is one extra, select-only policy on `storage.objects`:
`home.staff_can_read_file(name)` answers yes only for a file in the `photo_paths` of a job with an
open question. It is plpgsql so `is_staff()` is checked first and a customer's read of their own
bucket pays one primary-key lookup. The four member policies are untouched.

**A closed question in the queue carries nothing about the job** — its reference, the question and
dates only. A queue that went on showing the photograph after access ended would be access that
had not.

**Every open is logged** (`support_access_log`: opened, claimed, assigned, released, noted,
replied, emailed, closed), shown on the request as *Who has looked*. The household sees the first
open as *Seen by SnagHQ*. "Opened" is written at most once per half hour per person, because the
page re-reads after every action and forty "opened"s bury the entries that mean something.

### Its own site, and its own entry point

**The portal is a separate origin**, `staff.snaghq.co.nz`, and a separate Netlify site from both
the app and `www`. For one unmerged branch it was `www.snaghq.co.nz/staff`, beside password
recovery, with its cookie scoped to `/staff` — and **a cookie path is not a browser security
boundary**: any page on the same origin can open a window at the portal and read what it holds. A
separate host is a boundary, so a staff session is reachable from nothing but the portal's own
pages, and `apps/web` went back to holding no session at all. `www/staff/*` redirects to the new
host.

**Its code is not in the app.** The staff reads and writes, and the rules only the portal needs
(`adviceDraftProblems`, `supportReplyEmail`, `describeWait` …), are `@snag/supabase-queries/staff`
(`src/staff.ts`, re-exported by a one-line `staff.ts` at the package root — no `exports` field, so
Metro's resolution of the main entry is untouched). The app imports the package whole, so while they
sat in `index.ts` every phone downloaded the portal's API. Nothing there was a secret — every
`staff_*` function refuses a caller not on the staff list — but the household's app has no
business carrying it. `staffSeparation.test.ts` fails the build if a staff function reappears in the
main export or anything that ships imports the staff entry point; tests may, since they never reach
the bundle. The household's half — asking, replying, closing, `supportIsOpen`,
`describeSupportStatus` — stays in the main export, because the app is where a household asks.

Same repository and same Supabase project, deliberately: the portal reads the same `home` schema,
and a second repo would be two copies of the types to keep in step.

### Who is staff

`home.staff`, filled **by hand in SQL** (see `SNAG_INFRA_NOTES.md`); there is deliberately no
screen that writes it. `home.is_staff()` wants three things: an active row for `auth.uid()`, the
token's email equal to the row's, and Google among the account's providers. The last is the
difference between "somebody at snaghq.co.nz" and "somebody who once made an email-and-password
account with a snaghq.co.nz address". A row has no foreign key to `auth.users`, for the reason
`profiles` lost its own: an employee's name is on every reply they wrote. Leaving is
`active = false`.

Sign-in is Google Workspace SSO through Supabase Auth, PKCE, with `hd=snaghq.co.nz` as a hint to
Google — a hint, not the check. A signed-in account that is not staff sees *This account isn't on
the SnagHQ staff list*, never an empty queue, which would read as "nobody has asked anything".

### Staff never write to the job

Not its status, words, notes, parts or dates. They write their own messages (`support_messages`,
where `internal` notes are staff-only by RLS, not by a filter) and the `snag_advice` row, whose
new `staff_id` says SnagHQ wrote it — exactly one of `created_by` and `staff_id` is set, and the
paste path clears `staff_id` so a household pasting their own assessment over SnagHQ's takes
authorship with it. An answer that marked a job 'doing' would be SnagHQ deciding the household had
started work; the SQL test asserts `status`, `updated_at` and `parts` do not move.

`staff_reply` **refuses** a tradesman with no source, where `parseTradies` drops one. A pasted
answer is a stranger's and dropping is the only option; an employee typing can fix it, and the
rule — a name nobody can follow back must never reach a household — is the same either way.

### The one email, and why it is not a notification

This product sends nothing unasked, and that has not changed. The reply email is the answer to a
question the household asked, it says so, and the ask sheet warns of it before the question is
sent. It says there is a reply and links to `/snags/<id>`; **it carries nothing of the answer** —
no diagnosis, no photo, no price — because an email is a copy that gets forwarded, and the answer
belongs on the job where the other person in the house will also see it. `supportReplyEmail` is
pure and pinned.

**It is recorded only once Resend has accepted it.** The reply is saved first, whatever happens;
the Next server action then posts to Resend (`apps/staff/src/lib/replyEmail.ts`) and calls `staff_mark_emailed`
only on a 2xx. Anything else comes back as a sentence beside the reply — *Sent — it's on the job,
but the email didn't go*, with Resend's own reason — and a *Send email again*. The message id is
the idempotency key, so a retry after a timeout that did deliver cannot send a second copy. This is
the invitation screen's lesson (*The failure was the claim, not the row*) applied to the one place
this product now sends mail. **Don't make the portal say "emailed" from anything but
`emailed_at`.**

### On the job page

One quiet row, *Ask SnagHQ about this*, until somebody asks — most jobs never need it, and a card
on every job would be the page advertising a service. Then `SupportCard`, directly above the
advice card because that is where the answer lands. It states every state in words (waiting,
seen, replied and *shared until*, closed), takes follow-ups (which put it back in SnagHQ's court
and move `waiting_since`, the queue's sort key), and **Close it** ends access after a
`ConfirmDialog` saying that is what it does. Asking, replying and closing never touch the job, and
a question the page cannot read never takes the page down.

`supabase/tests/support_access.sql` replays every access rule from both sides — shared while open,
not shared before, after closing, or fourteen days after the last reply; a non-Google staff row
refused; another household seeing nothing; internal notes invisible; the unsourced tradesman
refused; the job untouched. Run it like `project_scenarios.sql`. `support.test.ts` pins the client
twin of the open rule, the status line, the assessment's refusals and the email;
`SupportCard.test.tsx`, `AskSnagHQSheet.test.tsx` and `SnagDetailScreen.test.tsx` pin the job page;
`staffSeparation.test.ts` pins the split; `apps/staff/e2e/a11y.spec.ts` puts `/sign-in` through
axe and pins the signed-out redirect and the `X-Robots-Tag` on every response.

**Setup is outside git and in order** — migration, Google provider, the callback on the redirect
allow-list, staff rows, the staff Netlify site with its env and DNS — then merge. `SNAG_INFRA_NOTES.md` has it
under *The staff portal*.

## Hosts

| Host | What it serves |
|---|---|
| `app.snaghq.co.nz` | `apps/mobile`'s Expo web export — the app people install |
| `www.snaghq.co.nz` | `apps/web` — the root page and password recovery, nothing else |
| `staff.snaghq.co.nz` | `apps/staff` — the SnagHQ staff portal |
| `snagv1.netlify.app` | redirect to `app.snaghq.co.nz` |

`snagv1.netlify.app` has to keep resolving, and not only for tidiness: **QR codes encoding it were
printed and put on walls**. That's why it stays in `linking.ts`'s prefix list — the Netlify
redirect gets someone to the app, but the prefix list decides whether the path then resolves to
the right screen rather than the default tab.

## Deploys cost credits; previews don't

A production deploy is 15 Netlify credits, and a Deploy Preview or a branch deploy costs none. Every
merge used to be a production deploy on all three sites, whatever it touched. So **merging to
`main` publishes nothing now.** Each site's production branch is `production`, and the one thing
that moves it is *Deploy to production* (`.github/workflows/deploy.yml`, run by hand from Actions).
It takes `main` or a commit on it, refuses one CI has not passed, fast-forwards `production`, and
writes which sites will rebuild and which migrations are included. A change is looked at first in
its PR's Deploy Preview and then on `main--snagv1.netlify.app`, both free. Several merges go out in
one deploy.

`scripts/netlify-ignore.sh` is every site's `ignore` step: a production build is skipped when nothing
the site builds from has changed. `packages/` counts for the app and the portal and not for `www`,
which imports none of it. **Anything uncertain builds, and previews always build**, because the
failure to avoid is not a wasted 15 credits. It is a change that reached `production` and silently
never went live. Two consequences:

- **A site that gains a dependency on a new directory needs it added to the script's `case`**.
  Without it, that site stops rebuilding when the directory changes, and nothing says so.
- **Rolling back is Netlify's *Publish deploy* on an earlier deploy**, which is free. The workflow
  only ever fast-forwards.

`netlifyIgnore.test.ts` replays the script against a scratch repository and pins each
`netlify.toml`'s path to it. The dashboard half (the production branch, and branch deploys for
`main`) is not in git and is in `SNAG_INFRA_NOTES.md` under *Deploys*.

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

**Keep it sessionless.** The staff portal is `@supabase/ssr` on PKCE, which is right there because a
Google sign-in starts and finishes in one browser, and it is on its own origin (`apps/staff`) partly
so that nothing on this host ever holds a session. Don't add one here.

## Deep links

`/snags/:id` is the one that matters — it's what someone sends when they want the other person to
look at something. `apps/mobile/src/navigation/linking.ts`, wired into `NavigationContainer`;
native uses the `snag://` scheme from `app.json`.

`/projects/:id` is the other one that resolves, and until `20260921` it never did. `ProjectDetail`
has been on the root stack since projects shipped — deliberately, so a link sent to somebody who has
since put Projects away still opens the page — but the *path* was never in `linking.ts`, so it
always fell through to the list with nothing said. **A missing path is not an error**: React
Navigation simply does not match it. `linking.test.ts` pins both paths now, and pins what stays
out.

**The Projects tab itself is deliberately not mapped.** With the setting off the tab is not
registered at all, and a route somebody cannot reach should not be reachable by typing a URL.
`ProjectDetail` is the exception on purpose: the setting is about what the app offers, not what it
refuses when asked for a specific page by id.

`/` is deliberately unmapped: an unmatched URL leaves the tab navigator on its `initialRouteName`,
which is what lands someone on the list.

### Which tab you land on, on the web build

`initialRouteName` is `Snags`, but a *matched* path beats it — and on web React Navigation
writes the URL back on every navigation and re-reads it when `NavigationContainer` mounts. Sign
Out lives on the Profile tab, so the address bar always read `/you` when the session ended, and
signing back in landed everyone on Profile for no reason anything on the page could explain.

`resetWebPathIfStale` (`src/lib/webLocation.ts`) clears the path on `SIGNED_OUT` and `SIGNED_IN`,
keeping `/snags/<id>` and `/projects/<id>` — which have to survive the sign-in round trip.
Deliberately not `INITIAL_SESSION`: reloading a tab is not logging in.

**A path that resolves and a path that is preserved are one decision, not two.** A link that
works when you are already signed in and drops you on the list when you are not is worse than one
that never worked, because nobody can tell which they are getting. Anything added to `linking.ts`
that somebody might *send* belongs in `isPreservedUrl` in the same change.

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

### The app fills the screen, and the black band was a system bar

In `standalone`, Chrome keeps Android's navigation bar **outside** the viewport and paints it
black — so an app whose ground is plaster ended at a black strip holding the back, home and
recents controls. Nothing in the page could reach it: it is not the page's background showing
through, it is a system bar, and no amount of CSS on `html` gets behind one.

`display_override: ["fullscreen", "standalone"]` in `manifest.webmanifest` is what removes it.
Both bars go, the viewport reaches the screen edge, and a swipe from either edge brings them
back — which is exactly `visibility: 'hidden'` plus `behavior: 'overlay-swipe'`, the pair
`app.json` has configured through `expo-navigation-bar` for the **native** build all along. The
web export is what people actually install, and it was the one build not asking for it.

Four things about the change:

- **It is stated in `display_override`, not by moving `display`.** The override is an ordered
  preference and `display: standalone` stays the answer for anything that does not read one —
  iOS, which has no fullscreen display mode at all, and older Chrome. Nothing regresses on the
  way past.
- **Every inset goes to zero with the bars — and that turned out not to be fine.** The reported
  insets describe bars that are no longer there, but the glass is still rounded and the camera is
  still punched through it, so a zero top put the header's back arrow in the corner curve and a
  zero bottom put the corner tabs where the swipe that brings the bars back begins. See *Corners
  and edges* below: `useEdgeInsets` floors both in `fullscreen`.
- **iOS is deliberately left alone.** `apple-mobile-web-app-status-bar-style` stays `default`
  rather than becoming `black-translucent`: translucent is how a web app gets under the iOS
  status bar, and it also forces light status-bar content, which on a `#FAF7F2` ground is a clock
  nobody can see. The complaint was Android's, and the fix is Android's.
- **An installed WebAPK updates lazily.** Chrome re-requests it in the background rather than on
  the next launch, so the band survives a deploy by a day or so on a phone that already has the
  app. Reinstalling from the browser is the way to see it immediately — worth knowing before
  concluding the change did not land.

`webManifest.test.ts` pins the override and its order, and pins it *against* `app.json`'s
navigation-bar plugin — two builds of one app disagreeing about whether Android's controls are on
screen is drift nothing else would catch, since each is configured in a different file, in a
different vocabulary, and neither build renders the other.

## Corners and edges, on an iPhone and on Android

*"The buttons on the corners are difficult to push"*, on an iPhone 17. Three causes, none of which
shows up anywhere but a phone, and `lib/edgeInsets.test.ts` pins all three.

- **`hitSlop` does nothing on the build people install.** react-native-web 0.21's `Pressable` and
  `TouchableOpacity` ignore it, so every icon "enlarged" with it had its glyph's own tap area — the
  job page's delete was a 24pt icon in the top-right corner. **Never use `hitSlop`.** Size the box
  (`MIN_TOUCH_TARGET` square), or put the pill inside a 48pt `Pressable` the way every chip row here
  does, or — where the layout cannot grow — pad the `Pressable` and pull the padding back with a
  negative margin (`segmentTap` in `Grouped.tsx`). The test fails the build on any `hitSlop=`.
- **The safe area is not where a thumb can press.** On an installed Android phone the manifest
  hides both system bars, so every inset is zero while the corners are still rounded; on anything
  without a home indicator the bottom is zero too. **`useEdgeInsets`** (`hooks/`) is the safe area
  floored: 28 at the top in `fullscreen` only (anywhere else a status bar is already above the
  page, and a band under it would push every header down for nothing), 16 at the bottom always.
  **Use it, never `useSafeAreaInsets`**, for anything against an edge — the test fails the build on
  the raw hook. The tab bar is handed the same floors through `safeAreaInsets`, because it
  measures the safe area itself. It reads the context rather than calling `useSafeAreaInsets`,
  which throws outside a provider.
- **Every bottom sheet pads the bottom edge** — `(keyboard > 0 ? 0 : edge.bottom) + Spacing.lg`.
  The capture sheet's *Submit*, the item picker's *Done* and the thing page's two sheets had
  none, so on an iPhone their one button sat on the home indicator.

Two smaller ones. `ScreenHeader` stands **8 in from the glass**, not 4 — both corners of that row
hold a control, and four pixels in is under the curve of an iPhone's edge; the job and household
pages also padded the top inset twice around it. And `html { touch-action: manipulation }` in
`public/index.html`, because iOS reads two quick taps on one control as a double-tap-to-zoom and
enlarges the page instead; pinch zoom is untouched, and `PhotoViewer`'s own `touchAction: 'none'`
still wins on its surface.

## Environment Setup

1. Copy `apps/mobile/.env.example` → `apps/mobile/.env`, fill in `EXPO_PUBLIC_SUPABASE_URL` and
   `EXPO_PUBLIC_SUPABASE_ANON_KEY`.
2. Copy `apps/web/.env.example` → `apps/web/.env.local` (`NEXT_PUBLIC_SUPABASE_*`) — same project.
3. Copy `apps/staff/.env.example` → `apps/staff/.env.local` — the same two, plus `RESEND_API_KEY` if
   the reply email should actually send.

## Running

```bash
npm install          # repo root — installs every workspace
npm run mobile       # Expo
npm run web          # Next.js — recovery, on :3000
npm run staff        # Next.js — the staff portal, on :3001
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
   that reads it. The preview of `main` reads the live database and `production` follows `main` at
   the next deploy, and a client naming a column the database has not got gets a 400 on the whole
   request, which reads on screen as an empty tab.
   See *"Everything has disappeared" has a second cause* above.
3. Add the type to `packages/shared-types/src/index.ts`
4. Grant explicitly, by name
5. **Add it to the view as well, by name.** Every list and detail screen reads
   `snags_with_details` or `things_with_details`, never the table.
6. **Carry `with (security_invoker = true)` on every view you create or replace.** A
   replace without it resets the option and the view stops asking RLS anything — see
   *A view without `security_invoker` has no RLS at all*. `viewSecurity.test.ts` fails
   the build if a migration leaves one off.

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

### Check the money views
`supabase/tests/project_scenarios.sql` replays five renovations through the app's own functions
and asserts committed, and that the supplier rows sum to it, for each. Run it after any change to
a rollup view, against a local stack, never the live project:

```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 \
  -f supabase/tests/project_scenarios.sql
```

It runs in one transaction and rolls back.

### Add a query
`packages/supabase-queries/src/index.ts`. Each function takes a `SupabaseClient` so both apps can
call it with their own; `apps/mobile/src/lib/supabase.ts` re-exports them bound to its client and
should contain no logic of its own.

**Count the requests a screen will make, not just their cost.** PostgREST's pool on this project
is **ten connections**, on a two-core instance. A screen that asks for eight things in parallel
is not eight times faster than one that asks in turn — past ten in flight they queue, and a queued
screen looks to the person holding it like a screen that ignored them, so they press again. That
is how the project page ended up taking 17 seconds to answer a query that runs in 16 milliseconds;
see *What a press costs*. Where a screen genuinely needs many things at once, the answer is one
`jsonb`-returning RPC over the same views — **SECURITY INVOKER**, so RLS still does the filtering
— rather than a `Promise.all` of REST calls.
