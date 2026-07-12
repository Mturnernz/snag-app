-- The Admin dashboard and Reports screen previously selected every snag row
-- in the org (status/kind/severity) and counted client-side — O(total snags)
-- over the wire on every tab focus. Aggregate server-side in one pass.
create function public.get_org_stats(p_org_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_result jsonb;
begin
  -- Same boundary the old direct select had via RLS: your own active org.
  if p_org_id is distinct from public.current_org_id() then
    raise exception 'Stats are only available for your active organisation';
  end if;

  select jsonb_build_object(
    'total_snags', count(*),
    'by_status', jsonb_build_object(
      'flagged',     count(*) filter (where status = 'flagged'),
      'in_progress', count(*) filter (where status = 'in_progress'),
      'resolved',    count(*) filter (where status = 'resolved'),
      'rca_pending', count(*) filter (where status = 'rca_pending')),
    'by_kind', jsonb_build_object(
      'fixit',       count(*) filter (where kind = 'fixit'),
      'improvement', count(*) filter (where kind = 'improvement'),
      'hazard',      count(*) filter (where kind = 'hazard'),
      'incident',    count(*) filter (where kind = 'incident')),
    'by_severity', jsonb_build_object(
      'minor',    count(*) filter (where severity = 'minor'),
      'moderate', count(*) filter (where severity = 'moderate'),
      'injury',   count(*) filter (where severity = 'injury'),
      'critical', count(*) filter (where severity = 'critical'))
  ) into v_result
  from public.snags
  where org_id = p_org_id;

  -- Count memberships, not profiles.org_id (which is just the active-org
  -- mirror and undercounts multi-org members parked on another org).
  return v_result || jsonb_build_object(
    'total_members',
    (select count(*) from public.org_memberships where org_id = p_org_id and removed_at is null)
  );
end;
$$;

grant execute on function public.get_org_stats(uuid) to authenticated;
