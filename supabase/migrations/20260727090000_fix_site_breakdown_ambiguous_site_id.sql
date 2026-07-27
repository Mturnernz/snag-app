-- Fixes get_site_breakdown, which raised
--   column reference "site_id" is ambiguous
-- for every organisation, so the dashboard's "By site" panel was broken in both
-- clients: the web portal's (portal)/dashboard page and mobile's
-- AdminDashboardScreen, which call the same RPC.
--
-- The function is declared RETURNS TABLE(site_id uuid, ...), so `site_id` is an
-- OUT parameter name inside the body. Two of the four subqueries selected and
-- grouped by a bare `site_id` against public.snags, which also has a site_id
-- column — ambiguous, and plpgsql's default variable_conflict setting is
-- `error`, so it failed on every call rather than only in some data shape.
--
-- The other two subqueries (od, rca) already alias the table and qualify as
-- sn.site_id, which is why they were fine. This brings the first two into line
-- rather than renaming the OUT parameter, which would be a breaking API change
-- for both clients.
--
-- Behaviour is otherwise unchanged: same predicates, same joins, same ordering.

create or replace function public.get_site_breakdown(p_org_id uuid)
returns table(
  site_id uuid,
  site_name text,
  open_investigations bigint,
  unassigned bigint,
  overdue_actions bigint,
  rca_outstanding bigint
)
language plpgsql
stable security definer
set search_path to 'public'
as $function$
begin
  if p_org_id is null or p_org_id is distinct from public.current_org_id() then
    raise exception 'Site breakdown is only available for your active organisation';
  end if;

  return query
  select
    s.id as site_id,
    s.name as site_name,
    coalesce(inv.cnt, 0) as open_investigations,
    coalesce(un.cnt, 0) as unassigned,
    coalesce(od.cnt, 0) as overdue_actions,
    coalesce(rca.cnt, 0) as rca_outstanding
  from public.sites s
  left join (
    select sn.site_id, count(*) as cnt
    from public.snags sn
    where sn.org_id = p_org_id and sn.lane = 'serious'
      and sn.status in ('flagged', 'in_progress', 'rca_pending')
      and sn.parent_snag_id is null
    group by sn.site_id
  ) inv on inv.site_id = s.id
  left join (
    select sn.site_id, count(*) as cnt
    from public.snags sn
    where sn.org_id = p_org_id and sn.owner_id is null
      and sn.status in ('flagged', 'in_progress')
      and sn.parent_snag_id is null
    group by sn.site_id
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
  left join (
    select sn.site_id, count(*) as cnt
    from public.snags sn
    where sn.org_id = p_org_id and sn.lane = 'serious'
      and sn.status in ('resolved', 'rca_pending')
      and sn.rca_waived_at is null
      and not exists (
        select 1 from public.snag_rca r
        where r.snag_id = sn.id and r.status = 'accepted'
      )
      and (
        sn.parent_snag_id is null
        or not exists (
          select 1 from public.snags parent
          where parent.id = sn.parent_snag_id and parent.lane = 'serious'
        )
      )
    group by sn.site_id
  ) rca on rca.site_id = s.id
  where s.org_id = p_org_id
  order by s.name;
end;
$function$;
