-- Date-range/trend RPC for the reporting screens (SNAG_WEB_APP_PLAN.md §4/§10,
-- decision D3) — get_org_stats and get_site_breakdown are snapshot-only, so
-- a period comparison (this quarter vs last, a monthly trend chart) needed
-- a new RPC rather than a rename of what exists. Same org-boundary
-- permission shape as get_org_stats/get_site_breakdown.
create function public.get_org_snag_trend(
  p_org_id uuid,
  p_start_date date,
  p_end_date date,
  p_bucket text default 'week'
)
returns table (
  period date,
  total bigint,
  flagged bigint,
  in_progress bigint,
  resolved bigint,
  rca_pending bigint
)
language plpgsql stable security definer set search_path = public as $$
begin
  if p_org_id is distinct from public.current_org_id() then
    raise exception 'Snag trend is only available for your active organisation';
  end if;
  if p_bucket not in ('week', 'month') then
    raise exception 'p_bucket must be ''week'' or ''month''';
  end if;

  return query
  select
    date_trunc(p_bucket, s.created_at)::date as period,
    count(*) as total,
    count(*) filter (where s.status = 'flagged') as flagged,
    count(*) filter (where s.status = 'in_progress') as in_progress,
    count(*) filter (where s.status = 'resolved') as resolved,
    count(*) filter (where s.status = 'rca_pending') as rca_pending
  from public.snags s
  where s.org_id = p_org_id
    and s.created_at >= p_start_date
    and s.created_at < p_end_date + interval '1 day'
  group by 1
  order by 1;
end;
$$;

grant execute on function public.get_org_snag_trend(uuid, date, date, text) to authenticated;
revoke execute on function public.get_org_snag_trend(uuid, date, date, text) from public, anon;
