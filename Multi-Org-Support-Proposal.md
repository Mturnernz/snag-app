# Multi-organisation support — design proposal

Not implemented. This is a design document for a dedicated future effort, per
the decision to keep this pass scoped to a proposal only.

## Problem

Today `profiles` has a single `org_id uuid not null` and `role user_role not
null` column per auth user. `current_org_id()` and `current_role()` — both
`select ... from profiles where id = auth.uid()` — gate almost every RLS
policy and RPC in the schema (~50 functions). A person can only ever belong to
one organisation, at one role.

Two real scenarios need to work:
1. **A worker on multiple sites for different employers** (e.g. a contractor)
   needs to report snags into whichever org they're currently working for,
   and see only that org's issues.
2. **An owner/admin of one org who is also a supervisor or worker at
   another** — the highest role must apply *per organisation*, not globally.

## Proposed schema

Replace the single `org_id`/`role` columns on `profiles` with a join table:

```sql
create table public.org_memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id),
  org_id uuid not null references public.organisations(id),
  role public.user_role not null default 'worker',
  removed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, org_id)
);
```

`profiles` becomes an org-agnostic identity record: just `id`, `name`, `email`,
`created_at`. Role and org affiliation move entirely into `org_memberships`,
which also gives multi-org member removal (#8 in this pass) a natural home —
soft-remove one membership row without touching the others.

## The "active org" problem

RLS policies and RPCs need a single, unambiguous org for the current request.
Two approaches, and a recommended middle ground:

- **JWT custom claim**: encode the active org in the auth token via a Supabase
  Auth Hook. Fast to check in RLS, but switching orgs means re-issuing a
  token — extra latency and a new moving part in auth.
- **Explicit `p_org_id` parameter on every RPC**: no session state, but
  touches every one of the ~50 existing RPC signatures and every call site in
  the client. Highest blast radius.
- **Recommended: a tiny "active org" table**, keeping `current_org_id()`/
  `current_role()`'s names and call sites completely unchanged:

  ```sql
  create table public.user_active_org (
    user_id uuid primary key references public.profiles(id),
    org_id uuid not null references public.organisations(id),
    updated_at timestamptz not null default now()
  );

  create or replace function public.current_org_id() returns uuid
  language sql stable security definer set search_path = public as $$
    select org_id from public.user_active_org where user_id = auth.uid();
  $$;

  create or replace function public."current_role"() returns public.user_role
  language sql stable security definer set search_path = public as $$
    select m.role from public.org_memberships m
    where m.user_id = auth.uid()
      and m.org_id = (select org_id from public.user_active_org where user_id = auth.uid())
      and m.removed_at is null;
  $$;

  create function public.set_active_org(p_org_id uuid) returns void
  language plpgsql security definer set search_path = public as $$
  begin
    if not exists (
      select 1 from public.org_memberships
      where user_id = auth.uid() and org_id = p_org_id and removed_at is null
    ) then
      raise exception 'You are not a member of that organisation';
    end if;
    insert into public.user_active_org (user_id, org_id) values (auth.uid(), p_org_id)
      on conflict (user_id) do update set org_id = excluded.org_id, updated_at = now();
  end;
  $$;
  ```

  Because every existing policy/RPC only ever calls `current_org_id()`/
  `current_role()` — never reads `profiles.org_id` directly — this is the only
  schema-facing change most of the codebase needs. That's the whole point of
  recommending it: minimal surface area for a large amount of new capability.

## Migration path (zero behaviour change on day one)

1. Create `org_memberships` and `user_active_org`.
2. Backfill: one `org_memberships` row per existing `profiles.org_id`/`role`,
   and one `user_active_org` row per user pointing at that same org. Every
   existing single-org user sees no change at all.
3. Swap `current_org_id()`/`current_role()` bodies (above). Every existing RLS
   policy and RPC keeps working unmodified.
4. Update `invite_user`/`accept_invite`/`join_org_via_code`: drop the "you
   already belong to an organisation" guard, insert into `org_memberships`
   instead of `profiles`, and call `set_active_org` on success so the new
   membership becomes active immediately.
5. Update `remove_org_member` (this pass's soft-remove) to set `removed_at` on
   the specific `org_memberships` row rather than the whole profile — a person
   removed from one org keeps access to any others.
6. Only after the above is stable: drop `profiles.org_id`/`role` (or keep them
   as a denormalized "last active org" for anything that still reads them
   directly, then delete once nothing does).

## Client changes

- `getProfile()` splits into `getIdentity()` (name/email, org-agnostic) and
  `getMemberships()` (list of `{ org, role }`).
- App.tsx routing: on sign-in, if a user has ≥2 memberships and no
  `user_active_org` row yet (e.g. first login after the migration), prompt
  them to pick one instead of assuming.
- New org-switcher UI — likely a picker on `ProfileScreen`, calling
  `set_active_org` then refetching everything the app currently loads on
  launch (profile, snags, admin data).
- Report submission and the issue list already key off `current_org_id()`
  server-side, so they need **no changes** — switching org and reporting a
  snag is automatically scoped correctly once `set_active_org` has run.

## Risk / effort

The database-function swap (step 3) is low-risk and mechanically simple. The
real cost is the org-switcher UX, admin-screen changes (an admin managing
multiple orgs' member lists), and thorough testing of every "which org am I
in" edge case — this warrants its own dedicated pass and branch, not bundling
into a batch of unrelated UI changes.
