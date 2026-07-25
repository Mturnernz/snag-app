-- Refines the rca_outstanding predicate added in
-- 20260724120000_rca_waiver_and_outstanding.sql.
--
-- That migration excluded merge children from all snag counts, matching every
-- drill-down list (getUnassignedSnags, the web snags page) which filter to
-- parent_snag_id is null. Correct for assignment and investigation counts —
-- those are ticket-level concerns and the parent legitimately represents its
-- children.
--
-- It is WRONG for RCA, because merge does not guarantee the parent covers the
-- children's lane. Live example that caught this: SNAG-00003, -00004 and
-- -00006 are all lane='serious', severity='critical', and all three are merged
-- into SNAG-00016 — which is lane='niggle'. Excluding children hid three
-- critical incidents behind a parent that the `lane = 'serious'` filter can
-- never count. Four of the five affected snags were severity='critical'.
--
-- New rule: a serious snag is RCA-outstanding unless a *serious* parent stands
-- in for it. Concretely, count it when it has no parent, or when its parent
-- isn't serious (and therefore won't be counted and can't represent it).
-- SNAG-00018/-00022 stay excluded because their parent SNAG-00024 is serious
-- and is itself counted.
--
-- Follow-up worth raising separately: merge_snags permitted a serious child
-- under a niggle parent at all, and SNAG-00016 carries severity='critical'
-- while sitting in the niggle lane. Both look like gaps in
-- enforce_snag_merge_invariants rather than anything this migration should fix.

create or replace function public.get_site_breakdown(p_org_id uuid)
returns table (
  site_id uuid,
  site_name text,
  open_investigations bigint,
  unassigned bigint,
  overdue_actions bigint,
  rca_outstanding bigint
)
language plpgsql stable security definer set search_path = public as $$
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
    select site_id, count(*) as cnt
    from public.snags
    where org_id = p_org_id and lane = 'serious'
      and status in ('flagged', 'in_progress', 'rca_pending')
      and parent_snag_id is null
    group by site_id
  ) inv on inv.site_id = s.id
  left join (
    select site_id, count(*) as cnt
    from public.snags
    where org_id = p_org_id and owner_id is null
      and status in ('flagged', 'in_progress')
      and parent_snag_id is null
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
  left join (
    -- Serious snags past the point where an RCA becomes possible, with no
    -- accepted analysis and no recorded waiver. rca_pending is included: an
    -- assigned-but-unfinished RCA is still outstanding analysis work.
    select sn.site_id, count(*) as cnt
    from public.snags sn
    where sn.org_id = p_org_id and sn.lane = 'serious'
      and sn.status in ('resolved', 'rca_pending')
      and sn.rca_waived_at is null
      and not exists (
        select 1 from public.snag_rca r
        where r.snag_id = sn.id and r.status = 'accepted'
      )
      -- Only let a SERIOUS parent stand in for its children.
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
$$;

grant execute on function public.get_site_breakdown(uuid) to authenticated;
revoke execute on function public.get_site_breakdown(uuid) from public, anon;
