-- Site-scoped assignment + unassigned triage queue.
--
-- Previously every niggle was auto-assigned to the site's single default owner,
-- and an owner could be any org member. Now: a snag lands UNASSIGNED unless the
-- site has exactly one supervisor/owner (then it auto-assigns to that person),
-- and owner assignment is scoped to the snag's own site (its members and
-- supervisors) plus the org's admins, who oversee every site.
--
-- SNAPSHOT — do NOT re-apply. Applied live to Snagv1 (wpkdpukpllxuyqqlxkxf).

-- 1. Auto-assign only when a site has a single candidate; otherwise leave the
--    snag unassigned for supervisors to triage. Applies to both lanes.
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
    )
    select count(*), min(uid) into v_count, v_owner from candidates;

    if v_count = 1 then
      new.owner_id := v_owner;
      new.assigned_at := now();
    end if;
  end if;
  return new;
end;
$function$;

-- 2. The people who can own a snag at a given site: the site's members and
--    supervisors, plus the org's admins. Role is read from the active org
--    membership so it is correct for multi-org users.
create or replace function public.get_site_assignees(p_site_id uuid)
returns table(id uuid, name text, role user_role)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_org_id uuid;
begin
  select org_id into v_org_id from public.sites where id = p_site_id;
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
$function$;

grant execute on function public.get_site_assignees(uuid) to authenticated;

-- 3. Scope owner assignment to the snag's site (members/supervisors) or an org
--    admin, and support unassigning (owner_id = null) back into the queue.
create or replace function public.assign_snag_owner(p_snag_id uuid, p_owner_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_org_id uuid := public.current_org_id();
  v_snag public.snags;
begin
  if public.current_role() not in ('officer_admin', 'supervisor') then
    raise exception 'Only an admin or supervisor can assign an owner';
  end if;

  select * into v_snag from public.snags where id = p_snag_id and org_id = v_org_id;
  if v_snag is null then
    raise exception 'Snag not found';
  end if;

  if p_owner_id is not null and not (
    p_owner_id in (select user_id from public.site_members where site_id = v_snag.site_id)
    or p_owner_id in (select user_id from public.site_supervisors where site_id = v_snag.site_id)
    or exists (
      select 1 from public.org_memberships m
      where m.user_id = p_owner_id and m.org_id = v_snag.org_id
        and m.removed_at is null and m.role = 'officer_admin'
    )
  ) then
    raise exception 'You can only assign someone who belongs to this snag''s site';
  end if;

  update public.snags
    set owner_id = p_owner_id,
        assigned_at = case when p_owner_id is null then null else now() end
    where id = p_snag_id;

  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    values (
      v_org_id, 'snag', p_snag_id,
      case when p_owner_id is null then 'owner_unassigned' else 'owner_assigned' end,
      auth.uid()
    );
end;
$function$;
