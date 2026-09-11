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

Agree with the pivot, the branding call, and the V1 feature list almost entirely. I'd change
three things: **keep the repo but start a fresh Supabase project** rather than migrating the
schema in place; **pull recurring maintenance into V1**, because it's the only part that will
still be used in November; and **don't park `apps/web` without first solving password reset**,
which currently lives there and will silently break the moment the portal stops being deployed.

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

## CHANGE — recurring maintenance belongs in V1

The brief holds it back "until the core loop is proven." I think that inverts the risk.

The reactive loop — *something broke, log it* — already has a working competitor: saying it out
loud, or a text message. Two people in one house don't need a database to know the toilet is
leaking. What a household tracker is genuinely better at is the stuff you'd otherwise forget:
smoke alarm batteries, gutters before winter, heat pump filter, warranty expiry, gas bottle
cert, chimney sweep.

The failure mode of "reactive first" isn't that you build the wrong thing. It's that you use it
for three weeks, it decays, and you conclude *we don't need this* — having never reached the
part that would have made it stick.

**The cheap version is genuinely cheap.** Not a scheduler, not a new table, not notifications:

- two columns on `snags`: `due_at timestamptz`, `repeat_days int`
- one "Due" filter alongside open / by room / by person
- on resolve, if `repeat_days` is set, roll `due_at` forward and reopen

That's roughly half a day and about fifty lines. Reminders and notifications can wait for proof;
*recording* the recurring items should not. Push back on this if you disagree — but if it stays
in V2, at least make sure V1's schema can hold a due date, so the data starts accumulating.

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

If you migrate in place: `snags.site_id` is `not null` and `sites` is threaded through every RLS
policy (`can_view_site`, `can_edit_site`). Don't rip it out — keep one hidden `Home` row and
leave the policies alone. On a fresh project, drop the concept entirely; `household_id` is
enough. (If you ever add a rental or a bach, `sites` comes back as *properties* — but that's a
real second thing, not a room.)

### Add a third dimension: now / soon / someday

The specific way household lists die is that *"repaint the deck sometime"* accumulates until it
drowns *"toilet leaking."* Three statuses don't separate those — both are `open`.

A `priority` of **now / soon / someday** fixes it, and `PriorityBadge.tsx` already exists in the
component library. This is the one scope addition I'd argue for beyond recurring items.

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

Unchanged from the brief except where marked:

- Add an item: title, description, photo, **room** *(now specified as free text)*
- Status: open → doing → done
- **Priority: now / soon / someday** *(added)*
- Assign to the other person
- Comment thread
- List/filter: open, by room, by person, **by due** *(added)*
- **Due date + optional repeat interval** *(moved up from V2)*

Still out: cost tracking, contractor notes, reminders/notifications, document library,
multi-property, anything about the kids.

---

## Sequence

Rough, and deliberately front-loads the decision that's hardest to reverse.

| | Work | Rough size |
|---|---|---|
| 0 | Preserve: tag, config notes, Drive copies | under an hour |
| 1 | Decide repo/DB. Stand up the new project: ~6 tables, RPCs, RLS, 2 buckets, 2 accounts | half a day |
| 2 | Strip the app: delete ~53 serious-lane files + the 11 onboarding screens, cut to 3 tabs, rewrite `shared-types` and `supabase-queries` | two days |
| 3 | Room, priority, due/repeat | half a day |
| 4 | Deploy: mobile web export → `app.snaghq.co.nz`; resolve reset-password; decide what `www` serves | half a day |
| 5 | **Use it for three weeks before writing more code** | — |
| 6 | Then, and only then: reminders, document locker, cost tracking | — |

Rewrite `CLAUDE.md` as part of step 2 rather than deleting it. Most of it goes, but the Code
Style section, the Hosts table, and the web-build traps are all still true and are worth days.

---

## Where I'd expect pushback

I've argued two things against the brief and I could be wrong about both:

- **Recurring in V1.** The counter-argument is real: it's scope creep on a project whose stated
  risk is gold-plating. If you keep it in V2, put `due_at` in the schema anyway.
- **Fresh Supabase project.** The counter is that reuse was an explicit premise, and an hour of
  reconfiguration is an hour. If the answer is "one project," take the new-schema route and
  leave `public` frozen — don't do surgery on it.

Everything else here is additive to the brief rather than a disagreement with it.
