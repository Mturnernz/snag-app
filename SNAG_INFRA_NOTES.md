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

### Finding files nothing points at

Uploads and the rows that reference them are two writes, so a failure between them leaves a file
in the bucket that no screen can reach. That is not hypothetical: until `planAuthEvent` landed,
coming back from the camera destroyed the sheet holding the path, and five photographs were
uploaded and orphaned that way between 12 and 14 September 2026.

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

### Edge functions — all belong to the retired product

`notify-snag` (v20), `export-investigation`, `export-governance-report`, `worksheet`,
`worksheet-import`. None are called by the home app; `notify-snag` is deliberately not adapted
(two people in one house don't need an email per snag). Left deployed rather than deleted so the
archive stays runnable.

Their function secrets, which are not recoverable from anywhere else:
`RESEND_API_KEY`, `SNAG_FROM_ADDRESS` (`noreply@snaghq.co.nz`), `SNAG_PORTAL_URL`.

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

## Hosts

| Host | Serves |
|---|---|
| `www.snaghq.co.nz` | `apps/web` — being reduced to the password-reset landing page |
| `app.snaghq.co.nz` | `apps/mobile`'s Expo web export — the actual app |
| `snagv1.netlify.app` | redirect to `app.snaghq.co.nz`; must keep resolving (printed QR codes, old notification links) |

Apex redirects to `www`. DNS is Netlify-managed.

## Resend

One account, two entirely separate paths into it, which fail independently:

- **HTTP API** — used by `notify-snag` (retired product only).
- **SMTP** — used by Supabase Auth for password recovery. This is the one the home app depends on.

The sender must be on a verified domain. `onboarding@resend.dev` delivers only to the Resend
account's own address and rejects everything else with a 403 that nothing surfaces.

## Deploys

Both Netlify sites are deployed by uploading the repo and building on Netlify's infra, so the
site's own base directory and environment variables apply:

```bash
npx -y @netlify/mcp@latest --site-id <id> --proxy-path <token from the Netlify MCP>
```

Run it from the **repo root**, not from the app directory — the sites are configured with
`Base directory` set to `apps/mobile` and `apps/web`, and the upload has to mirror the repo
layout those paths assume.

| Site | id | Serves |
|---|---|---|
| `snagv1` | `016c74e6-9a37-4b0f-8d23-94a5339bb850` | app.snaghq.co.nz |
| `snag-app-website` | `7fc0b551-9069-4b2c-b66f-c77dd9d4a808` | www.snaghq.co.nz |

Pushing to `main` does **not** trigger a build — deploys are API-driven.

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
