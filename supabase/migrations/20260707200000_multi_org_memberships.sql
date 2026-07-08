-- Multi-organisation support, Phases 1-3 of Multi-Org-Support-Proposal.md.
--
-- One person can now belong to several organisations, each with its own
-- role. org_memberships holds the (user, org, role) rows; user_active_org
-- tracks which org the user is currently acting in. current_org_id()/
-- current_role() — the two functions gating every RLS policy and RPC — now
-- read from those tables, so the ~50 existing policies/RPCs keep working
-- unmodified.
--
-- profiles.org_id/role are KEPT as a denormalized mirror of the active
-- membership (synced by set_active_org and the membership RPCs) so every
-- deployed client that reads profile.org_id/profile.role keeps working
-- across org switches with no code change.

-- ── 1. Tables ────────────────────────────────────────────────────────────────

create table public.org_memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  org_id uuid not null references public.organisations(id) on delete cascade,
  role public.user_role not null default 'worker',
  removed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, org_id)
);

alter table public.org_memberships enable row level security;

create policy "users can view their own memberships"
  on public.org_memberships for select to authenticated
  using (user_id = auth.uid());

create table public.user_active_org (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  org_id uuid not null references public.organisations(id) on delete cascade,
  updated_at timestamptz not null default now()
);

alter table public.user_active_org enable row level security;

create policy "users can view their own active org"
  on public.user_active_org for select to authenticated
  using (user_id = auth.uid());

-- ── 2. Backfill from the single-org world ────────────────────────────────────
-- profiles.removed_at (the old whole-profile soft-remove) folds into the
-- backfilled membership's removed_at; the column itself is deprecated.

insert into public.org_memberships (user_id, org_id, role, removed_at, created_at)
select id, org_id, role, removed_at, created_at
from public.profiles
where org_id is not null
on conflict (user_id, org_id) do nothing;

insert into public.user_active_org (user_id, org_id)
select id, org_id
from public.profiles
where org_id is not null and removed_at is null
on conflict (user_id) do nothing;

-- profiles.org_id becomes a nullable mirror (null = no active membership).
alter table public.profiles alter column org_id drop not null;

-- ── 3. Swap the two context functions ────────────────────────────────────────
-- Rollback for this whole migration = restore these two bodies to
-- `select org_id/role from profiles where id = auth.uid()`.

create or replace function public.current_org_id() returns uuid
language sql stable security definer set search_path = public as $$
  select uao.org_id
  from public.user_active_org uao
  join public.org_memberships m
    on m.user_id = uao.user_id and m.org_id = uao.org_id and m.removed_at is null
  where uao.user_id = auth.uid();
$$;

create or replace function public."current_role"() returns public.user_role
language sql stable security definer set search_path = public as $$
  select m.role
  from public.user_active_org uao
  join public.org_memberships m
    on m.user_id = uao.user_id and m.org_id = uao.org_id and m.removed_at is null
  where uao.user_id = auth.uid();
$$;

-- Security-definer membership check for use inside RLS policies (avoids
-- recursing into org_memberships' own RLS).
create function public.is_member_of_org(p_user_id uuid, p_org_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.org_memberships
    where user_id = p_user_id and org_id = p_org_id and removed_at is null
  );
$$;

-- ── 4. Policies that assumed profiles.org_id ─────────────────────────────────
-- profiles.org_id now points at the ACTIVE org, so "same org" checks must go
-- through memberships instead.

drop policy "org members can view profiles in their org" on public.profiles;
create policy "org members can view profiles in their org"
  on public.profiles for select to authenticated
  using (
    id = auth.uid()
    or public.is_member_of_org(profiles.id, public.current_org_id())
  );

drop policy "org members can view their organisation" on public.organisations;
create policy "members can view organisations they belong to"
  on public.organisations for select to authenticated
  using (public.is_member_of_org(auth.uid(), organisations.id));

-- ── 5. Switching ─────────────────────────────────────────────────────────────

create function public.set_active_org(p_org_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_role public.user_role;
begin
  select role into v_role from public.org_memberships
    where user_id = auth.uid() and org_id = p_org_id and removed_at is null;
  if v_role is null then
    raise exception 'You are not a member of that organisation';
  end if;

  insert into public.user_active_org (user_id, org_id) values (auth.uid(), p_org_id)
    on conflict (user_id) do update set org_id = excluded.org_id, updated_at = now();

  -- removed_at on profiles is the deprecated whole-profile soft-remove;
  -- clearing it here self-heals users re-added after an old-style removal.
  update public.profiles set org_id = p_org_id, role = v_role, removed_at = null
    where id = auth.uid();
end;
$$;

grant execute on function public.set_active_org(uuid) to authenticated;

create function public.get_my_memberships()
returns table (org_id uuid, org_name text, role public.user_role, is_active boolean)
language sql stable security definer set search_path = public as $$
  select m.org_id, o.name, m.role,
    m.org_id = (select uao.org_id from public.user_active_org uao where uao.user_id = auth.uid())
  from public.org_memberships m
  join public.organisations o on o.id = m.org_id
  where m.user_id = auth.uid() and m.removed_at is null
  order by o.name;
$$;

grant execute on function public.get_my_memberships() to authenticated;

-- ── 6. Membership-aware admin/member reads ───────────────────────────────────
-- The admin member list can no longer come from `profiles where org_id = X`
-- (that column is the active-org mirror); it comes from memberships.

create function public.get_org_members()
returns table (id uuid, org_id uuid, name text, email text, role public.user_role, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select p.id, m.org_id, p.name, p.email, m.role, m.created_at
  from public.org_memberships m
  join public.profiles p on p.id = m.user_id
  where m.org_id = public.current_org_id() and m.removed_at is null
  order by m.created_at asc;
$$;

grant execute on function public.get_org_members() to authenticated;

-- Site memberships span orgs for contractors; scope the default-site lookup
-- to the active org so reports never target another org's site.
create or replace function public.my_member_site_ids()
returns setof uuid
language sql stable security definer set search_path = public as $$
  select sm.site_id
  from public.site_members sm
  join public.sites s on s.id = sm.site_id
  where sm.user_id = auth.uid() and s.org_id = public.current_org_id();
$$;

-- ── 7. Joining flows create memberships (drop the one-org guard) ─────────────

create or replace function public.accept_invite(p_token uuid, p_name text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_invite public.invites;
begin
  if auth.uid() is null then
    raise exception 'Must be signed in';
  end if;

  select * into v_invite from public.invites where token = p_token and status = 'pending';
  if v_invite is null then
    raise exception 'This invite is invalid or has already been used';
  end if;
  if v_invite.expires_at < now() then
    raise exception 'This invite has expired';
  end if;
  if lower(auth.email()) <> v_invite.email then
    raise exception 'This invite was sent to a different email address';
  end if;

  if not exists (select 1 from public.profiles where id = auth.uid()) then
    insert into public.profiles (id, org_id, name, email, role)
      values (auth.uid(), v_invite.org_id, p_name, auth.email(), v_invite.role);
  end if;

  insert into public.org_memberships (user_id, org_id, role)
    values (auth.uid(), v_invite.org_id, v_invite.role)
    on conflict (user_id, org_id) do update set removed_at = null, role = excluded.role;

  perform public.set_active_org(v_invite.org_id);

  if v_invite.site_id is not null then
    insert into public.site_members (site_id, user_id) values (v_invite.site_id, auth.uid())
      on conflict do nothing;
  end if;

  update public.invites set status = 'accepted', accepted_at = now() where id = v_invite.id;
  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    values (v_invite.org_id, 'invite', v_invite.id, 'accepted', auth.uid());
end;
$$;

create or replace function public.join_org_via_code(p_code text, p_name text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org_id uuid;
  v_site_id uuid;
  v_has_profile boolean := exists (select 1 from public.profiles where id = auth.uid());
begin
  if auth.uid() is null then
    raise exception 'Must be signed in';
  end if;

  select id into v_org_id from public.organisations where join_code = p_code;
  if v_org_id is null then
    raise exception 'That join code is invalid';
  end if;

  -- Already a member? Scanning the code is a switch, not an error.
  if exists (
    select 1 from public.org_memberships
    where user_id = auth.uid() and org_id = v_org_id and removed_at is null
  ) then
    perform public.set_active_org(v_org_id);
    return;
  end if;

  if not v_has_profile then
    if p_name is null or btrim(p_name) = '' then
      raise exception 'Please enter your name';
    end if;
    insert into public.profiles (id, org_id, name, email, role)
      values (auth.uid(), v_org_id, btrim(p_name), auth.email(), 'worker');
  end if;

  insert into public.org_memberships (user_id, org_id, role)
    values (auth.uid(), v_org_id, 'worker')
    on conflict (user_id, org_id) do update set removed_at = null, role = 'worker';

  perform public.set_active_org(v_org_id);

  select id into v_site_id from public.sites where org_id = v_org_id order by created_at asc limit 1;
  if v_site_id is not null then
    insert into public.site_members (site_id, user_id) values (v_site_id, auth.uid())
      on conflict do nothing;
  end if;

  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    values (v_org_id, 'organisation', v_org_id, 'joined_via_qr', auth.uid());
end;
$$;

create or replace function public.create_organisation_and_owner(p_org_name text, p_name text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Must be signed in';
  end if;

  insert into public.organisations (name) values (p_org_name) returning id into v_org_id;

  if not exists (select 1 from public.profiles where id = auth.uid()) then
    insert into public.profiles (id, org_id, name, email, role)
      values (auth.uid(), v_org_id, p_name, auth.email(), 'officer_admin');
  end if;

  insert into public.org_memberships (user_id, org_id, role)
    values (auth.uid(), v_org_id, 'officer_admin')
    on conflict (user_id, org_id) do update set removed_at = null, role = 'officer_admin';

  perform public.set_active_org(v_org_id);

  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    values (v_org_id, 'organisation', v_org_id, 'created', auth.uid());

  return v_org_id;
end;
$$;

-- ── 8. Membership-scoped role change & removal ──────────────────────────────

create or replace function public.update_member_role(p_member_id uuid, p_role public.user_role)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org_id uuid := public.current_org_id();
begin
  if public.current_role() <> 'officer_admin' then
    raise exception 'only officer_admin can change member roles';
  end if;
  if p_member_id = auth.uid() then
    raise exception 'cannot change your own role';
  end if;
  if not exists (
    select 1 from public.org_memberships
    where user_id = p_member_id and org_id = v_org_id and removed_at is null
  ) then
    raise exception 'member not found in your organisation';
  end if;

  update public.org_memberships set role = p_role
    where user_id = p_member_id and org_id = v_org_id;

  -- sync the mirror only if this org is the member's active org
  update public.profiles set role = p_role
    where id = p_member_id and org_id = v_org_id;
end;
$$;

create or replace function public.remove_org_member(p_member_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org_id uuid := public.current_org_id();
  v_next public.org_memberships;
begin
  if public.current_role() <> 'officer_admin' then
    raise exception 'Only an admin can remove a member';
  end if;
  if p_member_id = auth.uid() then
    raise exception 'You cannot remove yourself';
  end if;
  if not exists (
    select 1 from public.org_memberships
    where user_id = p_member_id and org_id = v_org_id and removed_at is null
  ) then
    raise exception 'Member not found in your organisation';
  end if;

  update public.org_memberships set removed_at = now()
    where user_id = p_member_id and org_id = v_org_id;

  -- drop their site rows in THIS org only; memberships elsewhere are untouched
  delete from public.site_members sm
    using public.sites s
    where sm.user_id = p_member_id and s.id = sm.site_id and s.org_id = v_org_id;
  delete from public.site_supervisors ss
    using public.sites s
    where ss.user_id = p_member_id and s.id = ss.site_id and s.org_id = v_org_id;

  -- if this was their active org, fall back to their oldest other membership
  if exists (select 1 from public.user_active_org where user_id = p_member_id and org_id = v_org_id) then
    select * into v_next from public.org_memberships
      where user_id = p_member_id and removed_at is null
      order by created_at asc limit 1;
    if v_next.id is not null then
      update public.user_active_org set org_id = v_next.org_id, updated_at = now()
        where user_id = p_member_id;
      update public.profiles set org_id = v_next.org_id, role = v_next.role
        where id = p_member_id;
    else
      delete from public.user_active_org where user_id = p_member_id;
      update public.profiles set org_id = null where id = p_member_id;
    end if;
  end if;

  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    values (v_org_id, 'profile', p_member_id, 'member_removed', auth.uid());
end;
$$;
