-- Work groups can now be scoped to any number of sites (previously at most
-- one, via work_groups.site_id — null meant "all sites"). Replaces that
-- single nullable FK with a join table; an empty join means "all sites",
-- same semantics as null did before.
create table public.work_group_sites (
  work_group_id uuid not null references public.work_groups(id) on delete cascade,
  site_id uuid not null references public.sites(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (work_group_id, site_id)
);

create index on public.work_group_sites (site_id);

alter table public.work_group_sites enable row level security;

create policy "org members can view work group sites" on public.work_group_sites
for select using (
  exists (
    select 1 from public.work_groups wg
    where wg.id = work_group_sites.work_group_id and wg.org_id = public.current_org_id()
  )
);

-- Backfill: each work group's existing single site becomes a one-row join.
insert into public.work_group_sites (work_group_id, site_id)
  select id, site_id from public.work_groups where site_id is not null;

drop function if exists public.create_work_group(text, text, uuid);

create function public.create_work_group(
  p_name text,
  p_color text default null,
  p_site_ids uuid[] default '{}'
)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org_id uuid := public.current_org_id();
  v_id uuid;
  v_had_custom boolean;
  v_site_ids uuid[] := coalesce(p_site_ids, '{}');
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
  if exists (
    select 1 from unnest(v_site_ids) s(id)
    where not exists (select 1 from public.sites where public.sites.id = s.id and org_id = v_org_id)
  ) then
    raise exception 'That site does not belong to your organisation';
  end if;

  select exists(select 1 from public.work_groups where org_id = v_org_id and not is_default) into v_had_custom;

  insert into public.work_groups (org_id, name, color)
    values (v_org_id, btrim(p_name), p_color)
    returning id into v_id;

  insert into public.work_group_sites (work_group_id, site_id)
    select v_id, s.id from unnest(v_site_ids) s(id);

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

grant execute on function public.create_work_group(text, text, uuid[]) to authenticated;

drop function if exists public.update_work_group(uuid, text, text, uuid);

create function public.update_work_group(
  p_work_group_id uuid,
  p_name text,
  p_color text default null,
  p_site_ids uuid[] default '{}'
)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org_id uuid := public.current_org_id();
  v_group public.work_groups;
  v_site_ids uuid[] := coalesce(p_site_ids, '{}');
begin
  if public.current_role() not in ('officer_admin', 'supervisor') then
    raise exception 'Only an admin or supervisor can edit a work group';
  end if;

  select * into v_group from public.work_groups where id = p_work_group_id and org_id = v_org_id and deleted_at is null;
  if v_group is null then
    raise exception 'Work group not found';
  end if;
  if v_group.is_default then
    raise exception 'The default "Submit" group cannot be edited';
  end if;
  if p_name is null or btrim(p_name) = '' then
    raise exception 'Please enter a name';
  end if;
  if lower(btrim(p_name)) = 'submit' then
    raise exception '"Submit" is reserved for the default group';
  end if;
  if exists (
    select 1 from unnest(v_site_ids) s(id)
    where not exists (select 1 from public.sites where public.sites.id = s.id and org_id = v_org_id)
  ) then
    raise exception 'That site does not belong to your organisation';
  end if;

  update public.work_groups set name = btrim(p_name), color = p_color where id = p_work_group_id;

  delete from public.work_group_sites where work_group_id = p_work_group_id;
  insert into public.work_group_sites (work_group_id, site_id)
    select p_work_group_id, s.id from unnest(v_site_ids) s(id);

  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    values (v_org_id, 'work_group', p_work_group_id, 'updated', auth.uid());
exception
  when unique_violation then
    raise exception 'A work group with that name already exists';
end;
$$;

grant execute on function public.update_work_group(uuid, text, text, uuid[]) to authenticated;

alter table public.work_groups drop column site_id;
