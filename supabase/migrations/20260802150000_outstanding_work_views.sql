-- The rows behind the dashboard's two alert numbers.
--
-- "RCA outstanding" and "Overdue actions" were counts with no way to reach
-- what they counted: only the Unassigned figure expands. A supervisor was told
-- eight RCAs were outstanding and given nothing to act on — and the numbers are
-- derived, so they could not be reconstructed by browsing either.
--
-- The obvious fix is to write the list query in the client. That would put the
-- predicate in two places: `get_site_breakdown` counting one thing and the
-- expander listing another, drifting the first time either is touched, with the
-- symptom being a count that disagrees with its own list.
--
-- So the predicates move into views, and the RPC counts from them. One
-- definition each, read by the counter and the lister alike.
--
-- `security_invoker = true` so a direct client select is scoped by the caller's
-- own RLS, matching snags_with_details. Inside get_site_breakdown — which is
-- SECURITY DEFINER — the function's existing `p_org_id = current_org_id()`
-- check remains what gates access, exactly as it did when it read the base
-- tables directly.

-- Corrective actions past their due date that are not both done and verified,
-- excluding closed snags: a resolved snag's actions are not outstanding work.
create or replace view public.snag_overdue_actions
with (security_invoker = true) as
select
  ca.id as action_id,
  ca.snag_id,
  ca.description as action_description,
  ca.due_date,
  ca.status as action_status,
  ca.owner_id,
  sn.org_id,
  sn.site_id,
  sn.reference,
  sn.description as snag_description,
  sn.status as snag_status
from public.corrective_actions ca
  join public.snags sn on sn.id = ca.snag_id
where sn.status <> 'resolved'
  and ca.due_date < current_date
  and not (ca.status = 'done'::corrective_action_status and ca.verified_by is not null);

-- Serious snags past the point an RCA is owed, without an accepted one and
-- without a waiver. Merged children are excluded only when their parent is
-- itself serious — the parent carries the obligation in that case.
create or replace view public.snag_rca_outstanding
with (security_invoker = true) as
select
  sn.id as snag_id,
  sn.org_id,
  sn.site_id,
  sn.reference,
  sn.description,
  sn.status,
  sn.severity,
  sn.owner_id
from public.snags sn
where sn.lane = 'serious'
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
  );

grant select on public.snag_overdue_actions to authenticated;
grant select on public.snag_rca_outstanding to authenticated;

-- Same signature and same numbers; the two alert columns now count the views
-- above rather than repeating their predicates inline.
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
    select oa.site_id, count(*) as cnt
    from public.snag_overdue_actions oa
    where oa.org_id = p_org_id
    group by oa.site_id
  ) od on od.site_id = s.id
  left join (
    select ro.site_id, count(*) as cnt
    from public.snag_rca_outstanding ro
    where ro.org_id = p_org_id
    group by ro.site_id
  ) rca on rca.site_id = s.id
  where s.org_id = p_org_id
  order by s.name;
end;
$function$;
