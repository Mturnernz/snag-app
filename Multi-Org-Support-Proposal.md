# Multi-organisation support — design proposal

Not implemented. This is a design document for a dedicated future effort, per
the decision to keep this pass scoped to a proposal only.

## Problem

Today `profiles` has a single `org_id uuid not null` and `role user_role not
null` column per auth user. `current_org_id()` and `current_role()` — both
`select ... from profiles where id = auth.uid()` — gate almost every RLS
policy and RPC in the schema (~50 functions). A person can only ever belong to
one organisation, at one role, and cannot use Snag at all without one.

Three real scenarios need to work:
1. **A worker on multiple sites for different employers** (e.g. a contractor)
   needs to report snags into whichever org they're currently working for,
   and see only that org's issues.
2. **An owner/admin of one org who is also a supervisor or worker at
   another** — the highest role must apply *per organisation*, not globally.
3. **A member of the public with no org at all** reporting to a "public"
   organisation (e.g. Auckland Council accepting facility issues from
   residents) and seeing only the snags they themselves submitted.

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
which also gives member removal a natural home — soft-remove one membership
row without touching the person's other organisations.

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

## How switching feels in practice

**Contractor walkthrough.** Mere works for two builders. Monday she's on an
Acme site: she scans the Acme QR poster by the site office. She's already an
Acme member, so instead of today's "you already belong to an organisation"
error, the scan simply calls `set_active_org(acme)` — a toast confirms
"Now reporting to Acme". Every snag she flags that day lands in Acme; her
Issues tab shows only Acme snags. Wednesday she's at a Bendon site, scans
their poster, and the whole app context flips to Bendon. She never opens a
settings screen; the QR posters that already exist for joining double as the
switching mechanism.

**Manual switching.** For when there's no poster handy: an organisation row on
ProfileScreen listing her memberships with the active one marked, tapping
another calls `set_active_org` and refetches the app's launch data. On
sign-in, a user with 2+ memberships and no active-org row yet (first login
after the migration) picks one; a user with exactly one is auto-set.

**QR-scan-to-switch** is therefore a small extension of the already-shipped
join flow: `ScanJoinCodeScreen` checks membership first — member → switch;
non-member → today's join-as-worker flow.

Report submission and the issue list already key off `current_org_id()`
server-side, so they need **no changes** — once the active org is set,
reporting and viewing are automatically scoped correctly.

## Public organisations (report without joining)

Some organisations want reports from people who will never be members —
a council taking facility reports from residents, a mall from shoppers, a
campus from students. Orgs opt in by enabling **public mode**; a public
reporter can submit a snag to them and can see **only the snags they
themselves submitted** — nothing else in the org.

### Data model

```sql
alter table public.organisations
  add column is_public boolean not null default false,
  add column public_intake_site_id uuid references public.sites(id);
```

- **No membership rows for public reporters.** Modelling them as a "guest"
  role in `org_memberships` would flood member lists and admin screens with
  thousands of one-off reporters. Instead they simply have an account and
  authored snags.
- **Visibility** is one new branch on the `snags` select policy:
  `... or reporter_id = auth.uid()` — "you can always see what you reported."
  That is exactly the requested visibility rule and nothing more; it also
  covers members' own cross-org reports for free.
- **Intake site**: public reporters have no site membership, and `create_snag`
  currently resolves the site from one. A public org designates a
  `public_intake_site_id` when enabling public mode (e.g. "Public reports");
  a per-facility picker or geolocation can come later.
- **Submission** goes through a dedicated `create_public_snag(p_org_id, ...)`
  RPC that verifies `is_public = true` and stamps
  `snags.is_public_submission = true` (new column) so staff can filter and
  triage public reports — the existing `recategorise_snag` already covers
  re-labelling whatever the public chose.
- **Directory**: a `search_public_orgs(p_query)` security-definer RPC
  returning only the id/name of `is_public` orgs. Private orgs are never
  discoverable; public ones opted in.

### Report-screen UX

Two-button layout on the Report tab, per the sketch:

- **Primary CTA — "Submit Report"** — unchanged, submits to the active org.
  For a user with *no* org at all (pure public reporter), the primary path
  becomes "Choose an organisation" the first time, then remembers their last
  choice.
- **Secondary, quieter button below — "Submit to another organisation…"**
  (outline/ghost variant, consistent with the serious-incident button
  pattern). Opens the org picker.

**Org picker**: search bar pinned on top; then a "Your organisations" section
(the user's memberships, one tap, no search needed); then "Public
organisations" as a 2-column card grid — the sketched 2×4 view works as the
initial viewport, scrolling/paginating beyond it since the public directory
can be large. Cards: org initial/logo, name, a small "Public" badge. A
"Recent" row remembers the last external org so repeat reporting (the common
case — you report to your council more than once) is one tap.

Two guard rails matter for CX here:
- While composing a cross-org report, show a persistent "Reporting to:
  **Auckland Council** — change" pill on the form, so nobody files a photo of
  their employer's broken ladder to the council by accident.
- The success screen must name the receiving org: "SNAG-00123 submitted to
  Auckland Council."

### What the public reporter sees afterwards

A "My reports" list (their submitted snags across all orgs, powered entirely
by the `reporter_id = auth.uid()` policy branch) with status badges. V1 keeps
their view to **status + resolution note only** — org-internal comments stay
hidden (a public/internal comment flag is a future option). They already get
the "Resolved — SNAG-00123" email for free: `notify-snag` emails the
reporter on resolution today.

Public reporters are excluded from votes, points, and leaderboards — those
are internal engagement mechanics.

### Abuse & volume

Public mode invites spam. V1 mitigations to design in: per-user rate limit in
`create_public_snag` (e.g. N reports/hour), an org-side "block this reporter"
action, and the `is_public_submission` flag so floods never drown the
internal list (default the org's Issues tab to internal + a "Public" filter
chip). Photo-required and CAPTCHA-at-signup are heavier options if abuse
materialises.

## Phased delivery plan

**Phase 1 — foundations (invisible).** Create `org_memberships` +
`user_active_org`; backfill one membership row and one active-org row per
existing user from `profiles.org_id`/`role`; swap the bodies of
`current_org_id()`/`current_role()`. No user-visible change; every existing
policy and RPC keeps working. Rollback = swap the two function bodies back.

**Phase 2 — joining a second org.** Update `invite_user`/`accept_invite`/
`join_org_via_code`: drop the "you already belong to an organisation" guard,
insert into `org_memberships`, call `set_active_org` on success. Sign-in org
picker for users with 2+ memberships. Update `remove_org_member` to
soft-remove one membership row (a person removed from one org keeps their
others).

**Phase 3 — switching & admin.** ProfileScreen org switcher;
QR-scan-to-switch in `ScanJoinCodeScreen`; admin dashboard reads its member
list from `org_memberships`; `getProfile()` splits into `getIdentity()` +
`getMemberships()`; App.tsx handles the no-active-org and multi-membership
launch paths.

**Phase 4 — public organisations.** Depends only on Phase 1 (org-agnostic
profiles), not the switcher: `is_public`/`public_intake_site_id`/
`is_public_submission` columns, `create_public_snag` +
`search_public_orgs` RPCs, the `reporter_id = auth.uid()` policy branch, the
two-button Report screen + org picker, "My reports" view, and the no-org
onboarding path (today App.tsx hard-blocks anyone without an org at
OrgSetupScreen; it gains a third option: "just report an issue").

Each phase ships and stabilises independently; single-org users see nothing
until Phase 2 and lose nothing at any point.

## Edge cases & open questions

- **Notifications** already route per-org (`notify-snag` resolves recipients
  via `site_members` per snag) — no change needed for multi-org; verified.
- **Points/leaderboards** are already org-scoped (`user_points.org_id`) — a
  contractor holds separate scores in each org; switching swaps the visible
  leaderboard. No change needed.
- **Zero-membership state**: a user removed from their only org currently has
  nowhere to go; with Phase 4 they gracefully degrade to the public-reporter
  experience instead of a dead end.
- **Device memory**: remember the last active org locally so a reinstall or
  new device lands the user somewhere sensible before they switch.
- **Open — signup friction for the public**: a resident reporting one pothole
  won't tolerate a full email/password signup. Supabase anonymous sign-in
  (later upgradeable to a real account) would cut this to near-zero friction,
  at the cost of weaker abuse controls and no "resolved" email unless they
  add one. Decide at Phase 4 build time.
- **Open — public comment visibility**: whether orgs can post a
  publicly-visible reply on a public snag (v1: no; status + resolution note
  only).
- **Open — rate limits**: exact thresholds for `create_public_snag`, and
  whether blocking a reporter is per-org or platform-wide.
