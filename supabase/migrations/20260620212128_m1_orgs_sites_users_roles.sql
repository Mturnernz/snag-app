-- SNAPSHOT of a migration already applied to the Snagv1 project
-- (wpkdpukpllxuyqqlxkxf). Recovered from supabase_migrations.schema_migrations
-- on 2026-07-03. Do NOT re-apply.

-- M1: organisations, sites, users/roles, invites, audit log.
-- All tables are org-scoped and RLS-protected. Writes go through
-- security-definer RPCs so every state change is consistently audited.

create type public.user_role as enum ('worker', 'supervisor', 'officer_admin');

create table public.organisations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  industry text,
  plan_tier text not null default 'free',
  created_at timestamptz not null default now()
);

create table public.sites (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  name text not null,
  location text,
  created_at timestamptz not null default now()
);

-- One row per Supabase Auth user. id matches auth.users.id.
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  org_id uuid not null references public.organisations(id) on delete cascade,
  name text not null default '',
  email text not null,
  role public.user_role not null default 'worker',
  created_at timestamptz not null default now()
);

create table public.site_members (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (site_id, user_id)
);

create table public.invites (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  site_id uuid references public.sites(id) on delete set null,
  email text not null,
  role public.user_role not null default 'worker',
  token uuid not null default gen_random_uuid() unique,
  invited_by uuid not null references public.profiles(id),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked')),
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  expires_at timestamptz not null default (now() + interval '14 days')
);

create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  entity text not null,
  entity_id uuid not null,
  action text not null,
  actor_id uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create index on public.sites (org_id);
create index on public.profiles (org_id);
create index on public.site_members (site_id);
create index on public.site_members (user_id);
create index on public.invites (org_id);
create index on public.audit_log (org_id);

-- Helper functions used inside RLS policies. SECURITY DEFINER avoids
-- recursive RLS lookups when a policy on `profiles` needs `profiles`.
create function public.current_org_id()
returns uuid
language sql stable security definer set search_path = public as $$
  select org_id from public.profiles where id = auth.uid();
$$;

create function public.current_role()
returns public.user_role
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid();
$$;

grant execute on function public.current_org_id() to authenticated;
grant execute on function public.current_role() to authenticated;

alter table public.organisations enable row level security;
alter table public.sites enable row level security;
alter table public.profiles enable row level security;
alter table public.site_members enable row level security;
alter table public.invites enable row level security;
alter table public.audit_log enable row level security;

-- Read access: org members can see their own org's rows.
-- All writes happen through SECURITY DEFINER RPCs below, not direct
-- table grants, so every write is consistently audited.

create policy "org members can view their organisation"
  on public.organisations for select
  using (id = public.current_org_id());

create policy "org members can view sites"
  on public.sites for select
  using (org_id = public.current_org_id());

create policy "org members can view profiles in their org"
  on public.profiles for select
  using (org_id = public.current_org_id());

create policy "users can update their own profile"
  on public.profiles for update
  using (id = auth.uid());

create policy "org members can view site members"
  on public.site_members for select
  using (
    exists (
      select 1 from public.sites s
      where s.id = site_members.site_id and s.org_id = public.current_org_id()
    )
  );

create policy "admins and supervisors view org invites"
  on public.invites for select
  using (org_id = public.current_org_id() and public.current_role() in ('officer_admin', 'supervisor'));

create policy "org members can view their audit log"
  on public.audit_log for select
  using (org_id = public.current_org_id());

-- RPCs --------------------------------------------------------------

-- Called right after a brand-new user's first Supabase Auth session.
-- Creates their organisation and makes them officer_admin.
create function public.create_organisation_and_owner(p_org_name text, p_name text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Must be signed in';
  end if;
  if exists (select 1 from public.profiles where id = auth.uid()) then
    raise exception 'You already belong to an organisation';
  end if;

  insert into public.organisations (name) values (p_org_name) returning id into v_org_id;
  insert into public.profiles (id, org_id, name, email, role)
    values (auth.uid(), v_org_id, p_name, auth.email(), 'officer_admin');
  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    values (v_org_id, 'organisation', v_org_id, 'created', auth.uid());

  return v_org_id;
end;
$$;

grant execute on function public.create_organisation_and_owner(text, text) to authenticated;

create function public.create_site(p_name text, p_location text default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_site_id uuid;
  v_org_id uuid := public.current_org_id();
begin
  if v_org_id is null then
    raise exception 'You must belong to an organisation';
  end if;
  if public.current_role() <> 'officer_admin' then
    raise exception 'Only an admin can create a site';
  end if;

  insert into public.sites (org_id, name, location) values (v_org_id, p_name, p_location)
    returning id into v_site_id;
  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    values (v_org_id, 'site', v_site_id, 'created', auth.uid());

  return v_site_id;
end;
$$;

grant execute on function public.create_site(text, text) to authenticated;

-- Admin/supervisor creates an invite. Email delivery (Resend) lands in M3;
-- for now the caller shares the accept-link generated from the token.
create function public.invite_user(p_email text, p_role public.user_role, p_site_id uuid default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org_id uuid := public.current_org_id();
  v_invite_id uuid;
begin
  if v_org_id is null then
    raise exception 'You must belong to an organisation';
  end if;
  if public.current_role() not in ('officer_admin', 'supervisor') then
    raise exception 'Only an admin or supervisor can invite people';
  end if;
  if p_site_id is not null and not exists (
    select 1 from public.sites where id = p_site_id and org_id = v_org_id
  ) then
    raise exception 'That site does not belong to your organisation';
  end if;

  insert into public.invites (org_id, site_id, email, role, invited_by)
    values (v_org_id, p_site_id, lower(p_email), p_role, auth.uid())
    returning id into v_invite_id;
  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    values (v_org_id, 'invite', v_invite_id, 'created', auth.uid());

  return v_invite_id;
end;
$$;

grant execute on function public.invite_user(text, public.user_role, uuid) to authenticated;

-- Public preview of an invite by token, so the accept-invite page can show
-- "join Acme Construction as a worker" before the invitee signs in.
create function public.get_invite_preview(p_token uuid)
returns table (
  org_name text,
  site_name text,
  role public.user_role,
  email text,
  status text,
  expires_at timestamptz
)
language sql security definer set search_path = public as $$
  select o.name, s.name, i.role, i.email, i.status, i.expires_at
  from public.invites i
  join public.organisations o on o.id = i.org_id
  left join public.sites s on s.id = i.site_id
  where i.token = p_token;
$$;

grant execute on function public.get_invite_preview(uuid) to anon, authenticated;

-- Invitee accepts: must already be signed in with the email the invite was
-- sent to (client signs them up/in first, then calls this).
create function public.accept_invite(p_token uuid, p_name text)
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
  if exists (select 1 from public.profiles where id = auth.uid()) then
    raise exception 'You already belong to an organisation';
  end if;

  insert into public.profiles (id, org_id, name, email, role)
    values (auth.uid(), v_invite.org_id, p_name, auth.email(), v_invite.role);

  if v_invite.site_id is not null then
    insert into public.site_members (site_id, user_id) values (v_invite.site_id, auth.uid());
  end if;

  update public.invites set status = 'accepted', accepted_at = now() where id = v_invite.id;
  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    values (v_invite.org_id, 'invite', v_invite.id, 'accepted', auth.uid());
end;
$$;

grant execute on function public.accept_invite(uuid, text) to authenticated;
