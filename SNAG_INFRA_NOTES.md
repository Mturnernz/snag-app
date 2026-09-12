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

Verified after the change: `public` still answers 200 (the archive is unharmed), and `home`
answers `42501 permission denied` to an anon key — correct, since only `authenticated` was
granted `usage on schema home`.

### Storage buckets

| Bucket | Used by | Notes |
|---|---|---|
| `home-photos` | `home` | Private. 15 MB limit, image types only. Layout `<household_id>/<file>` — the RLS policies assume it. |
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
