-- SNAPSHOT of a migration already applied to the Snagv1 project
-- (wpkdpukpllxuyqqlxkxf). Recovered from supabase_migrations.schema_migrations
-- on 2026-07-03. Do NOT re-apply.
-- Identical re-application of 20260621182804 — see that file for the SQL.
-- Content preserved verbatim below for a faithful history.

-- create_snag now returns the new snag's reference alongside its id, so the
-- reporter can see "Snagged — SNAG-00042" right after submitting.
drop function public.create_snag(
  public.snag_kind, text, public.snag_severity, text, double precision, double precision, uuid
);

create function public.create_snag(
  p_kind public.snag_kind,
  p_description text default null,
  p_severity public.snag_severity default null,
  p_photo_path text default null,
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
  if not exists (select 1 from public.sites where id = v_site_id and org_id = v_org_id) then
    raise exception 'That site does not belong to your organisation';
  end if;

  insert into public.snags (
    org_id, site_id, reporter_id, kind, severity, description, photo_path, latitude, longitude
  ) values (
    v_org_id, v_site_id, auth.uid(), p_kind, p_severity, p_description, p_photo_path, p_latitude, p_longitude
  ) returning public.snags.id into v_snag_id;

  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    values (v_org_id, 'snag', v_snag_id, 'created', auth.uid());

  return query select v_snag_id, s.reference from public.snags s where s.id = v_snag_id;
end;
$$;

grant execute on function public.create_snag(
  public.snag_kind, text, public.snag_severity, text, double precision, double precision, uuid
) to authenticated;
