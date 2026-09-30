# Snag — infrastructure notes

The configuration that isn't in git. Captured 11 September 2026, during the pivot from the
SnagHQ B2B product to the household tracker, because a schema dump records none of it and
rediscovering it is the painful part.

## Supabase

| | |
|---|---|
| Project | `Snagv1` — `wpkdpukpllxuyqqlxkxf` |
| Organisation | `kianvplkpeahbgsihifv` |
| Region | `ap-southeast-2` (Sydney) |
| Postgres | 17.6 |
| Created | 20 June 2026 |

### The limits that shape the app, not just the bill

Measured 21 September 2026, and worth knowing before optimising anything:

| | |
|---|---|
| PostgREST connection pool | **10** (`postgrest_logs`: "Connection Pool initialized with a maximum size of 10") |
| `max_connections` | 60 |
| `shared_buffers` | 224 MB |
| `statement_timeout` | 8s for `authenticated` and `authenticator`, 3s for `anon` |
| `jit` | off |

**The pool is the one that bites.** It is not a cost ceiling, it is a concurrency ceiling:
a screen firing more than ten requests at once queues the rest behind them, and every
query on this database runs in milliseconds, so the wait is entirely queueing. The
project page used to fire fourteen on open and eleven per press, which produced 17-second
responses, 227 PostgREST thread-kill timeouts in a day and ten HTTP 500s — from one
household. See *What a press costs* in CLAUDE.md.

Checking it for yourself, in the dashboard's logs or through the MCP:

```sql
-- what each endpoint actually costs, end to end, over 24h
select log_attributes['request.path'] as path, count(*) n,
       round(avg(toFloat64OrNull(log_attributes['response.origin_time'])),1) avg_ms,
       round(quantile(0.95)(toFloat64OrNull(log_attributes['response.origin_time'])),1) p95_ms
from logs where source='edge_logs' group by path order by n desc
```

If p95 is orders of magnitude above what `explain analyze` says, it is queueing, and the
fix is fewer requests rather than a faster query.

### Two schemas, one project

- **`home`** — the household tracker. Everything new lives here.
- **`public`** — the retired SnagHQ B2B product, **frozen**. Not migrated, not dropped, not read
  from. 35 tables, 112 migrations, 6 pilot orgs and 57 snags, left intact as the archive. This is
  the whole reason the pivot didn't need a destructive migration.

**`home` must be exposed to PostgREST.** Without it every client call comes back `PGRST106`.

As of 12 September 2026 this is set **in the database**, not the dashboard:
`alter role authenticator set pgrst.db_schemas = 'public, graphql_public, home'`, followed by
`notify pgrst, 'reload config'`. PostgREST reads per-role config overrides (Supabase runs with
`db-config` on), so it applies immediately — but the dashboard setting is what the platform
rewrites from, so **mirror it at Settings → API → Exposed schemas** or a platform config change
can silently revert it. Until that's done the dashboard will not show `home` and
`pg_roles.rolconfig` for `authenticator` is the real source of truth.

#### Checking it, in one command

Don't reason about this from the dashboard — ask the API, which is the thing that actually
decides. From the repo root:

```bash
set -a && . apps/mobile/.env && set +a
curl -s "$EXPO_PUBLIC_SUPABASE_URL/rest/v1/snags?select=id&limit=1" \
  -H "apikey: $EXPO_PUBLIC_SUPABASE_ANON_KEY" -H "Accept-Profile: home"
```

Two answers, and they mean opposite things:

| Response | Meaning |
|---|---|
| `42501 permission denied for schema home` | **Correct.** The schema is exposed, and `usage` went to `authenticated` only — never `anon`. |
| `PGRST106` | **The setting has reverted.** Re-run the `alter role` above, then mirror it in the dashboard. |

The failure this guards against is silent from inside the app: every call 404s, so it renders as
an account with no data rather than as an error. `SchemaNotExposedError`
(`packages/supabase-queries`) is what turns that into something `App.tsx` can say out loud, but
the check above is how you find out without waiting for somebody to report a blank screen.

Last verified: 14 September 2026 — `42501`, as it should be.

There is no way to set the dashboard value from code: it is platform config, not database state,
and neither the Supabase MCP nor any migration reaches it. It stays a manual click.

### A view does not see a column added after it

`things_with_details` was created with `select t.*` on 12 September. `document_paths` was added to
`home.things` on the 14th. The star had been expanded into named columns two days earlier, so the
view never carried the new column — and every screen reads the view, not the table.

The failure is completely silent from both ends: the write succeeds and toasts, the read drops the
column, and the client defaults it to `[]`. One PDF was uploaded, stored, referenced on its row,
and invisible in the app.

`20260914140000` rebuilds the view with every column **named**, so the next one added is a visible
omission in a diff. If you add a column to `home.things` or `home.snags`, add it to the view in the
same migration. `create or replace view` can only append columns, so putting one back in its place
means dropping and recreating — which takes the grant with it.

```sql
-- What the app can actually read, versus what the table holds.
select column_name from information_schema.columns
where table_schema = 'home' and table_name = 'things_with_details'
except
select column_name from information_schema.columns
where table_schema = 'home' and table_name = 'things';
-- and the other way round, which is the one that bites:
select column_name from information_schema.columns
where table_schema = 'home' and table_name = 'things'
except
select column_name from information_schema.columns
where table_schema = 'home' and table_name = 'things_with_details';
```

### Finding files nothing points at

**Deleting a user from the dashboard** now leaves the same way *Delete my account* does
(`20260929214235`, a trigger on `auth.users`), except for one thing SQL cannot do: a household only
they were in is deleted, and its files stay in the bucket under its id. Clear that folder from
Storage → `home-photos` afterwards, or delete through the app, which clears files first.

Uploads and the rows that reference them are two writes, so a failure between them leaves a file
in the bucket that no screen can reach. That is not hypothetical: until `planAuthEvent` landed,
coming back from the camera destroyed the sheet holding the path, and five photographs were
uploaded and orphaned that way between 12 and 14 September 2026.

**Deletes no longer add to the pile.** Until 14 September every delete path dropped its row and
left the bytes: `deleteSnag`, `deleteThing`, and nothing above them. They now call
`deleteStoredFiles` (`apps/mobile/src/lib/supabase.ts`) with the paths that just stopped being
referenced, and `home.delete_property` / `home.delete_household` *return* the keys their cascade
orphaned so the client can do the same for a whole place at once. So what this query finds now is
the interrupted-upload case only, which is the one the schema can't see coming.

```sql
with referenced as (
  select unnest(photo_paths) as path from home.snags
  union select unnest(photo_paths) from home.things
  union select unnest(document_paths) from home.things
)
select o.name, o.created_at, (o.metadata->>'size')::bigint as bytes
from storage.objects o
where o.bucket_id = 'home-photos'
  and not exists (select 1 from referenced r where r.path = o.name)
order by o.created_at;
```

Flip the `not exists` to find the opposite — rows pointing at files that aren't there, which is
what a restore from an older bucket would leave behind.

**Deleting them is not a SQL job.** `storage.protect_delete()` raises `42501: Direct deletion from
storage tables is not allowed` — the guard exists because removing the row leaves the bytes behind
in the backing store, which is a worse orphan than the one you started with. Use the dashboard
(Storage → `home-photos` → the household's folder) or the Storage API with a session that passes
`home.can_use_photo_folder`. The anon key cannot: the delete policy needs a household member.

### Anonymous sign-ins reached `home` — the old note here was wrong

Supabase's security advisor flags the `home` tables under `auth_allow_anonymous_sign_ins`. On
14 September 2026 this section called that noise, "two gates deep", and the second gate was the
mistake: it said an anonymous caller "is stopped at the schema", because `usage on schema home`
went to `authenticated` only. **Supabase runs an anonymous user as the `authenticated` role** — the
only difference is an `is_anonymous` claim in the JWT — so every grant this schema makes to
`authenticated` was theirs too.

The first gate held and still does: every read policy asks for a membership, and no anonymous user
had one. But nothing stopped one *making* one. `upsert_profile`, `create_household` and
`accept_invitation_by_token` asked only whether somebody was signed in, so anybody with the anon key
(it is in the web bundle) could `signInAnonymously()`, name themselves, create a household and use
the whole app with no address and no confirmation email — including `read-label`, whose fifty daily
reads are per household on the operator's Gemini key. Checked on 25 September 2026: the three
anonymous users date from 27 July and none has a profile, so it was never used.

Closed in two halves:

- **`20260925074528_an_anonymous_session_is_not_an_account`** — triggers on `home.profiles` and
  `home.household_members` refuse an anonymous user, whatever function is doing the inserting.
  `supabase/tests/anonymous_sessions.sql` replays it. This holds however the switch below is set.
  **Applied 25 September 2026**, and probed on the live project as one of the existing anonymous
  users: `upsert_profile` refused, nothing written.
- **Auth → Providers → Anonymous sign-ins: off**, done 29 September 2026. The setting existed for
  the retired product's QR public reporting (`?report=<token>`), which has no client. It was left
  on as "a deliberate call" on the premise above; with the premise gone there was nothing on the
  other side of the call. The 66 `auth_allow_anonymous_sign_ins` advisories went with it.

**No `home` function is executable by `anon` or `PUBLIC`**, since `20260929014049`. The advisor
had listed 80 (`anon_security_definer_function_executable`): Postgres grants EXECUTE to `PUBLIC` on
every new function, and the migrations written before `20260921*` never revoked it. It was
unreachable — `anon` has no `usage` on the schema, so a signed-out call answers `42501 permission
denied for schema home` before any function runs — but that was one gate where there should be two.
Dry-run on the live project first, then applied 29 September 2026: `anon` 80 → 0, `authenticated`
123 → 123, `service_role` 83 → 4 (it keeps the three `inbound-bill` calls plus
`review_is_unread`), and a signed-out `rpc/create_household` still answers `42501`.
`functionGrants.test.ts` replays the migrations and fails the build on the next function that
arrives without its `revoke ... from public, anon`.

### Storage buckets

| Bucket | Used by | Notes |
|---|---|---|
| `home-photos` | `home` | Private. 15 MB limit. **Holds manuals as well as photos** — `allowed_mime_types` gained `application/pdf` on 14 Sep 2026, and Storage enforces that list *before* RLS, so a type that isn't on it is refused with nothing said about permissions. Layout `<household_id>/<file>`, documents one deeper at `<household_id>/docs/<file>`; the RLS policies read only the first segment. The id can't be renamed, so the name stays wrong and the code is named honestly instead (`HOUSEHOLD_FILES_BUCKET`, `getFileUrl`). |
| `snag-photos`, `snag-evidence`, `org-documents`, `investigation-files`, `governance-reports`, `work-group-images` | retired `public` product | Left in place with the rest of the archive. |

### Edge functions the home app uses

`read-label` (JWT on) reads a photographed rating plate or paint tin; `lookup-product` (JWT on)
looks a model up on its maker's website; `inbound-bill` (JWT **off**,
Svix-signed) files bills emailed to a project, one card per paper; `reread-bill` (JWT on) is the
*Read again* button on a card that came in blank. Their source is in `supabase/functions/`. All
three share `read-label/gemini.ts` for the model plumbing, and the two bill functions share
`inbound-bill/bill.ts` and `inbound-bill/read.ts`, so a card read again comes out as it would have
the first time. **Deploy both bill functions together** whenever either shared file changes.

`read-label` finishes its work under `EdgeRuntime.waitUntil` and keeps what it read in
`home.label_readings` (`20260924120100`), so the walkthrough never waits on it. **Order matters:**
apply that migration *before* deploying the function (without it the function logs *could not
open a reading* and the reading cannot outlive the sheet), deploy the function before merging the
client, and check one real read with the sheet closed before it lands — the row should appear
and the thing's page should show the card. A busy first round retries once in the background
after 20s, so a single call can run for up to ~100s of wall clock: inside the platform's limit,
but worth knowing when reading the logs.

`lookup-product` (JWT on) searches the maker's own website for a model's manual, the parts a
householder replaces and the service interval, and keeps only what it has itself found written on
the maker's pages (`20260927100000`, `home.product_lookups`). `read-label` imports
`lookup-product/run.ts` and starts one in the background once a plate gives a make and a model,
so **deploy the two together** whenever `lookup-product/run.ts` or `lookup.ts` changes. Order:
apply `20260927100000`, deploy `lookup-product` and then `read-label` (both JWT on, no new
secrets — they share `GEMINI_API_KEY`), press *Look it up* on one real appliance and read the
function's log line (it names what the model claimed and what survived), then merge. Until the
migration is applied `read-label` logs *could not begin* and reads the plate as before.

**What it costs.** Each lookup that actually runs is one model call with Google Search
grounding and URL context on, plus the function opening up to six of the maker's pages itself.
Google bills the search queries a grounded call makes separately from its tokens, and the pages
the model opens count as input tokens — check the current Gemini pricing page for the model in
`GEMINI_MODEL`, and the project's own billing, rather than trusting a figure written here. A
lookup is kept per make and model per household and never repeated unless it failed, and it
spends one of the household's fifty daily reads (`claim_label_read`), so the ceiling that caps
label reads caps this too.

**When the card says *Google wouldn't run the search*.** That is `reason = 'limit'`: Google
answered 429 on every model with a quota that is not per-minute. It is an allowance on the Google
project the `GEMINI_API_KEY` belongs to — usually search grounding not included on its tier, or its
daily allowance used — and nothing in the app or the database can change it. The function log says
which one: search `lookup-product:` for the line reading `429: quota — <metric> (<quota id>) limit
<n> …`. Then open the key's project in Google AI Studio (Usage and rate limits, and Billing): a
limit of 0 means the project's tier does not include it and needs billing turned on or a higher
tier; a daily limit resets at midnight Pacific time. The first live lookups (27 Sep 2026) all hit
this while plain label reads on the same key worked, so grounding is the allowance to check first.
A 429 on plain label reads too points at the key being on the free tier, which the `read-label`
section already says not to use.

### Edge functions — the five below belong to the retired product, and are to be deleted

**30 September 2026: all five are tombstones.** `export-investigation` (v17),
`export-governance-report` (v14), `worksheet` (v15) and `worksheet-import` (v10) were redeployed the
way `notify-snag` was: JWT on, a body that answers `410 Gone`, no secret read and no data touched.
Signed out they answer `401`, with the anon key `410`. `notify-snag` itself is gone from the list.
**Still to do by hand:** delete the four from the dashboard, and delete the secrets `RESEND_API_KEY`,
`SNAG_PORTAL_URL` and `SNAG_INTERNAL_SECRET` (Edge Functions → Secrets). Checked the same day: no
function the app keeps reads any of the three.

`notify-snag` (v20), `export-investigation`, `export-governance-report`, `worksheet`,
`worksheet-import`. None is called by the home app; `notify-snag` is deliberately not adapted
(two people in one house don't need an email per snag).

**Their source is no longer in this repo.** It came out with the rest of the retired product on
14 Sep 2026 and is recoverable from git at `604a62c` if it is ever wanted. What is still true, and
is the reason this section now says *delete* rather than *leave*, is that all five are still
**deployed and ACTIVE**, and `notify-snag` runs with `verify_jwt: false` — a publicly reachable
endpoint holding a service-role key and a Resend key, for a product that no longer exists. The
header secret is the only thing in front of it.

Deleting them is a dashboard job: **Edge Functions → the function → Settings → Delete**. The
Supabase MCP server can deploy and read functions but cannot delete one, so this cannot be done
from a session here.

**`notify-snag` is a tombstone until then** (version 24, 28 September 2026). It was redeployed as
a function that returns `410 Gone` and reads no secret, with JWT verification now **on**. A
signed-out `curl -X POST …/functions/v1/notify-snag` answers `401`, and one with the anon key
answers `410`. Nothing calls it any more: `overdue-actions-digest`, the cron job that did, is
unscheduled. See *The archive stops answering* below. The other four are JWT-on and untouched,
and still to be deleted.

Their function secrets, checked in the dashboard on 28 September 2026: `RESEND_API_KEY`,
`SNAG_PORTAL_URL` and `SNAG_INTERNAL_SECRET`. (`SNAG_FROM_ADDRESS`, which this note used to list,
no longer exists.) **All three go when `notify-snag` does.** The functions the home app keeps
(`read-label`, `lookup-product`, `inbound-bill`, `reread-bill`) read only `GEMINI_API_KEY`,
`GEMINI_MODEL`, `GEMINI_FALLBACK_MODEL`, `RESEND_INBOUND_API_KEY`, `RESEND_WEBHOOK_SECRET` and the
platform's `SUPABASE_*`. `RESEND_API_KEY` is a different key from Auth's SMTP password and from the
staff portal's key, which lives on Netlify. `SNAG_INTERNAL_SECRET` is the header `notify-snag`
compared against the database's Vault secret `snag_internal_secret`. That Vault secret stays with
the archive: the retired `dispatch_*` functions read it, and deleting it changes nothing.

**Nothing will call a deleted `notify-snag` in a way that matters.** Its callers were the digest
cron job, now unscheduled, and four `public.dispatch_*` functions fired by two triggers on the frozen
`public.snags` table. Nothing in the app writes that table. If anything ever did, the `pg_net` call is
fire-and-forget and the dispatch functions swallow errors, so it would get a 404 and nothing else.

### The archive stops answering — its cron job and its functions

Two parts of the retired product were still live on 28 September 2026, and
`20260928090000_the_archive_stops_speaking` closed both:

- **A daily email.** `overdue-actions-digest` (pg_cron, 18:00 UTC) posted to `notify-snag`
  whenever one of the pilot orgs had an overdue corrective action. One did, so *"1 overdue
  corrective action"* went to three people every day from the pivot to 27 September. The job is
  unscheduled. **`retention-minimisation` is left scheduled.** It blanks resolved niggles more
  than three years old, which was promised to the pilot orgs, and it cannot match a row until
  2029. It runs as `postgres`, so the revoke below does not touch it.
- **116 functions any signed-in caller could run.** Every `public` SECURITY DEFINER function was
  executable by `authenticated`, and three by `anon`. Every household account is `authenticated`,
  so any of them could call `create_organisation_and_owner` and write into the archive. The
  migration revokes EXECUTE on every `public` function from `public`, `anon` and
  `authenticated`.

**Four are granted back to `authenticated`, and they must stay granted:** `current_org_id()`,
`"current_role"()`, `can_view_site(uuid)` and `is_org_active(uuid)`. The retired product's
`storage.objects` policies call the first two. One of those policies reads `public.snags`, whose
own policies call the other two. `storage.objects` is shared by both products, and a policy's
functions are checked for EXECUTE as the caller when the query is planned. So revoking any of the
four raises `42501` on **every** home photo read and upload.

The list was found by rehearsing the migration inside a rolled-back transaction as a household
member, not by reading. A text search of `pg_policies` misses `"current_role"` (the name is quoted)
and `can_view_site` (no storage policy names it). **Check it the same way before touching a
`public` grant again:**

```bash
# The closure from pg_depend, and every assertion. Reads the catalogue and rolls back.
psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/archive_locked.sql
```

It passed against the live project on 28 September 2026. As a member, storage read 151 photos and
53 documents, an insert and an update passed, and `public.accept_rca` was refused. Over HTTP,
`/rest/v1/rpc/get_org_by_join_code` with the anon key answers `42501`, and a signed-out `home` read
still answers `42501`. The advisor's `authenticated_security_definer_function_executable` goes
from 116 findings to 4, and those four are deliberate.

### Auth — shared by both schemas

Because `auth.users` sits outside both schemas, the pivot needed none of this touching. Signing up
has since grown settings of its own, which are the second list below.

- **SMTP** is custom, pointed at Resend. Username is literally `resend` (lowercase); the password
  is a Resend **API key**, not an account password. A wrong one shows as
  `535 "Authentication credentials invalid"` in the **Auth** logs, not in Resend's — a rejected
  SMTP login never creates an email to log.
- **Redirect allow-list** (Auth → URL Configuration) must contain `<portal>/reset-password`. An
  address that isn't on it doesn't error: Auth substitutes the Site URL and the link lands on a
  homepage instead of a password form.
- Password recovery uses the **implicit** flow, not PKCE, and lands on a plain web page. See
  `CLAUDE.md` for why, and note the mobile app has no recovery screen of its own.
- Don't test recovery with the dashboard's **Send password recovery** button: it sends no
  `redirectTo`, so it falls back to the Site URL and can sign someone in without asking for a new
  password.

#### Signing up — the settings the app depends on

Set in the dashboard, and each one is silent when it is wrong. Recorded 25 September 2026.

**Two of them can be read without the dashboard**, from Auth's public settings endpoint — the
publishable key is in the web bundle anyway:

```bash
curl -s "https://wpkdpukpllxuyqqlxkxf.supabase.co/auth/v1/settings" \
  -H "apikey: <publishable key>" | jq '{mailer_autoconfirm, anonymous: .external.anonymous_users}'
```

`mailer_autoconfirm` must be `false` (confirmation on) and `anonymous` must be `false`. On
25 September 2026 it read `false` and `true`, and still did on 28 September; **on 29 September
both read `false`** — anonymous sign-ins are off. The template and the password minimum are not in
that answer.

**The redirect allow-list can be probed too**, without sending anything or creating anybody. Start
an OAuth sign-in with the address in question and read back where Auth decided to send it:

```bash
curl -s -o /dev/null "https://wpkdpukpllxuyqqlxkxf.supabase.co/auth/v1/authorize?provider=google&redirect_to=<url-encoded address>" \
  -H "apikey: <publishable key>"
```

```sql
select referrer, created_at from auth.flow_state order by created_at desc limit 2;
```

An address on the list comes back as asked; one that is not comes back as the **Site URL, which
is `https://app.snaghq.co.nz`**. Checked 29 September 2026: `https://app.snaghq.co.nz/join/<uuid>`
came back as asked and `https://not-on-the-list.example.com/` came back as the Site URL. The
unfinished flow rows expire on their own.

- **Confirm email: on** (Auth → Providers → Email). **This is load-bearing, not a preference.** An
  invitation waits on an *address* (`home.invite_to_household`, matched through `home.my_email()`),
  so the only thing proving the person signing up owns that address is the confirmation email. With
  it off, anybody could sign up with an invitee's address and accept their invitation. It cannot be
  guarded in SQL: with confirmation off, Auth stamps `email_confirmed_at` at sign-up, so an
  unconfirmed address looks confirmed. Check it from the data rather than the dashboard — every
  email-and-password account made in the last month should have been *sent* a confirmation:

  ```sql
  select count(*) as signed_up_unconfirmed_path
  from auth.users
  where created_at > now() - interval '30 days'
    and not is_anonymous
    and raw_app_meta_data->>'provider' = 'email'
    and confirmation_sent_at is null;
  ```

  Anything but `0` means confirmation was off when those accounts were made (or they were created
  by hand in the dashboard).
- **Email template → Confirm signup** is `supabase/templates/confirm-signup.html`, pasted in, with
  the subject `Your Snag code is {{ .Token }}`. It must carry `{{ .Token }}`: the app's *Check your
  email* screen asks for the code, and without it that screen asks for something the email does not
  contain. **Paste it before merging the sign-up change.** The code is what works across devices —
  typed into the tab that asked, which keeps a household's `/join/<token>` in its address bar — and
  what survives a mail scanner prefetching and spending the link.
- **Redirect allow-list** must also contain `https://app.snaghq.co.nz/**` (and
  `http://localhost:8081/**` for local work). `signUpWithEmail` sends `emailRedirectTo` as the app's
  own origin plus `/join/<token>` when there is one; an address not on the list is swapped for the
  Site URL without a word, and a scanner who taps the link lands on *Set up your house* instead of
  the join question.
- **Minimum password length: 8** (Auth → Providers → Email). The app says eight and so does
  `/reset-password`; this is what enforces it. Existing shorter passwords still sign in — Auth
  checks the minimum only when a password is set.
- **Leaked password protection: on** (Auth → Providers → Email → *Prevent use of leaked
  passwords*; Pro plan). The advisor flags it as off. The app words the refusal
  (`weak_password` with reason `pwned`) as "has turned up in a data breach".
- **Anonymous sign-ins: off** (verified 29 September 2026). See *Anonymous sign-ins reached `home`*
  above.
- **Resend click tracking: off** for the domain Auth's SMTP sends from. Tracking rewrites every
  link, and a rewritten confirmation or recovery link is one Auth no longer recognises. Checked
  25 September 2026: open and click tracking are both off on `snaghq.co.nz` and
  `bills.snaghq.co.nz`.

### The staff portal — Google sign-in, a staff list, and one email

`staff.snaghq.co.nz` (`apps/staff`) is where SnagHQ employees answer questions households ask about
a job (`20260925100000`; *The staff portal* in `CLAUDE.md`). It is its own Netlify site, separate
from the app's and from `www`'s. None of what makes it work is in git, and the order matters —
**apply the migration first**, then:

1. **The Netlify site** is **`snag-staff`** (id `c27cfb6a-6975-4cda-9dbf-1ba03784cd5c`, team
   `mturnernz`), created 24 Sep 2026 with its environment variables already set:
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (the legacy anon key, as the app and
   web use), `NEXT_PUBLIC_SNAG_APP_URL`, `SUPPORT_EMAIL_FROM`, and `RESEND_API_KEY` (step 5).
   **Still to do by hand**, because none of it is reachable from an API token here:
   - *Link repository* → `mturnernz/snag-app`, production branch `main`, **Base directory
     `apps/staff`**, build command and publish directory left empty (Netlify's Next.js runtime is
     detected; `apps/staff/netlify.toml` only pins Node). Do it **after** the branch carrying
     `apps/staff` is merged, or the first build from `main` has nothing to build.
   - *Domain management* → `staff.snaghq.co.nz`. DNS is Netlify-managed, so the record and HTTPS
     come with it.
2. **Google as an Auth provider.** A Google Cloud OAuth client (Web application) in the
   snaghq.co.nz Workspace, with the authorised redirect URI
   `https://wpkdpukpllxuyqqlxkxf.supabase.co/auth/v1/callback`. Its client id and secret go in
   Supabase → Auth → Providers → Google. Setting the OAuth consent screen to **Internal** keeps
   anybody outside the Workspace from getting past Google at all; the staff list is the check
   either way.
3. **Redirect allow-list** — add `https://staff.snaghq.co.nz/auth/callback` (and
   `http://localhost:3001/auth/callback` for local work). The Google OAuth client does not change:
   its redirect URI is Supabase's own callback, never ours. Missing, the sign-in lands on the
   Site URL and never reaches the portal, with nothing said.
4. **Who is staff** — by hand, one row per employee, after they have signed in once so their
   `auth.users` row exists:

   ```sql
   insert into home.staff (user_id, display_name, email)
   select id, 'Sam', lower(email) from auth.users where email = 'sam@snaghq.co.nz';
   ```

   `home.is_staff()` also wants the token's email to match and the account to have Google as a
   provider, so an email-and-password account with a snaghq.co.nz address is not staff. Somebody
   leaving is `update home.staff set active = false` — never a delete: their name is on every
   reply and log entry they wrote.
5. **The reply email** — done. `RESEND_API_KEY` is the Resend key **`snag-staff-portal`**:
   sending-only, restricted to `snaghq.co.nz` (verified for sending), stored on `snag-staff` as a
   **secret, production context only**. Two things about that, both found by setting it:
   - **A Netlify secret cannot be set for the `dev` context**, and the context "all" includes
     `dev` — so a secret upserted with context "all" is refused *silently* (the API answers
     "upserted" and nothing is stored). Production-only is also the right answer on its own terms:
     a deploy preview of the portal should never email a household.
   - **Narrowed scopes are refused the same silent way** on this team's plan for plain values —
     `SUPPORT_EMAIL_FROM` only stuck with the default scopes. Read the variables back after
     setting any; "upserted" is not evidence.
   It is a Next server action that sends, so these are **site** variables, not function secrets.
   Without the key, replies still save and the portal says they were not emailed. To rotate:
   create a new sending-only key restricted to the domain, replace the value, delete the old key.

Checking it: `curl -sI https://staff.snaghq.co.nz/` answers a redirect to `/sign-in` with
`X-Robots-Tag: noindex, nofollow`; a signed-in non-staff account sees *This account isn't on the SnagHQ
staff list*; and `select home.is_staff()` run as a staff token is `true`.

### Households sign in with Google too — first-run setup

First-run setup (`apps/mobile/src/setup/`; *First run is a list of steps* in `CLAUDE.md`) can offer
**Continue with Google** before email, on the web build and the native one. It reuses the staff
portal's Google provider — Supabase has one per project — and **it is off until
`EXPO_PUBLIC_GOOGLE_SIGN_IN=on` is set** in the build's environment (Netlify, for the web build).
Off, the welcome screen goes straight to *What's your email?*. Turn it on only after the rest of
this list, **in this order**:

1. **`20260929060443_setup_is_a_list_of_steps.sql` is applied** (29 September 2026, with
   `mark_setup_seen` revoked from `public, anon`). It adds `profiles.setup_seen`, which
   `getMyProfile` names; a client reading it against a database without it gets a 400 on every
   profile read. It marked every account already in a household as having seen the baseline steps,
   so nobody was walked through setup. `select count(*) from home.profiles where setup_seen = '{}'`
   counts only people who joined or signed up since.
2. **Open the OAuth consent screen to everybody.** It is **Internal** (step 2 of the staff portal
   above), which stops anybody outside the snaghq.co.nz Workspace at Google. Set the user type to
   **External** and publish it (Google Cloud → APIs & Services → OAuth consent screen). The staff
   portal stays closed: `home.is_staff()` still wants a staff row, a matching email and Google as
   a provider — the notes above already call the staff list "the check either way". Only the
   `openid`, `email` and `profile` scopes are asked for, which are not sensitive scopes — Google may
   still ask for brand verification if a logo is added to the consent screen.
3. **Redirect allow-list** (Auth → URL Configuration) — add `https://app.snaghq.co.nz/**` (the web
   build comes back to the path it left from, so a `/join/<token>` survives the trip) and
   `snag://auth-callback` (the native build). Missing, the sign-in lands on the Site URL with
   nothing said — the same trap as recovery.
4. **Set `EXPO_PUBLIC_GOOGLE_SIGN_IN=on`** on the app's Netlify site and redeploy.
5. **Try it once on a throwaway Google account** on the web build: it should land on *What should
   we call you?* with the first name already in the box. Then try an address that already has an
   email-and-password account: Supabase links a verified Google identity to the same user, so it
   should land in that person's house, not a new one.

The native build also needs `expo-web-browser` in the next binary; the web build needs nothing.

### The CI test account needs a household, not just a login

The authenticated mobile specs sign in as the `E2E_EMAIL` / `E2E_PASSWORD` repository secrets and
then wait for the list. A login is not enough to reach it: `App.tsx` gates on a `home.profiles`
row and a household, and without them the app stops on Setup. The account predates the pivot, so
it had neither, and the three authenticated specs failed on every run from then until
23 September 2026 while each one reported only "compose bar not found" — sign-in itself succeeded.

It now has a profile (*E2E test*) and its own household (*E2E test house*, one property, the
seeded rooms), made through `upsert_profile` and `create_household` exactly as signing up would.

**Recreated 30 September 2026.** The login was deleted from the dashboard with five others on
29 September, and every signed-in spec failed at sign-in from then on. It was made again with the
same address (`mturnernz+qa.admin@gmail.com`, so `E2E_EMAIL` is unchanged) through Auth's own
sign-up, confirmed in SQL, then given its profile and house through the RPCs and
`mark_setup_seen(['name','household','rooms','invite'])` — without that last call an account made
after `20260929060443` stops on the setup steps and never reaches the list. Its password was then
set back to the one the `E2E_PASSWORD` secret already holds, so the secret did not change. **The
account's password and that secret must agree**: when they don't, every signed-in spec stops on
*Welcome back* with *That email and password don't match*, which the Playwright report's page
snapshot shows.
Don't add it to a real household, and don't delete that one: the specs need a list to land on.
Being in a household before `20260929060443` also means the migration marked it as having seen
setup; an account made after it would be walked through the setup steps and never reach the list. If
they ever fail at sign-in again, check the account before the specs:

```sql
select p.display_name,
  (select count(*) from home.household_members m where m.profile_id = u.id) as households
from auth.users u left join home.profiles p on p.id = u.id
where u.email = '<E2E_EMAIL>';
```

## Hosts

| Host | Serves |
|---|---|
| `www.snaghq.co.nz` | `apps/web` — the front page, `/privacy`, `/terms` and password recovery (`/staff/*` redirects to the portal) |
| `staff.snaghq.co.nz` | `apps/staff` — the SnagHQ staff portal |
| `app.snaghq.co.nz` | `apps/mobile`'s Expo web export — the actual app |
| `snagv1.netlify.app` | redirect to `app.snaghq.co.nz`; must keep resolving (printed QR codes, old notification links) |

Apex redirects to `www`. DNS is Netlify-managed.

## Resend

One account, four entirely separate paths into it, which fail independently:

- **HTTP API** — used by `notify-snag` (retired product only), and by the staff portal's reply
  email (a Next server action on the staff site; see *The staff portal* above).
- **SMTP** — used by Supabase Auth for password recovery and the sign-up code. This is the one the
  home app depends on.
- **Receiving** — `bills.snaghq.co.nz`, a receive-only domain (sending disabled), for bills
  forwarded to a project. Resend posts `email.received` to the `inbound-bill` edge function.

### Emailed bills (`bills.snaghq.co.nz`)

Created 24 Sep 2026 in region `ap-northeast-1`, with the webhook
`https://wpkdpukpllxuyqqlxkxf.supabase.co/functions/v1/inbound-bill` subscribed to
`email.received`. Four things make it work, and each fails silently:

1. **DNS at the snaghq.co.nz host** — an `MX` record, name `bills`, value
   `inbound-smtp.ap-northeast-1.amazonaws.com`, priority 10; and the `TXT` DKIM record Resend
   lists for `resend._domainkey.bills`. A subdomain, deliberately: an MX on the root would compete
   with whatever receives `@snaghq.co.nz` mail and one of the two would stop getting it.
2. **`RESEND_INBOUND_API_KEY`** as an edge-function secret — a **full-access** Resend key, because
   reading received mail and its attachments needs one. Its own name so it cannot be confused with
   `notify-snag`'s `RESEND_API_KEY`, which is sending-only and is going with that function.
3. **`RESEND_WEBHOOK_SECRET`** — the `whsec_…` signing secret on the webhook (Resend → Webhooks).
   Without it every delivery is refused with a 401, which is the right answer to an unsigned
   request and indistinguishable, from the inbox, from nothing happening.
4. **`GEMINI_API_KEY`** — already set for `read-label`. Without it cards still arrive, unread.

The function runs with `verify_jwt: false` and must stay that way (Resend has no Supabase token);
the signature is the lock. A signed-out `curl -X POST` answers `401 Bad signature`, which is the
one-command check that it is deployed and refusing strangers.

To test end to end: open a project, *+* → *Email it in instead*, copy the address, and forward a
bill to it **from the address you sign in with**. Anything else is logged and dropped.

**One card per paper** (`20260924120000`). The order is the usual one, and the migration is safe to
apply first: `file_emailed_bill`'s new arguments all have defaults, so the function deployed before
it keeps filing one invoice card per email until it is redeployed.

1. Apply `20260924120000_one_card_per_paper.sql`, and check it with
   `supabase/tests/emailed_papers.sql` against a local stack.
2. `supabase functions deploy inbound-bill --no-verify-jwt` and `supabase functions deploy reread-bill`
   (JWT on). `reread-bill` uses the secrets already set: `GEMINI_API_KEY`, and
   `RESEND_INBOUND_API_KEY` to give the reading the email's words again (optional).
3. Forward an email with several attachments and check a card arrives for each paper, then merge.

*Read again* counts against the household's fifty model reads a day, the ceiling label reading
keeps (`home.claim_label_read`), one per paper. The inbound function's cards count against the
fifty emailed cards a day in `file_emailed_bill` — one per paper, so an email of ten spends ten.
If a card came in blank, the function's log line says why: `models busy`, or `GEMINI_API_KEY
missing or refused`.

The sender must be on a verified domain. `onboarding@resend.dev` delivers only to the Resend
account's own address and rejects everything else with a 403 that nothing surfaces.

## Deploys

Three Netlify sites, each linked to `mturnernz/snag-app` with its own base directory:

| Site | id | Base directory | Serves |
|---|---|---|---|
| `snagv1` | `016c74e6-9a37-4b0f-8d23-94a5339bb850` | `apps/mobile` | app.snaghq.co.nz |
| `snag-app-website` | `7fc0b551-9069-4b2c-b66f-c77dd9d4a808` | `apps/web` | www.snaghq.co.nz |
| `snag-staff` | `c27cfb6a-6975-4cda-9dbf-1ba03784cd5c` | `apps/staff` | staff.snaghq.co.nz |

**A production deploy costs 15 credits. A Deploy Preview, a branch deploy, a failed deploy and a
rollback cost none.** Until 26 September 2026 every merge to `main` was a production deploy on
every site (three once the portal existed): up to 45 credits a merge, roughly 1,500 in the week
before, when nearly every merge touched the app alone. (This section used to say pushing to `main` triggered nothing and deploys were
API-driven. The deploy records disagreed: each production deploy carried the merge commit and
branch `main`, and all three landed in the same second as the push.)

Two things now stand between a merge and a charge:

- **Production is the `production` branch, not `main`.** A merge to `main` becomes a free branch
  deploy at `main--snagv1.netlify.app`, `main--snag-app-website.netlify.app` and
  `main--snag-staff.netlify.app`: everything merged so far, against the live database. A PR gets
  its own Deploy Preview (`deploy-preview-<n>--snagv1.netlify.app`, linked from the PR's checks)
  before that. **Deploy to production** (`.github/workflows/deploy.yml`, under Actions → *Run
  workflow*) is the only thing that publishes. It takes `main` or a commit on it, refuses a commit
  CI has not passed, fast-forwards `production`, and writes which sites will rebuild and which
  migrations are included. It never goes backwards. To roll back, use *Publish deploy* on an
  earlier production deploy in Netlify, which is free and rebuilds nothing.
- **A site whose files did not change is not rebuilt.** `scripts/netlify-ignore.sh` is every site's
  `ignore` step. Netlify's default check only diffs the base directory, which misses `packages/`,
  and in practice skipped nothing here. A skipped build shows in the site's deploy list as
  *Canceled build due to no content change*, which Netlify records as a failed deploy. That entry
  means the script is working.

**The dashboard half is not in git and has to be set on each of the three sites.** Project
configuration → Build & deploy → Continuous deployment → *Branches and deploy contexts* →
Configure:

- **Production branch:** `production`
- **Branch deploys:** *Let me add individual branches* → `main`
- **Deploy Previews:** leave on *Any pull request against your production branch / branch deploy
  branches*. PRs target `main`, which is now a branch-deploy branch, so they still get previews.

The `production` branch does not exist until the workflow first runs. Until the dashboard is
switched, `main` is still production: the ignore step still skips unchanged sites, and running the
workflow only creates a branch Netlify does not build. The first promotion after switching rebuilds
whichever sites changed since their last production deploy.

Environment variables stay per context. `RESEND_API_KEY` is production-only on `snag-staff`, so
neither a preview nor `main--snag-staff` sends a household email. Changing a variable reaches the
bundle only on a rebuild. Trigger one with *Deploy project* on the `production` branch; the ignore
step always builds a commit that has already been built, so that redeploy is not skipped.

A deploy by hand still works (from the **repo root**, so the upload mirrors the layout the base
directories assume), but it is a production deploy like any other, 15 credits:

```bash
npx -y @netlify/mcp@latest --site-id <id> --proxy-path <token from the Netlify MCP>
```

## Launch switches, 30 September 2026

Build-time variables on the `snagv1` site that decide what v1 offers. As of 30 September 2026
`EXPO_PUBLIC_GOOGLE_SIGN_IN` is `on` and `EXPO_PUBLIC_LABEL_READING` is not set, which is off.

| Variable | Unset / anything else | `on` |
|---|---|---|
| `EXPO_PUBLIC_LABEL_READING` | The walkthrough takes the plate photo and asks for the details by hand; no *Read from the label*, no *What the maker says*, no *labels to check* | The label is read and the model looked up (`read-label`, `lookup-product`) |
| `EXPO_PUBLIC_GOOGLE_SIGN_IN` | Email only | *Continue with Google* first |

Label reading is off because the Gemini key's **prepaid credits ran out** on 29 September 2026 (every
call answered `402 RESOURCE_EXHAUSTED`). Before turning it on: add credit and auto-reload in Google AI
Studio, set a budget alert, read one real plate, then set the variable and redeploy.

The Projects tab is not a build switch: it is `profiles.projects_enabled`, false by default and true
only for the two accounts named in `20260929214206`.

## Error reporting (Sentry)

The web build reports errors to Sentry once `EXPO_PUBLIC_SENTRY_DSN` is set on the `snagv1` site
(a plain variable: a DSN is public by design and ships in the bundle). Until then nothing
initialises and nothing is fetched. What it sends, and what is scrubbed first, is in
`apps/mobile/src/lib/monitoring.web.ts` and `monitoringScrub.ts`.

To switch it on:

1. Create a **Browser / React** project in Sentry. In the project's settings, leave **Session
   Replay** off and **data scrubbing** on (the app scrubs too; this is the second lock).
2. Set `EXPO_PUBLIC_SENTRY_DSN` on `snagv1`, production context. Optionally set
   `EXPO_PUBLIC_SENTRY_ENVIRONMENT` (defaults to `production`). Read it back, since "upserted" is
   not evidence (see *The staff portal*).
3. Check the DSN's ingest host is covered by `connect-src` in `apps/mobile/netlify.toml`
   (`*.ingest.sentry.io`, `*.ingest.us.sentry.io`, `*.ingest.de.sentry.io`). A blocked report
   fails silently.
4. Redeploy. Expo inlines the variable at build time, so an existing deploy never sees it.

The SDK is a separate 1.2 MB chunk loaded with `import()` only once a DSN exists. The main bundle
moved by 2 KB. A static import had added 1.2 MB for every visitor.

## Migration versions, file against live

Migrations applied through the Supabase MCP get the timestamp of the moment they were applied,
not the one in the file name, so the two can differ. What matters is that each file name is
unique in `supabase/migrations/` (the CLI refuses a duplicate) and that every file has been
applied:

| File | Live version |
|---|---|
| `20260925074528_an_anonymous_session_is_not_an_account` | `20260925074528` (renamed to match; it had duplicated `20260926100000`) |
| `20260926100000_the_project_page_is_read_part_by_part` | `20260925075301` |
| `20260927100000_a_model_is_looked_up_once` | `20260927182857` |
| `20260927110000_a_lookup_google_refused` | `20260927191658` |
| `20260928090000_the_archive_stops_speaking` | `20260928014324` |
| `20260928100000_what_snag_keeps_about_you` | `20260928015049` |
| `20260929060443_setup_is_a_list_of_steps` | `20260929060443` (renamed to match; it had duplicated `20260928090000`) |
| `20260929214206_projects_are_off_for_v1` | `20260929214206` (named for the live version) |
| `20260929214235_a_login_deleted_anywhere_leaves_the_same_way` | `20260929214235` (named for the live version) |
| `20260929214244_three_helpers_pin_their_search_path` | `20260929214244` (named for the live version) |

## Preservation

The pre-pivot state is commit `604a62c` on `main`. A tag was intended:

```bash
git tag -a v1-snaghq-b2b 604a62c -m "SnagHQ B2B, final state before the home pivot"
git push origin v1-snaghq-b2b
```

This has **not** been pushed — the Claude Code session's git access is scoped to its own branch
and returns 403 for tag pushes. `main`'s history preserves the commit regardless; the tag is
belt-and-braces and needs running by hand.

Also worth copying out of the repo for readability, though git preserves them either way:
`Snag_NZ_HS_Compliance_Analysis.docx`, `Snag_Feature_Prospectus.docx`, `SNAG_STRATEGY_AUDIT.md`,
`Snag_HSWA_Compliance_Response_and_Roadmap.docx`.
