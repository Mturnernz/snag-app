-- work_group_id was previously only ever set at creation time via
-- create_snag. Bulk actions (and any future per-snag editing) need to be
-- able to change it afterward too.

create function public.assign_snag_work_group(p_snag_id uuid, p_work_group_id uuid)
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
    select 1 from public.work_groups where id = p_work_group_id and org_id = v_org_id
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

grant execute on function public.assign_snag_work_group(uuid, uuid) to authenticated;
