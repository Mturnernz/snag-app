-- Per-site breakdown for the supervisor "outstanding work" dashboard —
-- get_org_stats is org-wide only and can't be grouped by site without a
-- rewrite, so this is a separate RPC rather than an extension of it.
-- "Overdue" is defined off corrective_actions.due_date (snags themselves
-- have no due-date concept), using the same done-and-verified definition
-- as update_snag_status's resolve gate. Same org-boundary-only permission
-- shape as get_org_stats (available to any org member; role-gating happens
-- at the UI/tab level) — no anon-executable gap this time, revoked up front
-- rather than needing a follow-up hardening migration.
create function public.get_site_breakdown(p_org_id uuid)
returns table (
  site_id uuid,
  site_name text,
  open_investigations bigint,
  unassigned bigint,
  overdue_actions bigint
)
language plpgsql stable security definer set search_path = public as $$
begin
  if p_org_id is distinct from public.current_org_id() then
    raise exception 'Site breakdown is only available for your active organisation';
  end if;

  return query
  select
    s.id as site_id,
    s.name as site_name,
    coalesce(inv.cnt, 0) as open_investigations,
    coalesce(un.cnt, 0) as unassigned,
    coalesce(od.cnt, 0) as overdue_actions
  from public.sites s
  left join (
    select site_id, count(*) as cnt
    from public.snags
    where org_id = p_org_id and lane = 'serious' and status in ('flagged', 'in_progress', 'rca_pending')
    group by site_id
  ) inv on inv.site_id = s.id
  left join (
    select site_id, count(*) as cnt
    from public.snags
    where org_id = p_org_id and owner_id is null and status in ('flagged', 'in_progress')
    group by site_id
  ) un on un.site_id = s.id
  left join (
    select sn.site_id, count(*) as cnt
    from public.corrective_actions ca
    join public.snags sn on sn.id = ca.snag_id
    where sn.org_id = p_org_id
      and ca.due_date < current_date
      and not (ca.status = 'done' and ca.verified_by is not null)
    group by sn.site_id
  ) od on od.site_id = s.id
  where s.org_id = p_org_id
  order by s.name;
end;
$$;

grant execute on function public.get_site_breakdown(uuid) to authenticated;
revoke execute on function public.get_site_breakdown(uuid) from public, anon;
