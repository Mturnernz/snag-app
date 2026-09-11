# Snag → Home: review of the pivot brief

A response to *Snag → Home Pivot: Build Brief*. Written after measuring the repo and the
live Supabase project, so the tradeoffs below are costed rather than guessed.

---

## What I measured first

| | |
|---|---|
| Mobile app | ~26,000 lines, 131 TS/TSX files |
| — of which touch the serious lane | **53 files** (investigation / RCA / witness / debrief / corrective) |
| Web app | ~5,500 lines, 59 files |
| Migrations | **112**, all marked "SNAPSHOT — do NOT re-apply" |
| Tables in `public` | **35** |
| `insert into public.audit_log` calls inside RPCs | **168** |
| Edge functions | 5 (`notify-snag` alone is 474 lines) |
| Tests | 29 unit, 10 Playwright specs |
| **Live data** | 6 orgs · 7 profiles · **57 snags** · 8 sites · 19 investigations |

That last row is the one that changes the plan. There is no customer data in Snagv1. It is a
pilot dataset. Nothing in the database is worth the cost of migrating it carefully.

---

## The verdict in one paragraph

Agree with the pivot, the branding call, and most of the V1 feature list. I'd change three
things.

**Keep the repo but start a fresh Supabase project** rather than migrating the schema in place.
**Make V1 able to clear the pile, not just record it** — the app's real job is holding work that
sits below the threshold of action until the threshold drops, which needs an effort estimate, a
needs-parts flag and one weekend view alongside the recurring items. And **don't park
`apps/web` without first solving password reset**, which lives there and will break silently the
moment the portal stops being deployed.

One thing to design around without building: the **shared bach** is a materially different shape
and the most commercially interesting idea here. Four schema decisions now keep it open at no
cost.

---

## DECIDE — repo in place, or fresh repo?

The brief leaves this open. It's actually two questions, and they have different answers.

### The repo: pivot in place. Not close.

What's expensive in this codebase isn't the B2B domain logic — that's the part you delete. It's
the platform knowledge, and all of it is lane-agnostic:

- The web-export traps: CSP `connect-src`/`blob:` rules, `expo-camera`'s module-scope worker,
  `Alert.alert` being a no-op on web, `onAuthStateChange` deadlocks, the PWA manifest/icon
  workaround. Each of those cost real debugging time and is documented in `CLAUDE.md`. A fresh
  repo re-learns every one.
- The design system (`theme.ts`), `PhotoPicker`, `IssueCard`, `StatusBadge`, `Sheet`, `Toast`,
  `ScreenHeader`, EAS build config, CI, deep-link config, and `offlineQueue.ts` — there is
  already a working capture-only offline queue, which is *exactly* what a "photograph the thing
  under the house where there's no signal" tool needs.

**Delete, don't refactor.** ~53 files go wholesale; git keeps them. Tag `main` first.

### The database: fresh project. Against the brief.

The brief says "same project, schema migrated in place." I'd push back:

| | Migrate `public` in place | **Fresh Supabase project** |
|---|---|---|
| Work to start | Write one large destructive migration across 35 tables, 112 migrations of dependency order, ~168 audit-log call sites | Write ~6 clean tables + RPCs |
| Risk | Drop-order mistakes on the project you're also trying to use | None — old project untouched |
| Legacy left behind | All 112 migrations, an unreplayable history, dead enum values (`hazard`, `incident`, `rca_pending`), the `lane` generated column | Nothing |
| Archive quality | A schema-only `.sql` snapshot | **The entire old project, live and queryable** |
| Auth users | Kept (7, of which 2 matter) | Recreate 2 accounts — 5 minutes |
| Config to redo | None | Redirect allow-list, Resend SMTP, function secrets, 2 buckets — ~1 hour |

The in-place option is the only one that gives you *both* the legacy weight and the migration
risk. And note the archive column: keeping the old project intact is a strictly better record
than the schema snapshot the brief asks for.

Free tier allows two active projects (verify current limits), and the old one can be paused
once you stop referring to it.

**If you'd rather stay in one project:** create a new schema (`home`) and expose it via
Dashboard → API → Exposed schemas, leaving `public` frozen. Same benefit, one more piece of
config to remember. Don't do surgery on `public`.

---

## CHANGE — what the tool is actually for

I under-argued this in the first pass. I said the reactive loop competes with saying it out loud
or sending a text. That's true for *transmitting* a job and wrong about everything afterwards: a
conversation passes the job across, and then neither of you is holding it. The toilet seat is
broken, but not broken enough to act on today — so it lives in someone's head, gets re-raised
every few weeks, and quietly accumulates alongside nine others exactly like it.

So there are two kinds of work worth holding, and they turn out to be the same kind:

- **Calendar-forgotten** — smoke alarm batteries, gutters before winter, the heat pump filter,
  warranty expiry, the gas bottle cert.
- **Threshold-forgotten** — the toilet seat. Never urgent enough to act on alone. Worth doing the
  moment three of them can be done together.

Both are work sitting below the threshold of action. **The job of the app is to hold that work
until a moment when the threshold drops** — a free Saturday, a tradesman already on site, a trip
to the hardware store you're making anyway. That's one product idea rather than two, and it's
the thing a conversation genuinely cannot do.

Which means a filtered list of open items isn't enough to act on. *What can I get done today* is
a different question from *what's outstanding*, and answering it needs two more facts per item.

### Two fields and one view

- **`effort`** — quick (under an hour) / half day / big job. Rough buckets, never minutes: nobody
  estimates accurately and nothing here needs them to.
- **`needs_parts`** — a boolean. The most common reason a small job doesn't get done is that it
  needs a trip to the hardware store first. Knowing which jobs are waiting on that, and clearing
  them in one trip, is most of the value.

Then one screen the brief doesn't have: **a weekend view.** Open items filtered to what fits the
time available, grouped by room so the garage jobs get done together, with everything marked
`needs_parts` collected into a shopping list at the top.

This is where the photos earn their keep. Twelve jobs with thumbnails is a Saturday morning you
can act on; twelve lines of text is a chore list you skim and close.

### Capture and triage are different moments, and shouldn't share a screen

That's now four fields beyond the basics — room, priority, effort, due date — and each one is
friction at exactly the moment friction costs most. You are standing in the bathroom holding a
broken toilet seat with about ten seconds of patience.

So: **capture takes a photo, a title and a room. Nothing else.** Everything else is added later,
from the list, by someone sitting down. Two moments, two interfaces. Quick capture stays quick,
and the pile gets sorted on a Sunday night — which is also when someone will notice it's grown.

### Recurring items, still in V1

The calendar-forgotten half needs no scheduler, no new table and no notifications:

- two columns on `snags`: `due_at timestamptz`, `repeat_days int`
- a "Due" filter beside open / by room / by person
- on resolve, if `repeat_days` is set, roll `due_at` forward and reopen

Half a day, about fifty lines. Reminders can wait for proof; *recording* the recurring items
shouldn't. If it still slips to V2, put `due_at` in the schema anyway so the data accumulates.

---

## CHANGE — "park the web app" has a load-bearing dependency

`apps/mobile/src/lib/supabase.ts` sends password recovery to `${PORTAL_URL}/reset-password`, and
mobile has **no recovery screen of its own** — there's no `PASSWORD_RECOVERY` gate anywhere in
the app, by design (see `CLAUDE.md`: the reset page has to be a plain web page on the implicit
flow, because a PKCE link only works in the browser that requested it).

Park `apps/web` without a plan and account recovery dies quietly. Three options:

1. **Keep `apps/web` deployed, trimmed to `/reset-password`** — delete the marketing routes,
   the portal, `/go`, `/join`. It's already built and covered by e2e tests. Cheapest.
2. Add a reset-password route to the mobile web export at `app.snaghq.co.nz`. More work, must be
   client-side and fragment-reading.
3. **Do nothing** — for two users, set passwords directly from the Supabase dashboard when
   needed. Genuinely defensible at this scale. Note the dashboard's *Send password recovery*
   button sends no `redirectTo` and can sign someone in without asking for a password; set the
   password directly instead.

I'd take (1), and (3) is not silly.

**Related, and not in the brief: decide what `www.snaghq.co.nz` serves.** Right now it's a live
marketing site for a retired HSWA compliance product, and it's been SEO'd
(`SNAGHQ_DOMAIN_AND_SEO_PLAN.md`). Leaving it up is a dead storefront. Redirect `www` →
`app.snaghq.co.nz`, or point it at the trimmed reset-password build.

---

## CHANGE — the strip list is incomplete, and one item on it is a trap

The brief names ~6 things to strip. There are 35 tables. Full classification:

**Keep (6):** `organisations` (household), `profiles`, `org_memberships`, `snags`, `comments`,
plus one `sites` row if you migrate in place (see below).

**Drop (24):** `investigations`, `investigation_files`, `checklist_completions`,
`witness_statements`, `evidence_items`, `corrective_actions`, `snag_rca`, `rca_why_steps`,
`snag_debriefs`, `debrief_findings`, `debrief_attendees`, `debrief_lessons`,
`serious_incident_owners`, `governance_reports`, `work_groups`, `work_group_sites`,
`work_group_supervisors`, `site_supervisors`, `site_default_owners`, `public_report_blocks`,
`snag_views`, `comment_mentions`, `votes`, `notification_deliveries`.

`votes` is worth calling out — it's a "me too" signal for a workforce. With two people it's
noise. `org_documents` is a judgement call: an appliance-manual locker is actually useful in a
house, but it's not V1.

**The trap: `audit_log`.** The brief says strip the "immutable audit log machinery" in favour of
`updated_at`/`updated_by`. That's the right *end state*, but on the in-place path the removal is
the expensive part — there are **168 inline `insert into public.audit_log` statements living
inside the RPCs themselves**. It isn't machinery you switch off; it's a line in every write path.

- On a fresh project: just don't write them. Free.
- In place: keep the table, stop reading it. Removing it means editing every RPC for zero gain.

Either way, `updated_at`/`updated_by` on `snags` is the right call.

---

## ADD — things the brief doesn't mention

### Rooms are in the V1 scope but not in the data model

"Add a maintenance item: title, description, photo, **room/location**" — but the data-model
section never creates it. Specify it now: **`snags.location text`**, free text with suggestions
drawn from previously-used values on the same household. Not a `rooms` table. Nobody wants to
administer a room registry before they can log a dripping tap.

**Keep the property as a real row, on both paths.** I previously said to drop the concept
entirely on a fresh project and let `household_id` carry it. The bach case (below) changes that:
keep `snags.property_id not null` pointing at a single auto-created `Home`, and hide the concept
in the UI until there is a second one. In place, that means keeping one hidden `sites` row and
leaving the RLS policies alone — `snags.site_id` is already `not null` and `sites` is threaded
through `can_view_site` and `can_edit_site`.

A room is not a property. Rooms are free text on the snag; properties are rows.

### Add a third dimension: now / soon / someday

The specific way household lists die is that *"repaint the deck sometime"* accumulates until it
drowns *"toilet leaking."* Three statuses don't separate those — both are `open`.

A `priority` of **now / soon / someday** fixes it, and `PriorityBadge.tsx` already exists in the
component library.

**If you want to cut one thing from my additions, cut this one.** `effort` plus `due_at` plus
the weekend view covers most of what priority was for, and "someday" is arguably just *no due
date, big effort*. Priority is the cheapest to add later, because unlike `property_id` it's a
nullable column on a table you already own.

### Delete the role system from the client, not just the schema

The brief is right that leaving role tiers in the schema costs nothing. But in the *client*,
role gates are threaded through navigation, the Manage tabs, the admin dashboard, and the
investigation permissions. Make it explicit: **no role checks in the UI at all.** Both of you
see and do everything. Keep the column, ignore it.

### Delete the onboarding flow, don't adapt it

Roughly 11 of 28 screens exist to get a stranger into an organisation: `OrgChoice`, `OrgSetup`,
`OrgCreate`, `OrgJoin`, `JoinMethod`, `ScanJoinCode`, `AdminSetup`, `CreateOrgAccount`,
`ChooseReportOrg`, `OrgInactive`, `PublicQrReport`, plus the onboarding carousel. For a
two-person household, sign-up is a one-time event you can do by hand.

Create both accounts manually. Ship no invite flow, no join codes, no QR intake. That's the
single biggest free deletion available.

### Delete `notify-snag` rather than adapting it

474 lines of role-aware event fan-out (`serious_created`, `rca_assigned`, `niggle_escalated`…)
for two people who live in the same house. An email per snag is noise, and it's the thing most
likely to make you both mute the app.

Keep Resend configured for **auth SMTP only**. Revisit notifications after a month of use — and
when you do, "the weekly digest of what's due" is a better first notification than "Alyssa
logged a snag."

This advice is specific to two people in one house, and the bach case breaks its assumption —
see below.

### Free-tier projects pause after inactivity

A two-person tool used a few times a week sits close to the line (~7 days of inactivity on the
free plan — verify current policy). A paused project means the app is dead on the day someone
actually reaches for it, which is exactly when you lose them. Either accept the cold start, keep
something pinging it, or budget for Pro.

### Two corrections to the brief's assumptions

- **"App Store listing all reusable"** — there isn't one. `eas.json`'s `submit.production` is
  empty; the app is installed from the browser as a PWA (the whole manifest/icon section of
  `CLAUDE.md` exists for that reason). Renaming later is a manifest string and an icon, not a
  store resubmission — *cheaper* than the brief assumes, though I still agree with not doing it
  now.
- **"Save the HSWA and competitive analysis outside the repo"** — they're already committed
  (`Snag_NZ_HS_Compliance_Analysis.docx`, `Snag_Feature_Prospectus.docx`,
  `SNAG_STRATEGY_AUDIT.md`, and others). A git tag preserves them permanently and for free.
  Copying to Drive is about being able to *read* them later without the repo, which is a
  different and lesser need.

---

## ADD — the bach, and what it costs to not foreclose it

Worth saying plainly: **this is the most commercially interesting idea in the brief.** Household
maintenance trackers are a crowded category with low willingness to pay — everyone already has a
notes app and most of them churn. *A shared holiday home five families use and one person
maintains* is specific, underserved, and not really a maintenance problem at all. It's a fairness
problem between family members, which is the kind people pay to make go away.

I am not suggesting building it. The brief's instruction not to gold-plate for an unconfirmed
future is right, and a two-person household is the correct first user. But the bach shape differs
from the household shape in ways that are free to accommodate now and a rewrite to retrofit.

### Decisions to make now

1. **Keep the property as a real row, even with one of them.** `snags.property_id not null`,
   pointing at an auto-created `Home`, with the concept hidden in the UI until there are two.
   Adding a not-null FK to a populated table later is a migration, a backfill, and a change to
   every query. This single decision is most of the difference, and it revises what I said in the
   first pass.
2. **Keep `org_memberships.role` and write no UI against it.** The brief already said to keep the
   tier in the schema; the bach is the reason. Note the role model it needs is nothing like the
   B2B one — two roles and one gate ("can this person close things"), not the supervisor /
   officer-admin / lead-investigator lattice you're deleting.
3. **Model the household as a container of properties, not as one.** One row per household or
   ownership group, with properties hanging off it. For you that's a group of two with one house.
   For a bach it's a family with one bach, and later perhaps a bach and a boat.
4. **Don't let "assign to a household member" harden into "assign to whoever is here."** At a bach
   the assignee is the owner almost every time, and the interesting field is who *reported* it —
   which the schema already records.

None of the four adds a screen to V1.

### Know what already exists before rebuilding it

Two pieces of the retired product map onto the bach almost exactly. Read them before
reimplementing — don't revive them in place, since both are wired to the B2B site model:

- **Public QR intake** — `create_public_snag`, `public_report_token`, and the rate limiting in
  `public_report_blocks`. A sticker inside the bach door reading *something broken? scan this* is
  a far better fit for guests than asking five families to install an app. The B2B version was
  built for a site notice board and works the same way.
- **The digest** — I said to delete `notify-snag`, and for two people in one house I stand by it.
  The bach breaks the assumption: the owner isn't there, and things happen without them. The
  answer still isn't an email per snag; it's `overdue_actions_digest`'s shape — one summary, on a
  schedule, aimed at one person.

One landmine if you ever revive the invite flow. Per `CLAUDE.md`, `invite_user` wrote the invite
row and never sent the mail — for the entire life of the feature, silently, because the RPC
succeeded and the app toasted "Invite sent." The dispatch only arrived in `20260805090000`. If
you reimplement invites from the old code, send a real test invite to a real inbox before
believing it works.

### How you'd test the idea without building it

If the bach is ever worth pursuing commercially, the test isn't a feature — it's finding out
whether the owner of one is willing to describe the problem to you in their own words, and
whether "the list of jobs waiting for the next time I'm up there" is the phrase they use. That
costs a conversation, not a sprint. Do it before anything in this section becomes code.

---

## ADD — a better "before anything gets wiped" list

The brief's list is 15 minutes well spent. I'd reorder it and add the item that actually hurts
to lose:

1. **`git tag v1-snaghq-b2b && git push --tags`** — 10 seconds, permanent, covers every document
   and every line of code. Do this before anything else.
2. **Write down the Supabase *configuration*, not just the schema.** This is the one that isn't
   in git and is genuinely painful to rediscover: the Auth redirect URL allow-list, the SMTP
   settings (username is literally `resend`, password is a Resend API key), the function secret
   *names* (`RESEND_API_KEY`, `SNAG_FROM_ADDRESS`, `SNAG_PORTAL_URL`), and the storage bucket
   policies. A schema dump captures none of it.
3. **Keep the old Supabase project rather than snapshotting it** (if you take the fresh-project
   route) — a live project beats a `.sql` file. Pause it when you stop looking.
4. Landing page copy and the HSWA/competitive analysis to Drive — for readability, per above.
5. Download anything from `snag-photos` you'd miss. Almost certainly nothing: 57 pilot snags.
6. Note which Netlify site is which before you start changing DNS.

---

## Revised V1 scope

Split by the two moments, which is the change that matters most:

**Capture — ten seconds, standing up**

- Photo, title, room. Nothing else. *(room now specified as free text)*

**Triage — later, from the list, sitting down**

- Priority: now / soon / someday *(added — and the first thing to cut if this is too much)*
- **Effort: quick / half day / big job** *(added)*
- **Needs parts** *(added)*
- Due date, with an optional repeat interval *(moved up from V2)*
- Assign to the other person
- Status: open → doing → done

**Views**

- List and filter: open, by room, by person, by due *(by due added)*
- **Weekend view: what fits the time available, grouped by room, parts list on top** *(added)*
- Comment thread on an item

**Invisible in V1, but in the schema**

- `property_id` on every snag, pointing at one hidden `Home`
- `role` on every membership, with nothing reading it

Still out: cost tracking, contractor notes, reminders and notifications, the document locker,
visible multi-property, public/guest reporting, anything about the kids.

---

## Sequence

Rough, and deliberately front-loads the decision that's hardest to reverse.

| | Work | Rough size |
|---|---|---|
| 0 | Preserve: tag, config notes, Drive copies | under an hour |
| 1 | Decide repo/DB. Stand up the new project: ~6 tables, RPCs, RLS, 2 buckets, 2 accounts | half a day |
| 2 | Strip the app: delete ~53 serious-lane files + the 11 onboarding screens, cut to 3 tabs, rewrite `shared-types` and `supabase-queries` | two days |
| 3 | Room, priority, effort, needs-parts, due/repeat, and the weekend view | one day |
| 4 | Deploy: mobile web export → `app.snaghq.co.nz`; resolve reset-password; decide what `www` serves | half a day |
| 5 | **Use it for three weeks before writing more code** | — |
| 6 | Then, and only then: reminders, document locker, cost tracking | — |

Rewrite `CLAUDE.md` as part of step 2 rather than deleting it. Most of it goes, but the Code
Style section, the Hosts table, and the web-build traps are all still true and are worth days.

---

## Where I'd expect pushback

Three things I've argued against the brief, and I could be wrong about all of them:

- **Fresh Supabase project.** The counter is that reuse was an explicit premise, and an hour of
  reconfiguration is an hour. If the answer is "one project," take the new-schema route and
  leave `public` frozen — don't do surgery on it.
- **Recurring in V1.** The counter is real: it's scope creep on a project whose stated risk is
  gold-plating. If it stays in V2, put `due_at` in the schema anyway.
- **Effort, needs-parts and the weekend view.** This is the addition most at risk of being the
  thing I'm guilty of warning about. My defence is that it's two nullable columns and one screen
  built from a list that already exists — and that without it, V1 is a record of problems rather
  than a way to clear them. But it is an addition, and the honest minimum is `effort` plus the
  view; priority and needs-parts can both follow later.

The bach section is deliberately not a recommendation to build anything. Four schema decisions,
no screens.

Everything else here is additive to the brief rather than a disagreement with it.
