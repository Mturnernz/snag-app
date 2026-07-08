-- Standing, regenerable QR join code per organisation. Unlike per-person
-- invites (which target one email), this lets anyone who scans it join as
-- a worker; regenerating invalidates every QR code printed against the old
-- value.

alter table public.organisations
  add column join_code text unique default encode(gen_random_bytes(5), 'hex');

update public.organisations set join_code = encode(gen_random_bytes(5), 'hex') where join_code is null;

alter table public.organisations alter column join_code set not null;

create function public.regenerate_org_join_code()
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_org_id uuid := public.current_org_id();
  v_code text;
begin
  if public.current_role() <> 'officer_admin' then
    raise exception 'Only an admin can regenerate the join code';
  end if;

  v_code := encode(gen_random_bytes(5), 'hex');
  update public.organisations set join_code = v_code where id = v_org_id;

  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    values (v_org_id, 'organisation', v_org_id, 'join_code_regenerated', auth.uid());

  return v_code;
end;
$$;

grant execute on function public.regenerate_org_join_code() to authenticated;

create function public.get_org_by_join_code(p_code text)
returns table (org_id uuid, org_name text)
language sql security definer set search_path = public stable as $$
  select id, name from public.organisations where join_code = p_code;
$$;

grant execute on function public.get_org_by_join_code(text) to authenticated;

create function public.join_org_via_code(p_code text, p_name text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org_id uuid;
  v_site_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Must be signed in';
  end if;
  if exists (select 1 from public.profiles where id = auth.uid()) then
    raise exception 'You already belong to an organisation';
  end if;
  if p_name is null or btrim(p_name) = '' then
    raise exception 'Please enter your name';
  end if;

  select id into v_org_id from public.organisations where join_code = p_code;
  if v_org_id is null then
    raise exception 'That join code is invalid';
  end if;

  insert into public.profiles (id, org_id, name, email, role)
    values (auth.uid(), v_org_id, btrim(p_name), auth.email(), 'worker');

  select id into v_site_id from public.sites where org_id = v_org_id order by created_at asc limit 1;
  if v_site_id is not null then
    insert into public.site_members (site_id, user_id) values (v_site_id, auth.uid())
      on conflict do nothing;
  end if;

  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    values (v_org_id, 'organisation', v_org_id, 'joined_via_qr', auth.uid());
end;
$$;

grant execute on function public.join_org_via_code(text, text) to authenticated;
