-- 1) Supervisors can self-assign/self-unassign as a work group supervisor
-- (previously admin-only). Assigning/removing someone else still requires
-- officer_admin.
create or replace function public.assign_work_group_supervisor(p_work_group_id uuid, p_user_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org_id uuid := public.current_org_id();
begin
  if public.current_role() <> 'officer_admin'
     and not (public.current_role() = 'supervisor' and p_user_id = auth.uid()) then
    raise exception 'Only an admin can assign a work group supervisor, or a supervisor can self-assign';
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

create or replace function public.remove_work_group_supervisor(p_work_group_id uuid, p_user_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org_id uuid := public.current_org_id();
begin
  if public.current_role() <> 'officer_admin'
     and not (public.current_role() = 'supervisor' and p_user_id = auth.uid()) then
    raise exception 'Only an admin can remove a work group supervisor, or a supervisor can self-unassign';
  end if;
  if not exists (select 1 from public.work_groups where id = p_work_group_id and org_id = v_org_id) then
    raise exception 'That work group does not belong to your organisation';
  end if;

  delete from public.work_group_supervisors where work_group_id = p_work_group_id and user_id = p_user_id;

  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    values (v_org_id, 'work_group', p_work_group_id, 'supervisor_removed', auth.uid());
end;
$$;

-- 2) Work groups can be scoped to a single site, or left null for "all
-- sites". Adding a parameter changes create_work_group/update_work_group's
-- signature, so drop the old overloads first.
alter table public.work_groups add column site_id uuid references public.sites(id) on delete set null;
create index on public.work_groups (site_id);

drop function if exists public.create_work_group(text, text, text);

create function public.create_work_group(
  p_name text,
  p_color text default null,
  p_image_path text default null,
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

  insert into public.work_groups (org_id, name, color, image_path, site_id)
    values (v_org_id, btrim(p_name), p_color, p_image_path, p_site_id)
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

grant execute on function public.create_work_group(text, text, text, uuid) to authenticated;

drop function if exists public.update_work_group(uuid, text, text, text);

create function public.update_work_group(
  p_work_group_id uuid,
  p_name text,
  p_color text default null,
  p_image_path text default null,
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
    set name = btrim(p_name), color = p_color, image_path = p_image_path, site_id = p_site_id
    where id = p_work_group_id;

  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    values (v_org_id, 'work_group', p_work_group_id, 'updated', auth.uid());
exception
  when unique_violation then
    raise exception 'A work group with that name already exists';
end;
$$;

grant execute on function public.update_work_group(uuid, text, text, text, uuid) to authenticated;

-- 3) Delete a pending invite (admin or supervisor, org-scoped).
create function public.cancel_invite(p_invite_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org_id uuid := public.current_org_id();
begin
  if public.current_role() not in ('officer_admin', 'supervisor') then
    raise exception 'Only an admin or supervisor can cancel an invite';
  end if;
  if not exists (
    select 1 from public.invites where id = p_invite_id and org_id = v_org_id and status = 'pending'
  ) then
    raise exception 'Invite not found';
  end if;

  delete from public.invites where id = p_invite_id;

  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    values (v_org_id, 'invite', p_invite_id, 'cancelled', auth.uid());
end;
$$;

grant execute on function public.cancel_invite(uuid) to authenticated;
