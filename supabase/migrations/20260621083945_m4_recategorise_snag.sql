-- SNAPSHOT of a migration already applied to the Snagv1 project
-- (wpkdpukpllxuyqqlxkxf). Recovered from supabase_migrations.schema_migrations
-- on 2026-07-03. Do NOT re-apply.

create function public.recategorise_snag(
  p_snag_id uuid,
  p_kind public.snag_kind,
  p_severity public.snag_severity default null
)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org_id uuid := public.current_org_id();
  v_snag public.snags;
  v_was_serious boolean;
begin
  select * into v_snag from public.snags where id = p_snag_id and org_id = v_org_id;
  if v_snag is null then
    raise exception 'Snag not found';
  end if;
  if public.current_role() not in ('officer_admin', 'supervisor') then
    raise exception 'Only a supervisor or admin can recategorise a snag';
  end if;
  if p_kind in ('hazard', 'incident') and p_severity is null then
    raise exception 'A hazard or incident needs a severity';
  end if;

  v_was_serious := v_snag.lane = 'serious';

  update public.snags
    set kind = p_kind,
        severity = case when p_kind in ('hazard', 'incident') then p_severity else null end
    where id = p_snag_id;

  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    values (v_org_id, 'snag', p_snag_id, 'recategorised_to_' || p_kind, auth.uid());

  if not v_was_serious and p_kind in ('hazard', 'incident') then
    perform public.dispatch_snag_notification(p_snag_id, 'serious_created');
  end if;
end;
$$;

grant execute on function public.recategorise_snag(uuid, public.snag_kind, public.snag_severity) to authenticated;
