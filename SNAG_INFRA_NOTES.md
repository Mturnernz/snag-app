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

### The advisor's anonymous-sign-in warning on `home` is noise — but its cause isn't

Supabase's security advisor flags all ten `home` tables under `auth_allow_anonymous_sign_ins`.
Checked on 14 September 2026: **not exploitable, and two gates deep.**

- Every `home` read policy qualifies on `home.is_member(...)` or `home.is_property_member(...)`,
  which need a membership row. An anonymous user has neither a profile nor a membership, so the
  policies return zero rows rather than leaking any.
- It never gets that far anyway: `usage on schema home` went to `authenticated` only, never `anon`,
  so an anonymous caller is stopped at the schema with `42501` — the same answer the check above
  relies on.

The lint fires because the policies are declared `to public` and the *project* still has anonymous
sign-ins enabled. That setting is a leftover: it existed for the retired product's QR public
reporting (`?report=<token>`), which no longer has a client. **Turning it off at Auth → Providers
→ Anonymous sign-ins would silence 46 advisories across both schemas and remove a sign-in route
nothing uses** — but it would also disable that flow in the frozen archive, so it is a deliberate
call rather than a tidy-up. Not done.

### Storage buckets

| Bucket | Used by | Notes |
|---|---|---|
| `home-photos` | `home` | Private. 15 MB limit. **Holds manuals as well as photos** — `allowed_mime_types` gained `application/pdf` on 14 Sep 2026, and Storage enforces that list *before* RLS, so a type that isn't on it is refused with nothing said about permissions. Layout `<household_id>/<file>`, documents one deeper at `<household_id>/docs/<file>`; the RLS policies read only the first segment. The id can't be renamed, so the name stays wrong and the code is named honestly instead (`HOUSEHOLD_FILES_BUCKET`, `getFileUrl`). |
| `snag-photos`, `snag-evidence`, `org-documents`, `investigation-files`, `governance-reports`, `work-group-images` | retired `public` product | Left in place with the rest of the archive. |

### Edge functions the home app uses

`read-label` (JWT on) reads a photographed rating plate or paint tin; `inbound-bill` (JWT **off**,
Svix-signed) files bills emailed to a project, one card per paper; `reread-bill` (JWT on) is the
*Read again* button on a card that came in blank. Their source is in `supabase/functions/`. All
three share `read-label/gemini.ts` for the model plumbing, and the two bill functions share
`inbound-bill/bill.ts` and `inbound-bill/read.ts`, so a card read again comes out as it would have
the first time. **Deploy both bill functions together** whenever either shared file changes.

### Edge functions — the five below belong to the retired product, and are to be deleted

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

Their function secrets, which are not recoverable from anywhere else:
`RESEND_API_KEY`, `SNAG_FROM_ADDRESS` (`noreply@snaghq.co.nz`), `SNAG_PORTAL_URL`. `RESEND_API_KEY`
is used by nothing else — Auth's SMTP password is a *separate* Resend key — so it goes when the
functions do.

### Auth — shared by both schemas, unchanged by the pivot

Because `auth.users` sits outside both schemas, none of this needed touching:

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

### The CI test account needs a household, not just a login

The authenticated mobile specs sign in as the `E2E_EMAIL` / `E2E_PASSWORD` repository secrets and
then wait for the list. A login is not enough to reach it: `App.tsx` gates on a `home.profiles`
row and a household, and without them the app stops on Setup. The account predates the pivot, so
it had neither, and the three authenticated specs failed on every run from then until
23 September 2026 while each one reported only "compose bar not found" — sign-in itself succeeded.

It now has a profile (*E2E test*) and its own household (*E2E test house*, one property, the
seeded rooms), made through `upsert_profile` and `create_household` exactly as signing up would.
Don't add it to a real household, and don't delete that one: the specs need a list to land on. If
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
| `www.snaghq.co.nz` | `apps/web` — the password-reset landing page (`/staff/*` redirects to the portal) |
| `staff.snaghq.co.nz` | `apps/staff` — the SnagHQ staff portal |
| `app.snaghq.co.nz` | `apps/mobile`'s Expo web export — the actual app |
| `snagv1.netlify.app` | redirect to `app.snaghq.co.nz`; must keep resolving (printed QR codes, old notification links) |

Apex redirects to `www`. DNS is Netlify-managed.

## Resend

One account, four entirely separate paths into it, which fail independently:

- **HTTP API** — used by `notify-snag` (retired product only), and by the staff portal's reply
  email (a Next server action on the staff site; see *The staff portal* above).
- **SMTP** — used by Supabase Auth for password recovery. This is the one the home app depends on.
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
