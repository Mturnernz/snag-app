-- create_snag's RETURNS TABLE(id uuid, ...) introduces an OUT parameter named
-- "id" in the function's namespace. The site-ownership check referenced the
-- sites table's id column unqualified, so Postgres couldn't tell it apart
-- from the OUT parameter and raised "column reference \"id\" is ambiguous"
-- on every submit.

create or replace function public.create_snag(
  p_kind public.snag_kind,
  p_description text default null,
  p_severity public.snag_severity default null,
  p_photo_paths text[] default '{}',
  p_latitude double precision default null,
  p_longitude double precision default null,
  p_site_id uuid default null
)
returns table (id uuid, reference text)
language plpgsql security definer set search_path = public as $$
declare
  v_org_id uuid := public.current_org_id();
  v_site_id uuid := p_site_id;
  v_snag_id uuid;
  v_photo_paths text[] := coalesce(p_photo_paths, '{}');
begin
  if v_org_id is null then
    raise exception 'You must belong to an organisation';
  end if;

  if v_site_id is null then
    select site_id into v_site_id from public.site_members where user_id = auth.uid() limit 1;
  end if;
  if v_site_id is null then
    raise exception 'You are not assigned to a site yet';
  end if;
  if not exists (select 1 from public.sites where public.sites.id = v_site_id and public.sites.org_id = v_org_id) then
    raise exception 'That site does not belong to your organisation';
  end if;
  if array_length(v_photo_paths, 1) > 5 then
    raise exception 'A maximum of 5 photos are allowed';
  end if;

  insert into public.snags (
    org_id, site_id, reporter_id, kind, severity, description, photo_path, photo_paths, latitude, longitude
  ) values (
    v_org_id, v_site_id, auth.uid(), p_kind, p_severity, p_description,
    v_photo_paths[1], v_photo_paths, p_latitude, p_longitude
  ) returning public.snags.id into v_snag_id;

  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    values (v_org_id, 'snag', v_snag_id, 'created', auth.uid());

  return query select v_snag_id, s.reference from public.snags s where s.id = v_snag_id;
end;
$$;
