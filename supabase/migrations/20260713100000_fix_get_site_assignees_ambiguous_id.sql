-- get_site_assignees has RETURNS TABLE(id uuid, name text, role user_role),
-- which implicitly declares id/name/role as OUT parameters in the plpgsql
-- body. The site lookup's unqualified "where id = p_site_id" collided with
-- the OUT parameter, throwing "column reference \"id\" is ambiguous" on
-- every call — the owner picker has always come back empty as a result.
create or replace function public.get_site_assignees(p_site_id uuid)
returns table(id uuid, name text, role user_role)
language plpgsql security definer set search_path = public as $$
declare
  v_org_id uuid;
begin
  select s.org_id into v_org_id from public.sites s where s.id = p_site_id;
  if v_org_id is null or v_org_id <> public.current_org_id() then
    raise exception 'Site not found';
  end if;

  return query
  select p.id, p.name, m.role
  from public.org_memberships m
  join public.profiles p on p.id = m.user_id
  where m.org_id = v_org_id
    and m.removed_at is null
    and (
      m.role = 'officer_admin'
      or m.user_id in (select user_id from public.site_members where site_id = p_site_id)
      or m.user_id in (select user_id from public.site_supervisors where site_id = p_site_id)
    )
  order by
    case m.role when 'officer_admin' then 0 when 'supervisor' then 1 else 2 end,
    p.name;
end;
$$;

grant execute on function public.get_site_assignees(uuid) to authenticated;
