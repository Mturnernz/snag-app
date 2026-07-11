-- Work groups: org-defined sub-teams (e.g. Vehicles, Kitchen, Facilities)
-- that a worker can optionally route a snag to after capturing it. Closely
-- mirrors the sites/site_supervisors pattern, but simpler — a work group
-- only needs a supervisor roster, not a member roster, since workers don't
-- "belong" to one, they just pick one at report time.
--
-- "Submit" is an auto-created, unremovable default group that appears the
-- moment an org has any custom group, so snags are never forced into a
-- subgroup just because the org only created one.

create table public.work_groups (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  name text not null,
  color text,
  image_path text,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  unique (org_id, name)
);

create index on public.work_groups (org_id);

create table public.work_group_supervisors (
  work_group_id uuid not null references public.work_groups(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (work_group_id, user_id)
);

create index on public.work_group_supervisors (user_id);

alter table public.snags add column work_group_id uuid references public.work_groups(id);

alter table public.work_groups enable row level security;
alter table public.work_group_supervisors enable row level security;

create policy "org members can view work groups" on public.work_groups
for select using (org_id = public.current_org_id());

create policy "org members can view work group supervisors" on public.work_group_supervisors
for select using (
  exists (
    select 1 from public.work_groups wg
    where wg.id = work_group_supervisors.work_group_id and wg.org_id = public.current_org_id()
  )
);

-- RPCs ------------------------------------------------------------------

create function public.create_work_group(p_name text, p_color text default null, p_image_path text default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org_id uuid := public.current_org_id();
  v_id uuid;
  v_had_custom boolean;
begin
  if v_org_id is null then
    raise exception 'You must belong to an organisation';
  end if;
  if public.current_role() not in ('officer_admin', 'supervisor') then
    raise exception 'Only an admin or supervisor can create a work group';
  end if;
  if p_name is null or btrim(p_name) = '' then
    raise exception 'Please enter a name';
  end if;
  if lower(btrim(p_name)) = 'submit' then
    raise exception '"Submit" is reserved for the default group';
  end if;

  select exists(select 1 from public.work_groups where org_id = v_org_id and not is_default) into v_had_custom;

  insert into public.work_groups (org_id, name, color, image_path)
    values (v_org_id, btrim(p_name), p_color, p_image_path)
    returning id into v_id;

  -- First custom group in the org: also create the "Submit" default bucket,
  -- so snags never get forced into a subgroup with no unrouted option.
  if not v_had_custom then
    insert into public.work_groups (org_id, name, is_default)
      values (v_org_id, 'Submit', true)
      on conflict (org_id, name) do nothing;
  end if;

  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    values (v_org_id, 'work_group', v_id, 'created', auth.uid());

  return v_id;
end;
$$;

grant execute on function public.create_work_group(text, text, text) to authenticated;

create function public.assign_work_group_supervisor(p_work_group_id uuid, p_user_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org_id uuid := public.current_org_id();
begin
  if public.current_role() <> 'officer_admin' then
    raise exception 'Only an admin can assign a work group supervisor';
  end if;
  if not exists (select 1 from public.work_groups where id = p_work_group_id and org_id = v_org_id) then
    raise exception 'That work group does not belong to your organisation';
  end if;
  if not exists (
    select 1 from public.profiles where id = p_user_id and org_id = v_org_id and role = 'supervisor'
  ) then
    raise exception 'That person is not a supervisor in your organisation';
  end if;

  insert into public.work_group_supervisors (work_group_id, user_id) values (p_work_group_id, p_user_id)
    on conflict (work_group_id, user_id) do nothing;

  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    values (v_org_id, 'work_group', p_work_group_id, 'supervisor_assigned', auth.uid());
end;
$$;

grant execute on function public.assign_work_group_supervisor(uuid, uuid) to authenticated;

create function public.remove_work_group_supervisor(p_work_group_id uuid, p_user_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org_id uuid := public.current_org_id();
begin
  if public.current_role() <> 'officer_admin' then
    raise exception 'Only an admin can remove a work group supervisor';
  end if;
  if not exists (select 1 from public.work_groups where id = p_work_group_id and org_id = v_org_id) then
    raise exception 'That work group does not belong to your organisation';
  end if;

  delete from public.work_group_supervisors where work_group_id = p_work_group_id and user_id = p_user_id;

  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    values (v_org_id, 'work_group', p_work_group_id, 'supervisor_removed', auth.uid());
end;
$$;

grant execute on function public.remove_work_group_supervisor(uuid, uuid) to authenticated;

-- Auto-assignment: extend the sites-precedent trigger with a third candidate
-- source, work group supervisors, unioned in alongside site supervisors and
-- default owners. Same "exactly one candidate total -> auto-assign,
-- otherwise leave unassigned" rule as before — a snag with both a site
-- supervisor and a different work-group supervisor now correctly lands
-- unassigned rather than picking one arbitrarily.
create or replace function public.apply_default_owner()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_count int;
  v_owner uuid;
begin
  if new.owner_id is null then
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
$function$;

-- create_snag: accept an optional work group, validated to belong to the org.
-- Adding a parameter changes the function's signature, so "create or
-- replace" alone would leave the old 7-arg overload in place — drop it
-- explicitly first.
drop function if exists public.create_snag(public.snag_kind, text, public.snag_severity, text[], double precision, double precision, uuid);

create function public.create_snag(
  p_kind public.snag_kind,
  p_description text default null,
  p_severity public.snag_severity default null,
  p_photo_paths text[] default '{}',
  p_latitude double precision default null,
  p_longitude double precision default null,
  p_site_id uuid default null,
  p_work_group_id uuid default null
)
returns table (id uuid, reference text)
language plpgsql security definer set search_path = public as $$
declare
  v_org_id uuid := public.current_org_id();
  v_site_id uuid := p_site_id;
  v_snag_id uuid;
  v_photo_paths text[] := coalesce(p_photo_paths, '{}');
begin
  if v_org_id is null then
    raise exception 'You must belong to an organisation';
  end if;
  if not public.is_org_active(v_org_id) then
    raise exception 'This organisation is no longer active';
  end if;

  if v_site_id is null then
    select site_id into v_site_id from public.site_members where user_id = auth.uid() limit 1;
  end if;
  if v_site_id is null then
    raise exception 'You are not assigned to a site yet';
  end if;
  if not exists (select 1 from public.sites where public.sites.id = v_site_id and public.sites.org_id = v_org_id) then
    raise exception 'That site does not belong to your organisation';
  end if;
  if array_length(v_photo_paths, 1) > 5 then
    raise exception 'A maximum of 5 photos are allowed';
  end if;
  if p_work_group_id is not null and not exists (
    select 1 from public.work_groups where id = p_work_group_id and org_id = v_org_id
  ) then
    raise exception 'That work group does not belong to your organisation';
  end if;

  insert into public.snags (
    org_id, site_id, reporter_id, kind, severity, description, photo_path, photo_paths, latitude, longitude, work_group_id
  ) values (
    v_org_id, v_site_id, auth.uid(), p_kind, p_severity, p_description,
    v_photo_paths[1], v_photo_paths, p_latitude, p_longitude, p_work_group_id
  ) returning public.snags.id into v_snag_id;

  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    values (v_org_id, 'snag', v_snag_id, 'created', auth.uid());

  return query select v_snag_id, s.reference from public.snags s where s.id = v_snag_id;
end;
$$;

-- The drop above wiped create_snag's ACL — re-grant explicitly.
grant execute on function public.create_snag(
  public.snag_kind, text, public.snag_severity, text[], double precision, double precision, uuid, uuid
) to authenticated;

-- Storage: a private bucket for work group logo images, org-folder scoped
-- the same way snag-photos is. Only officer_admin/supervisor upload, since
-- only they can create work groups.
insert into storage.buckets (id, name, public) values ('work-group-images', 'work-group-images', false);

create policy "staff can upload work group images to their org folder"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'work-group-images'
    and (storage.foldername(name))[1] = public.current_org_id()::text
    and public.current_role() in ('officer_admin', 'supervisor')
  );

create policy "org members can view their org's work group images"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'work-group-images'
    and (storage.foldername(name))[1] = public.current_org_id()::text
  );
