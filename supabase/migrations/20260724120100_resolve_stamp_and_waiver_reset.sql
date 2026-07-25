-- PRODUCT_REVIEW.md §3.2 — update_snag_status never stamped resolved_by /
-- resolved_at on the snag it was resolving.
--
-- The merge-child cascade a few lines below the primary UPDATE set both
-- columns correctly, so a merged child ended up with a fuller resolution
-- record than its own parent. resolve_snag (the niggle path) was always
-- correct, so this affected the serious lane only — the lane where the audit
-- trail matters most. 3 of 11 resolved serious snags had null resolved_at and
-- null resolved_by at the time of review.
--
-- Consequences fixed here:
--   * the governance CSV export ships a resolved_at column that was silently
--     blank for affected rows;
--   * time-to-resolve was uncomputable;
--   * the snag itself carried no record of who signed off a serious incident
--     (audit_log had it, but the export reads the snag).
--
-- Also resets the §3.1 RCA waiver when a snag is reopened: a waiver decided
-- against one resolution shouldn't silently carry over to the next one.

create or replace function public.update_snag_status(p_snag_id uuid, p_status snag_status, p_note text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org_id uuid := public.current_org_id();
  v_snag public.snags;
  v_checklist_count int;
  v_statement_count int;
  v_evidence_count int;
  v_open_actions int;
  v_has_root_cause boolean;
begin
  select * into v_snag from public.snags where id = p_snag_id and org_id = v_org_id;
  if v_snag is null then
    raise exception 'Snag not found';
  end if;
  if v_snag.lane <> 'serious' then
    raise exception 'Niggles use resolve_snag instead';
  end if;
  if p_status = 'rca_pending' then
    raise exception 'rca_pending is set automatically when an RCA is assigned';
  end if;
  if v_snag.status = 'rca_pending' then
    raise exception 'This snag has an RCA in progress — accept or reject it first';
  end if;
  if not public.can_edit_site(v_snag.site_id) and auth.uid() <> v_snag.owner_id then
    raise exception 'Only the owner, a supervisor of this site, or an admin can change this snag''s status';
  end if;

  if p_status = 'resolved' then
    select count(*) into v_checklist_count from public.checklist_completions where snag_id = p_snag_id;
    select count(*) into v_statement_count from public.witness_statements where snag_id = p_snag_id;
    select count(*) into v_evidence_count from public.evidence_items where snag_id = p_snag_id;
    select count(*) into v_open_actions from public.corrective_actions
      where snag_id = p_snag_id and not (status = 'done' and verified_by is not null);
    select exists(select 1 from public.investigations where snag_id = p_snag_id) into v_has_root_cause;

    if v_checklist_count < 5 then
      raise exception 'Finish the first-response checklist before marking this resolved';
    end if;
    if v_statement_count = 0 then
      raise exception 'Add at least one witness statement before marking this resolved';
    end if;
    if v_evidence_count = 0 then
      raise exception 'Add at least one piece of evidence before marking this resolved';
    end if;
    if not v_has_root_cause then
      raise exception 'Record a root cause before marking this resolved';
    end if;
    if v_open_actions > 0 then
      raise exception 'Complete and verify every corrective action before marking this resolved';
    end if;
  end if;

  -- resolved_by / resolved_at are now stamped here, matching the cascade below
  -- and resolve_snag. Reopening (flagged / in_progress) clears them along with
  -- any RCA waiver, so a stale decision can't outlive the resolution it was
  -- made against.
  update public.snags
    set status = p_status,
        resolution_note = coalesce(p_note, resolution_note),
        resolved_by = case when p_status = 'resolved' then auth.uid() else null end,
        resolved_at = case when p_status = 'resolved' then now() else null end,
        rca_waived_by = case when p_status = 'resolved' then rca_waived_by else null end,
        rca_waived_at = case when p_status = 'resolved' then rca_waived_at else null end,
        rca_waived_reason = case when p_status = 'resolved' then rca_waived_reason else null end
    where id = p_snag_id;

  if exists (select 1 from public.snags where parent_snag_id = p_snag_id) then
    update public.snags
      set status = p_status,
          resolution_note = coalesce(p_note, resolution_note),
          resolved_by = case when p_status = 'resolved' then auth.uid() else null end,
          resolved_at = case when p_status = 'resolved' then now() else null end,
          rca_waived_by = case when p_status = 'resolved' then rca_waived_by else null end,
          rca_waived_at = case when p_status = 'resolved' then rca_waived_at else null end,
          rca_waived_reason = case when p_status = 'resolved' then rca_waived_reason else null end
      where parent_snag_id = p_snag_id;
  end if;

  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    values (v_org_id, 'snag', p_snag_id, 'status_' || p_status, auth.uid());
end;
$$;

-- ─── Backfill ───────────────────────────────────────────────────────────────
-- Recover the missing stamps from audit_log, which recorded the actor and
-- timestamp correctly all along. Uses the most recent status_resolved entry
-- per snag. Snags with no such entry (resolved by an earlier data migration
-- rather than by a user) are left null — inventing a timestamp would be worse
-- than an honest gap.

with resolved_events as (
  select distinct on (a.entity_id)
    a.entity_id as snag_id, a.actor_id, a.created_at
  from public.audit_log a
  where a.entity = 'snag' and a.action = 'status_resolved'
  order by a.entity_id, a.created_at desc
)
update public.snags s
  set resolved_by = coalesce(s.resolved_by, e.actor_id),
      resolved_at = coalesce(s.resolved_at, e.created_at)
  from resolved_events e
  where e.snag_id = s.id
    and s.status = 'resolved'
    and (s.resolved_at is null or s.resolved_by is null);
