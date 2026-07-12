-- Work groups could previously only be named/coloured/imaged at creation
-- time. Let an admin or supervisor edit an existing (non-default) group's
-- name, colour, and image from the "Manage" modal.

create function public.update_work_group(
  p_work_group_id uuid,
  p_name text,
  p_color text default null,
  p_image_path text default null
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

  update public.work_groups
    set name = btrim(p_name), color = p_color, image_path = p_image_path
    where id = p_work_group_id;

  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    values (v_org_id, 'work_group', p_work_group_id, 'updated', auth.uid());
exception
  when unique_violation then
    raise exception 'A work group with that name already exists';
end;
$$;

grant execute on function public.update_work_group(uuid, text, text, text) to authenticated;
