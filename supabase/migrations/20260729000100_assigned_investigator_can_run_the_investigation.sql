-- Assigning an investigation to someone has to actually give them the
-- investigation.
--
-- Every investigation write went through require_serious_snag, which permits
-- only a supervisor of the site or an org admin. So assign_investigation could
-- name a lead investigator who was then refused by every RPC the job consists
-- of. The same hole was already live in the RCA flow, where it is the *normal*
-- case: submit_rca deliberately allows the assignee, then calls set_root_cause,
-- which calls require_serious_snag and raises. A worker could answer all five
-- whys and be unable to hand the RCA in — confirmed against the live project as
-- the QA worker, which is why this is a fix and not a feature.
--
-- The split drawn here is doing versus directing:
--
--   doing      — checklist, witness statements, evidence, root cause, attaching
--                the investigation document. The assigned investigator, plus
--                supervisors and admins.
--   directing  — assigning, accepting/rejecting an RCA, accepting the
--                investigation document, waiving, creating corrective actions,
--                starting a debrief. Supervisors and admins only.
--
-- Accepting the investigation document stays on the directing side on purpose:
-- it is the gate condition that means a supervisor signed the document off, and
-- it already refuses the person who attached it.
--
-- Reads were never restricted — all five investigation tables are readable by
-- any org member — so this only opens the writes the assignee was already
-- expected to make.

begin;

create or replace function public.require_investigation_access(p_snag_id uuid)
returns public.snags
language plpgsql security definer set search_path = public as $$
declare
  v_snag public.snags;
begin
  select * into v_snag from public.snags where id = p_snag_id and org_id = public.current_org_id();
  if v_snag is null then
    raise exception 'Snag not found';
  end if;
  if v_snag.lane <> 'serious' then
    raise exception 'Only hazard/incident snags have a guided investigation';
  end if;

  if public.can_edit_site(v_snag.site_id) then
    return v_snag;
  end if;
  if exists (
    select 1 from public.investigations
    where snag_id = p_snag_id and lead_investigator_id = auth.uid()
  ) then
    return v_snag;
  end if;
  -- An RCA assignee owns the root cause for the duration of the RCA; submit_rca
  -- writes it on their behalf.
  if exists (
    select 1 from public.snag_rca
    where snag_id = p_snag_id and assigned_to = auth.uid()
      and status in ('assigned', 'in_progress', 'submitted', 'rejected')
  ) then
    return v_snag;
  end if;

  raise exception 'Only the assigned investigator, a supervisor of this site, or an admin can run this investigation';
end;
$$;

revoke all on function public.require_investigation_access(uuid) from public, anon;

create or replace function public.complete_checklist_step(p_snag_id uuid, p_step checklist_step)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_snag public.snags := public.require_investigation_access(p_snag_id);
begin
  insert into public.checklist_completions (snag_id, step, completed_by)
    values (p_snag_id, p_step, auth.uid())
    on conflict (snag_id, step) do nothing;

  perform public.mark_in_progress_if_flagged(p_snag_id);

  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    values (v_snag.org_id, 'snag', p_snag_id, 'checklist_' || p_step, auth.uid());
end;
$$;

create or replace function public.add_witness_statement(p_snag_id uuid, p_witness_name text, p_statement_text text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_snag public.snags := public.require_investigation_access(p_snag_id);
  v_id uuid;
begin
  insert into public.witness_statements (snag_id, witness_name, statement_text, taken_by)
    values (p_snag_id, p_witness_name, p_statement_text, auth.uid())
    returning id into v_id;

  perform public.mark_in_progress_if_flagged(p_snag_id);

  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    values (v_snag.org_id, 'snag', p_snag_id, 'witness_statement_added', auth.uid());

  return v_id;
end;
$$;

create or replace function public.add_evidence_item(p_snag_id uuid, p_media_path text, p_caption text default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_snag public.snags := public.require_investigation_access(p_snag_id);
  v_id uuid;
  v_next_index int;
begin
  select coalesce(max(sort_index) + 1, 0) into v_next_index from public.evidence_items where snag_id = p_snag_id;

  insert into public.evidence_items (snag_id, uploaded_by, media_path, caption, sort_index)
    values (p_snag_id, auth.uid(), p_media_path, p_caption, v_next_index)
    returning id into v_id;

  perform public.mark_in_progress_if_flagged(p_snag_id);

  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    values (v_snag.org_id, 'snag', p_snag_id, 'evidence_added', auth.uid());

  return v_id;
end;
$$;

create or replace function public.set_root_cause(p_snag_id uuid, p_root_cause_text text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_snag public.snags := public.require_investigation_access(p_snag_id);
begin
  insert into public.investigations (snag_id, root_cause_text, lead_investigator_id, completed_at)
    values (p_snag_id, p_root_cause_text, auth.uid(), now())
    on conflict (snag_id) do update
      set root_cause_text = excluded.root_cause_text,
          -- Don't overwrite a deliberately assigned lead with whoever happened
          -- to type the cause; assign_investigation is the only thing that
          -- names one.
          lead_investigator_id = coalesce(investigations.lead_investigator_id, excluded.lead_investigator_id),
          completed_at = now();

  perform public.mark_in_progress_if_flagged(p_snag_id);

  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    values (v_snag.org_id, 'snag', p_snag_id, 'root_cause_set', auth.uid());
end;
$$;

create or replace function public.attach_investigation_document(
  p_snag_id uuid,
  p_document_id uuid
)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_snag public.snags := public.require_investigation_access(p_snag_id);
begin
  if not exists (
    select 1 from public.org_documents where id = p_document_id and org_id = v_snag.org_id
  ) then
    raise exception 'That document does not belong to your organisation';
  end if;

  insert into public.investigations (snag_id, mode, document_id, document_attached_by)
    values (p_snag_id, 'document', p_document_id, auth.uid())
  on conflict (snag_id) do update
    set mode = 'document',
        document_id = excluded.document_id,
        document_attached_by = excluded.document_attached_by,
        -- A different document is a different investigation. Whatever was
        -- accepted before was accepted about the old one.
        document_accepted_by = null,
        document_accepted_at = null;

  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    values (v_snag.org_id, 'snag', p_snag_id, 'investigation_document_attached', auth.uid());
end;
$$;

commit;
