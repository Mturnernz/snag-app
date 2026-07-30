-- Serious incidents get named owners.
--
-- Reported after filing a serious incident: the app said "your organisation's
-- health & safety team has been notified", and nobody could say who that was.
-- It wasn't a lie so much as a guess — `serious_created` mailed every member of
-- the snag's site, so on a site with one member it went to that person, and on a
-- site whose members have no email it went nowhere. There was no such thing as
-- the health & safety team.
--
-- Now there is: `serious_incident_owners` is the set of supervisors an
-- organisation nominates to own serious incidents. They are the ones mailed when
-- one is filed, and the first of them is assigned the snag on the way in, so an
-- incident has a name against it from the moment it exists rather than waiting
-- for someone to notice it.
--
-- Three deliberate choices:
--
-- * **Multiple owners, not one.** A single named person is a single point of
--   failure on the one thing in this app with a statutory clock on it. Any
--   supervisor or admin can be added.
-- * **Never zero.** `remove_serious_incident_owner` refuses to remove the last
--   one, and a new org's creator is made the first. "Ensure a member is
--   allocated" has to be a rule, not a prompt someone can skip.
-- * **Assignment only fills a gap.** The owner is set only when the snag has
--   none, so it never overrides a site's own default owner rules or an
--   assignment someone made deliberately.

begin;

create table if not exists public.serious_incident_owners (
  org_id uuid not null references public.organisations(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  added_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  primary key (org_id, profile_id)
);

-- Ordering is load-bearing: the earliest-added owner is the one a new incident
-- is assigned to, so "who gets it" is stable and explainable rather than
-- whichever row the planner returned first.
create index if not exists serious_incident_owners_org_created_idx
  on public.serious_incident_owners (org_id, created_at);

alter table public.serious_incident_owners enable row level security;

-- Any member can read them. The app tells a reporter their incident went to the
-- health & safety team, and that claim should be checkable by the person who
-- filed it — not just by managers.
drop policy if exists "org members can read serious incident owners" on public.serious_incident_owners;
create policy "org members can read serious incident owners"
  on public.serious_incident_owners for select to authenticated
  using (org_id = public.current_org_id());

-- No write policies: every change goes through the two functions below, which
-- enforce the role check and the last-owner rule.

create or replace function public.add_serious_incident_owner(p_profile_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org_id uuid := public.current_org_id();
begin
  if v_org_id is null then
    raise exception 'You must belong to an organisation';
  end if;
  if public.current_role() not in ('supervisor', 'officer_admin') then
    raise exception 'Only a supervisor or an admin can change who owns serious incidents';
  end if;
  -- Owning a serious incident means running an investigation, which
  -- require_investigation_access only grants to supervisors and admins. Adding
  -- a worker here would name an owner who is refused by every RPC the job
  -- consists of.
  if not exists (
    select 1 from public.org_memberships m
    where m.user_id = p_profile_id
      and m.org_id = v_org_id
      and m.removed_at is null
      and m.role in ('supervisor', 'officer_admin')
  ) then
    raise exception 'Serious incidents can only be owned by a supervisor or an admin of this organisation';
  end if;

  insert into public.serious_incident_owners (org_id, profile_id, added_by)
    values (v_org_id, p_profile_id, auth.uid())
    on conflict (org_id, profile_id) do nothing;

  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    values (v_org_id, 'organisation', v_org_id, 'serious_incident_owner_added', auth.uid());
end;
$$;

create or replace function public.remove_serious_incident_owner(p_profile_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org_id uuid := public.current_org_id();
begin
  if v_org_id is null then
    raise exception 'You must belong to an organisation';
  end if;
  if public.current_role() not in ('supervisor', 'officer_admin') then
    raise exception 'Only a supervisor or an admin can change who owns serious incidents';
  end if;
  -- The whole point is that a serious incident always has somebody's name on
  -- it. An org with nobody nominated is the state this migration exists to
  -- remove, so it can't be reached by removing people one at a time.
  if (select count(*) from public.serious_incident_owners where org_id = v_org_id) <= 1 then
    raise exception 'Someone has to own serious incidents. Add another owner before removing this one.';
  end if;

  delete from public.serious_incident_owners
    where org_id = v_org_id and profile_id = p_profile_id;

  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    values (v_org_id, 'organisation', v_org_id, 'serious_incident_owner_removed', auth.uid());
end;
$$;

-- A new org's creator owns serious incidents until they say otherwise. They are
-- the only member at that point, so there is no choice to offer — and leaving
-- it unset would put every org one forgotten setting away from the state this
-- migration fixes.
create or replace function public.create_organisation_and_owner(p_org_name text, p_name text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org_id uuid;
  v_site_id uuid;
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

  -- Every org needs at least one site or snags can't be reported. Give the
  -- new org a starter site and make the owner its member, supervisor, and
  -- default owner so reporting works immediately.
  insert into public.sites (org_id, name) values (v_org_id, 'Main site') returning id into v_site_id;
  insert into public.site_members (site_id, user_id) values (v_site_id, auth.uid());
  insert into public.site_supervisors (site_id, user_id) values (v_site_id, auth.uid());
  insert into public.site_default_owners (site_id, owner_id) values (v_site_id, auth.uid());

  insert into public.serious_incident_owners (org_id, profile_id, added_by)
    values (v_org_id, auth.uid(), auth.uid())
    on conflict (org_id, profile_id) do nothing;

  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    values (v_org_id, 'organisation', v_org_id, 'created', auth.uid());

  return v_org_id;
end;
$$;

-- Assign the snag on the way in.
--
-- `lane` is a generated column, so it is not readable from a BEFORE trigger —
-- the lane test has to be on `kind`, which is what generates it.
--
-- The serious branch takes precedence over the existing single-candidate rule
-- because that rule is about routine work reaching whoever runs a site, and
-- this is about an incident reaching the person accountable for incidents.
create or replace function public.apply_default_owner()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_count int;
  v_owner uuid;
  v_is_serious boolean := new.kind not in ('fixit', 'improvement');
begin
  if new.owner_id is null and v_is_serious then
    select o.profile_id into v_owner
      from public.serious_incident_owners o
      where o.org_id = new.org_id
      order by o.created_at, o.profile_id
      limit 1;
    if v_owner is not null then
      new.owner_id := v_owner;
      new.assigned_at := now();
    end if;
  end if;

  if new.owner_id is null and tg_op = 'INSERT' then
    with candidates as (
      select user_id as uid from public.site_supervisors where site_id = new.site_id
      union
      select owner_id as uid from public.site_default_owners
        where site_id = new.site_id and owner_id is not null
      union
      select user_id as uid from public.work_group_supervisors
        where new.work_group_id is not null and work_group_id = new.work_group_id
    )
    select count(*), (array_agg(uid))[1] into v_count, v_owner from candidates;

    if v_count = 1 then
      new.owner_id := v_owner;
      new.assigned_at := now();
    end if;
  end if;

  return new;
end;
$$;

-- Escalation turns a niggle into a hazard, which is a serious snag arriving
-- through a different door. An escalated snag that nobody owned would otherwise
-- stay unowned.
drop trigger if exists snags_apply_default_owner on public.snags;
create trigger snags_apply_default_owner
  before insert or update of kind on public.snags
  for each row execute function public.apply_default_owner();

-- Backfill: every existing org gets its longest-standing admin, falling back to
-- its longest-standing supervisor. Without this, only orgs created from now on
-- have anyone nominated, and the org that reported this stays exactly as it was.
insert into public.serious_incident_owners (org_id, profile_id)
select m.org_id, m.user_id
from public.org_memberships m
where m.removed_at is null
  and m.role in ('supervisor', 'officer_admin')
  and not exists (
    select 1 from public.serious_incident_owners o where o.org_id = m.org_id
  )
  and m.user_id = (
    select m2.user_id from public.org_memberships m2
    where m2.org_id = m.org_id and m2.removed_at is null
      and m2.role in ('supervisor', 'officer_admin')
    order by (m2.role = 'officer_admin') desc, m2.created_at, m2.user_id
    limit 1
  )
on conflict (org_id, profile_id) do nothing;

commit;
