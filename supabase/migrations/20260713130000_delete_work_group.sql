-- Delete a work group (Admin > Work Groups > Manage Workgroup > Delete).
-- Soft-delete, not a hard DELETE: snags.work_group_id has no ON DELETE
-- clause (NO ACTION), and the business rule is that resolved snags keep
-- their historical work-group link while open ones get unassigned — a hard
-- delete can't express that split (it would either block on the FK or, with
-- CASCADE/SET NULL, clear every referencing row uniformly).
alter table public.work_groups add column deleted_at timestamptz;

create or replace function public.delete_work_group(p_work_group_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org_id uuid := public.current_org_id();
  v_group public.work_groups;
begin
  if public.current_role() <> 'officer_admin' then
    raise exception 'Only an admin can delete a work group';
  end if;

  select * into v_group from public.work_groups
    where id = p_work_group_id and org_id = v_org_id and deleted_at is null;
  if v_group is null then
    raise exception 'Work group not found';
  end if;
  if v_group.is_default then
    raise exception 'The default "Submit" group cannot be deleted';
  end if;

  update public.work_groups set deleted_at = now() where id = p_work_group_id;

  -- Unassign every open (non-resolved) snag still tagged with this group;
  -- resolved snags keep the historical link. Logged per-snag with the same
  -- action assign_snag_work_group(id, null) already uses, so these show up
  -- correctly in each snag's own activity trail.
  with unassigned as (
    update public.snags
      set work_group_id = null
      where work_group_id = p_work_group_id and status <> 'resolved'
      returning id
  )
  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    select v_org_id, 'snag', id, 'work_group_unassigned', auth.uid() from unassigned;

  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    values (v_org_id, 'work_group', p_work_group_id, 'deleted', auth.uid());
end;
$$;

grant execute on function public.delete_work_group(uuid) to authenticated;

-- Deleted groups can't be edited, newly assigned to a snag, or given a new
-- supervisor going forward (existing associations to a now-deleted group are
-- left in place rather than cleaned up — harmless once hidden everywhere).
create or replace function public.update_work_group(
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

create or replace function public.assign_snag_work_group(p_snag_id uuid, p_work_group_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org_id uuid := public.current_org_id();
begin
  if public.current_role() not in ('officer_admin', 'supervisor') then
    raise exception 'Only an admin or supervisor can assign a work group';
  end if;
  if not exists (select 1 from public.snags where id = p_snag_id and org_id = v_org_id) then
    raise exception 'Snag not found';
  end if;
  if p_work_group_id is not null and not exists (
    select 1 from public.work_groups where id = p_work_group_id and org_id = v_org_id and deleted_at is null
  ) then
    raise exception 'That work group does not belong to your organisation';
  end if;

  update public.snags set work_group_id = p_work_group_id where id = p_snag_id;

  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    values (
      v_org_id, 'snag', p_snag_id,
      case when p_work_group_id is null then 'work_group_unassigned' else 'work_group_assigned' end,
      auth.uid()
    );
end;
$$;

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
  if not exists (select 1 from public.work_groups where id = p_work_group_id and org_id = v_org_id and deleted_at is null) then
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
