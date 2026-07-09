-- Fix: newly created organisations had no site, but create_snag requires one,
-- so a fresh org's owner could never report a snag ("no site found"). Give
-- every new org a starter site and wire the owner into it. Also add an admin
-- rename-organisation RPC (organisations has no client UPDATE policy).

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

  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    values (v_org_id, 'organisation', v_org_id, 'created', auth.uid());

  return v_org_id;
end;
$$;

-- Backfill: give every existing site-less org a 'Main site' and wire its
-- owner (earliest officer_admin membership) into it.
do $$
declare
  r record;
  v_site_id uuid;
  v_owner uuid;
begin
  for r in
    select o.id from public.organisations o
    where not exists (select 1 from public.sites s where s.org_id = o.id)
  loop
    insert into public.sites (org_id, name) values (r.id, 'Main site') returning id into v_site_id;

    select user_id into v_owner from public.org_memberships
      where org_id = r.id and removed_at is null
      order by (role = 'officer_admin') desc, created_at asc
      limit 1;

    if v_owner is not null then
      insert into public.site_members (site_id, user_id) values (v_site_id, v_owner) on conflict do nothing;
      insert into public.site_supervisors (site_id, user_id) values (v_site_id, v_owner) on conflict do nothing;
      insert into public.site_default_owners (site_id, owner_id) values (v_site_id, v_owner) on conflict do nothing;
    end if;
  end loop;
end $$;

create function public.rename_organisation(p_name text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org_id uuid := public.current_org_id();
begin
  if public.current_role() <> 'officer_admin' then
    raise exception 'Only an admin can rename the organisation';
  end if;
  if p_name is null or btrim(p_name) = '' then
    raise exception 'Organisation name cannot be empty';
  end if;

  update public.organisations set name = btrim(p_name) where id = v_org_id;

  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    values (v_org_id, 'organisation', v_org_id, 'renamed', auth.uid());
end;
$$;

grant execute on function public.rename_organisation(text) to authenticated;
