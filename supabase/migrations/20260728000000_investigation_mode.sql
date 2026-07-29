-- Investigation mode: SNAG's guided process, or the organisation's own.
--
-- Plenty of organisations already have an investigation process and a form
-- they are required to use. Forcing SNAG's 5-step version on top of it means
-- the real investigation lives somewhere else and SNAG holds a hollow copy.
--
-- So an investigation can be run one of two ways, chosen when it is assigned:
--
--   'snag'     — the guided workflow: root cause, then corrective actions.
--   'document' — the org's own process, evidenced by a document.
--
-- This is a *substitution*, not a shortcut. Document mode replaces the last two
-- resolve-gate conditions with two of its own:
--
--   1. an investigation document is attached, and
--   2. a supervisor has accepted it.
--
-- Everything before that — the notifiable decision, the first-response
-- checklist, a witness statement, evidence — is unchanged and still required.
-- Accepting is a separate act from attaching so that "someone uploaded a file"
-- and "a supervisor read it and signed it off" stay distinguishable in the
-- record, which is the whole point of the gate.
--
-- Replacing the document re-opens the decision: acceptance is cleared, and the
-- snag cannot resolve until the new document is accepted in turn.

begin;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'investigation_mode') then
    create type public.investigation_mode as enum ('snag', 'document');
  end if;
end $$;

alter table public.investigations
  add column if not exists mode public.investigation_mode not null default 'snag',
  add column if not exists document_id uuid references public.org_documents(id) on delete set null,
  add column if not exists document_accepted_by uuid references public.profiles(id),
  add column if not exists document_accepted_at timestamptz,
  add column if not exists assigned_by uuid references public.profiles(id),
  add column if not exists assigned_at timestamptz;

comment on column public.investigations.mode is
  'snag = the guided workflow; document = the org''s own process, evidenced by an attached document that a supervisor must accept.';

-- Acceptance without a document is meaningless, and would silently satisfy the
-- gate. Enforced here rather than only in the RPC because the gate reads these
-- columns directly.
alter table public.investigations
  drop constraint if exists investigations_accepted_needs_document;
alter table public.investigations
  add constraint investigations_accepted_needs_document
  check (document_accepted_at is null or document_id is not null);

-- ─── Assigning ──────────────────────────────────────────────────────────────

-- Sets who is running the investigation and how. Upserts, because the
-- investigations row is otherwise created lazily by set_root_cause — assigning
-- has to work before any root cause exists, which is the normal case.
create or replace function public.assign_investigation(
  p_snag_id uuid,
  p_assignee_id uuid,
  p_mode public.investigation_mode default 'snag'
)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_snag public.snags := public.require_serious_snag(p_snag_id);
begin
  if not exists (
    select 1 from public.profiles where id = p_assignee_id and org_id = v_snag.org_id
  ) then
    raise exception 'That person does not belong to your organisation';
  end if;

  insert into public.investigations (snag_id, lead_investigator_id, mode, assigned_by, assigned_at)
    values (p_snag_id, p_assignee_id, p_mode, auth.uid(), now())
  on conflict (snag_id) do update
    set lead_investigator_id = excluded.lead_investigator_id,
        mode = excluded.mode,
        assigned_by = excluded.assigned_by,
        assigned_at = excluded.assigned_at;

  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    values (v_snag.org_id, 'snag', p_snag_id, 'investigation_assigned_' || p_mode, auth.uid());
end;
$$;

-- ─── Attaching and accepting the document ───────────────────────────────────

-- The document always comes from org_documents, whether it was already in the
-- library or uploaded during the investigation. One register, so an
-- investigation document is discoverable later by someone who wasn't involved.
create or replace function public.attach_investigation_document(
  p_snag_id uuid,
  p_document_id uuid
)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_snag public.snags := public.require_serious_snag(p_snag_id);
begin
  if not exists (
    select 1 from public.org_documents where id = p_document_id and org_id = v_snag.org_id
  ) then
    raise exception 'That document does not belong to your organisation';
  end if;

  insert into public.investigations (snag_id, mode, document_id)
    values (p_snag_id, 'document', p_document_id)
  on conflict (snag_id) do update
    set mode = 'document',
        document_id = excluded.document_id,
        -- A different document is a different investigation. Whatever was
        -- accepted before was accepted about the old one.
        document_accepted_by = null,
        document_accepted_at = null;

  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    values (v_snag.org_id, 'snag', p_snag_id, 'investigation_document_attached', auth.uid());
end;
$$;

create or replace function public.accept_investigation_document(p_snag_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_snag public.snags := public.require_serious_snag(p_snag_id);
  v_inv public.investigations;
begin
  select * into v_inv from public.investigations where snag_id = p_snag_id;
  if v_inv is null or v_inv.document_id is null then
    raise exception 'Attach the investigation document before accepting it';
  end if;
  if v_inv.mode <> 'document' then
    raise exception 'This snag is using the SNAG investigation, not a document';
  end if;

  update public.investigations
    set document_accepted_by = auth.uid(),
        document_accepted_at = now()
    where snag_id = p_snag_id;

  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    values (v_snag.org_id, 'snag', p_snag_id, 'investigation_document_accepted', auth.uid());
end;
$$;

revoke all on function public.assign_investigation(uuid, uuid, public.investigation_mode) from public, anon;
revoke all on function public.attach_investigation_document(uuid, uuid) from public, anon;
revoke all on function public.accept_investigation_document(uuid) from public, anon;
grant execute on function public.assign_investigation(uuid, uuid, public.investigation_mode) to authenticated;
grant execute on function public.attach_investigation_document(uuid, uuid) to authenticated;
grant execute on function public.accept_investigation_document(uuid) to authenticated;

-- ─── The resolve gate ───────────────────────────────────────────────────────

-- Same function as before up to the root-cause check, where it forks on mode.
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
  v_inv public.investigations;
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
    select * into v_inv from public.investigations where snag_id = p_snag_id;

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

    -- The fork. Document mode swaps the last two conditions for its own two;
    -- it does not remove them.
    if v_inv.mode = 'document' then
      if v_inv.document_id is null then
        raise exception 'Attach the investigation document before marking this resolved';
      end if;
      if v_inv.document_accepted_at is null then
        raise exception 'A supervisor must accept the investigation document before marking this resolved';
      end if;
    else
      if v_inv is null or v_inv.root_cause_text is null then
        raise exception 'Record a root cause before marking this resolved';
      end if;
      if v_open_actions > 0 then
        raise exception 'Complete and verify every corrective action before marking this resolved';
      end if;
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
$$;

commit;
