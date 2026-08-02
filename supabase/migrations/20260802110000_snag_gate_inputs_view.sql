-- Gate inputs per serious snag, so a list can say what a snag is waiting on.
--
-- The problem this solves: `seriousResolveGate` runs on `InvestigationState`,
-- which is assembled per snag by the detail screen. A list has no way to reach
-- it, so every open serious snag renders identically as "In Progress" whether
-- it is one step from done or has not been started. In the Docunation data,
-- six of seven open serious snags could not be resolved and nothing outside the
-- detail screen said so.
--
-- Why inputs rather than a verdict. The rule already exists twice by necessity
-- — `update_snag_status` enforces it, `seriousResolveGate` mirrors it so the
-- clients can hide a control the server would refuse. Computing an outstanding
-- *count* here would be a third copy, in the layer furthest from the one the UI
-- reads, and the mode fork is exactly the kind of thing that drifts. So this
-- view returns only the facts the gate consumes and leaves the rule where it
-- is: one SQL enforcer, one TypeScript mirror shared by both clients.
--
-- `security_invoker = true` matches snags_with_details: the caller's own RLS
-- applies, and both investigations and witness_statements are SELECT-open to
-- the org (writes are RPC-only), so this exposes nothing a member could not
-- already read one snag at a time.
--
-- Serious lane only. A niggle has no gate to report on.

create or replace view public.snag_gate_inputs
with (security_invoker = true) as
select
  s.id as snag_id,
  s.org_id,
  s.site_id,
  s.status,
  -- null means "not yet decided", which is itself an unmet condition — so the
  -- clients need to distinguish it from false. Kept nullable deliberately.
  s.is_notifiable,
  coalesce(cc.completed_count, 0::bigint) as checklist_completed_count,
  coalesce(w.witness_count, 0::bigint) as witness_count,
  coalesce(ev.evidence_count, 0::bigint) as evidence_count,
  coalesce(ca.open_count, 0::bigint) as open_corrective_action_count,
  -- Null when the snag has no investigation row at all. The gate treats that
  -- as snag mode, matching assign_investigation's default.
  i.mode as investigation_mode,
  i.lead_investigator_id,
  (i.root_cause_text is not null and btrim(i.root_cause_text) <> '') as has_root_cause,
  (i.document_id is not null) as has_document,
  (i.document_accepted_by is not null) as document_accepted
from public.snags s
  left join public.investigations i on i.snag_id = s.id
  left join (
    select checklist_completions.snag_id, count(*) as completed_count
    from public.checklist_completions
    group by checklist_completions.snag_id
  ) cc on cc.snag_id = s.id
  left join (
    select witness_statements.snag_id, count(*) as witness_count
    from public.witness_statements
    group by witness_statements.snag_id
  ) w on w.snag_id = s.id
  left join (
    select evidence_items.snag_id, count(*) as evidence_count
    from public.evidence_items
    group by evidence_items.snag_id
  ) ev on ev.snag_id = s.id
  left join (
    select corrective_actions.snag_id, count(*) as open_count
    from public.corrective_actions
    where not (corrective_actions.status = 'done'::corrective_action_status
               and corrective_actions.verified_by is not null)
    group by corrective_actions.snag_id
  ) ca on ca.snag_id = s.id
where s.lane = 'serious'
  and s.parent_snag_id is null;

grant select on public.snag_gate_inputs to authenticated;
