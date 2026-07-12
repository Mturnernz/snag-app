-- Work groups are colour-only now — the image-upload capability is being
-- removed from the app entirely. Confirmed zero work groups have an
-- image_path set and the work-group-images bucket is empty, so this is a
-- zero-data-loss cleanup. (The now-unused, empty work-group-images bucket
-- itself is left in place — Supabase blocks direct SQL deletes on storage
-- tables; removing it would need the Storage API/dashboard.)

drop function if exists public.create_work_group(text, text, text, uuid);

create function public.create_work_group(
  p_name text,
  p_color text default null,
  p_site_id uuid default null
)
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
  if p_site_id is not null and not exists (
    select 1 from public.sites where id = p_site_id and org_id = v_org_id
  ) then
    raise exception 'That site does not belong to your organisation';
  end if;

  select exists(select 1 from public.work_groups where org_id = v_org_id and not is_default) into v_had_custom;

  insert into public.work_groups (org_id, name, color, site_id)
    values (v_org_id, btrim(p_name), p_color, p_site_id)
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

grant execute on function public.create_work_group(text, text, uuid) to authenticated;

drop function if exists public.update_work_group(uuid, text, text, text, uuid);

create function public.update_work_group(
  p_work_group_id uuid,
  p_name text,
  p_color text default null,
  p_site_id uuid default null
)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org_id uuid := public.current_org_id();
  v_group public.work_groups;
begin
  if public.current_role() not in ('officer_admin', 'supervisor') then
    raise exception 'Only an admin or supervisor can edit a work group';
  end if;

  select * into v_group from public.work_groups where id = p_work_group_id and org_id = v_org_id;
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
  if p_site_id is not null and not exists (
    select 1 from public.sites where id = p_site_id and org_id = v_org_id
  ) then
    raise exception 'That site does not belong to your organisation';
  end if;

  update public.work_groups
    set name = btrim(p_name), color = p_color, site_id = p_site_id
    where id = p_work_group_id;

  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    values (v_org_id, 'work_group', p_work_group_id, 'updated', auth.uid());
exception
  when unique_violation then
    raise exception 'A work group with that name already exists';
end;
$$;

grant execute on function public.update_work_group(uuid, text, text, uuid) to authenticated;

alter table public.work_groups drop column image_path;

drop policy if exists "staff can upload work group images to their org folder" on storage.objects;
drop policy if exists "org members can view their org's work group images" on storage.objects;
