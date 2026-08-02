-- The dashboard's "Overdue actions" counted work on snags that are closed.
--
-- get_site_breakdown's `od` subquery counted every corrective action past its
-- due date that isn't both done and verified, with no test on the snag's own
-- status. So a resolved snag carrying an action marked `done` but never
-- verified counts as overdue for ever, on a site panel that offers no way to
-- reach it — the number is not tappable, unlike `unassigned`.
--
-- Found in production: SNAG-00009 (resolved, severity critical) carries one
-- corrective action, status `done`, verified_by null, due 2026-06-26. That is
-- the entire "1" on Hendo's overdue column, and nothing a supervisor can do
-- from that screen will clear it.
--
-- Why excluding resolved snags is the right shape rather than a fudge:
--
--   * On the snag lane, `update_snag_status` will not resolve a serious snag
--     until every corrective action is complete AND verified. So a properly
--     resolved snag cannot have an outstanding action, and this predicate
--     changes nothing for anything closed under the current gate. What it
--     clears is history from before it.
--   * Corrective actions are a pre-resolution obligation; the gate is what
--     enforces them. RCA is the deliberate opposite — a post-resolution
--     obligation — which is why the `rca` subquery below intentionally counts
--     `status in ('resolved','rca_pending')` and is left exactly as it was.
--
-- Deliberately NOT changed: `snags_with_details.open_corrective_action_count`.
-- On a snag's own detail screen "this has an unverified action" is a true and
-- useful statement whatever the status. The defect is a site-level alert
-- counter that cannot be actioned or cleared, not the per-snag figure.
--
-- Otherwise identical to 20260727090000_fix_site_breakdown_ambiguous_site_id:
-- same OUT parameters, same qualification of sn.site_id, same ordering.

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
      -- The fix: a closed snag's actions are not outstanding work.
      and sn.status <> 'resolved'
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
