-- Adds the notifiable-event decision to the serious-lane resolve gate.
--
-- A serious snag could be resolved, and then sent out for RCA, with the
-- WorkSafe notifiable question never answered. That isn't a cosmetic gap: under
-- HSWA 2015 a notifiable event must be reported as soon as possible and the
-- site preserved, so "we never decided" is the one outcome the record should
-- not be able to end in. In the live data 10 of 11 resolved serious snags had
-- no decision recorded, which is what a soft prompt gets you.
--
-- "Decided" means set_notifiable_flag has run, either way — it stamps
-- notifiable_marked_at for both yes and no. is_notifiable is checked too so any
-- legacy row flagged before that column existed still counts as answered. The
-- "Unsure — flag for follow-up" path in the app deliberately persists nothing,
-- so an unsure snag stays blocked: unsure means go and find out.
--
-- Ordering: the notifiable check runs first, ahead of the checklist, because
-- it's the most time-critical thing on a serious snag and because the client's
-- next-step card reads the conditions in this same order.
--
-- Already-resolved snags are untouched — this only gates the transition into
-- 'resolved'. Re-opening one and resolving it again will require the decision,
-- which is intended.

create or replace function public.update_snag_status(
  p_snag_id uuid,
  p_status public.snag_status,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
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

    if v_snag.notifiable_marked_at is null and v_snag.is_notifiable is not true then
      raise exception 'Decide whether this is a notifiable event before marking this resolved';
    end if;
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
$function$;
