-- Once an investigation is under way, it cannot be re-triaged into the other mode.
--
-- 20260728000000 chose the mode at allocation and left Manage as a "re-decide"
-- path, on the reasoning that a supervisor might allocate before knowing which
-- process applies. That is true right up until somebody does the work — after
-- which switching doesn't re-decide anything, it strands a completed
-- investigation.
--
-- The two modes satisfy the resolve gate with different evidence
-- (update_snag_status forks on `mode`), so a switch mid-investigation is worse
-- than untidy — it is a hole in the gate:
--
--   snag mode: record a root cause, complete and verify every corrective action
--   → switch to document mode → attach a document and accept it
--   → the snag resolves with the corrective actions still open, because
--     document mode never asks about them.
--
-- And in reverse: an attached, supervisor-accepted investigation document stops
-- counting the moment the mode flips back, so a signed-off investigation sits in
-- the record satisfying nothing.
--
-- This is not hypothetical. SNAG-00038 is in exactly that state right now:
-- mode 'snag', with a document attached *and* accepted, no root cause and no
-- corrective actions. See the repair at the bottom.
--
-- What this migration does:
--
--   1. assign_investigation refuses to change the mode of an investigation that
--      has been allocated and has work recorded under its current mode. An
--      officer admin may still override, and the override is audited under its
--      own action so it is visible in the record rather than silent.
--   2. attach_investigation_document stops *setting* mode = 'document'. It was
--      a second, quieter way to switch modes: attaching a file to a snag-mode
--      investigation converted it, without going near Manage or triage.
--   3. A narrow repair for rows already stranded by (2).
--
-- Deliberately scoped to a *change* of mode. Re-assigning the lead investigator
-- goes through the same RPC and stays available — who runs it and how it is run
-- are different decisions, and only the second one is being frozen.

begin;

-- ─── Is there work that a mode change would strand? ─────────────────────────

-- Answers only for the mode the investigation is *currently* in, because that
-- is the work a switch would abandon. Evidence, witnesses and the checklist are
-- deliberately not counted: both modes require them, so they survive a switch
-- and are no reason to refuse one.
create or replace function public.investigation_mode_has_work(p_snag_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case i.mode
    when 'document' then i.document_id is not null
    else i.root_cause_text is not null
         or exists (
           select 1 from public.corrective_actions ca where ca.snag_id = i.snag_id
         )
  end
  from public.investigations i
  where i.snag_id = p_snag_id;
$$;

comment on function public.investigation_mode_has_work(uuid) is
  'True when the investigation has work recorded under its current mode — a root cause or a corrective action in snag mode, an attached document in document mode. Used by assign_investigation to refuse a mode change that would strand it.';

revoke all on function public.investigation_mode_has_work(uuid) from public, anon;
grant execute on function public.investigation_mode_has_work(uuid) to authenticated;

-- ─── Assigning ──────────────────────────────────────────────────────────────

create or replace function public.assign_investigation(
  p_snag_id uuid,
  p_assignee_id uuid,
  p_mode public.investigation_mode default 'snag'
)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_snag public.snags := public.require_serious_snag(p_snag_id);
  v_inv public.investigations;
  v_changing_mode boolean := false;
  v_is_admin boolean := false;
begin
  if not exists (
    select 1 from public.profiles where id = p_assignee_id and org_id = v_snag.org_id
  ) then
    raise exception 'That person does not belong to your organisation';
  end if;

  select * into v_inv from public.investigations where snag_id = p_snag_id;

  -- `lead_investigator_id is null` is what "not yet triaged" means (the row
  -- itself can be created early and lazily by set_root_cause), so this is the
  -- first allocation and the mode is still an open question.
  v_changing_mode := found
    and v_inv.lead_investigator_id is not null
    and v_inv.mode <> p_mode;

  if v_changing_mode and coalesce(public.investigation_mode_has_work(p_snag_id), false) then
    select exists (
      select 1 from public.org_memberships m
      where m.user_id = auth.uid()
        and m.org_id = v_snag.org_id
        and m.removed_at is null
        and m.role = 'officer_admin'
    ) into v_is_admin;

    if not v_is_admin then
      raise exception
        'This investigation is already under way using %, and work has been recorded against it. Changing how it is investigated would strand that work.',
        case v_inv.mode when 'document' then 'your own process' else 'the SNAG investigation' end;
    end if;

    -- Allowed, but never quietly: the override is its own audit action so the
    -- record shows a decision was overturned, not merely re-made.
    insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
      values (v_snag.org_id, 'snag', p_snag_id, 'investigation_mode_overridden_' || p_mode, auth.uid());
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

-- ─── Attaching the document ─────────────────────────────────────────────────

-- Now requires the investigation to already be in document mode instead of
-- putting it there. Attaching is doing the investigation; choosing how it is run
-- is triage's job, and this function quietly did both.
--
-- The upsert-insert is gone with it: a snag in document mode always has an
-- investigations row (assign_investigation created it), so the only thing the
-- insert branch could ever do was convert a snag that had not been allocated.
create or replace function public.attach_investigation_document(
  p_snag_id uuid,
  p_document_id uuid
)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_snag public.snags := public.require_investigation_access(p_snag_id);
  v_inv public.investigations;
begin
  if not exists (
    select 1 from public.org_documents where id = p_document_id and org_id = v_snag.org_id
  ) then
    raise exception 'That document does not belong to your organisation';
  end if;

  select * into v_inv from public.investigations where snag_id = p_snag_id;
  if not found or v_inv.mode <> 'document' then
    raise exception 'This snag is using the SNAG investigation, not a document';
  end if;

  update public.investigations
    set document_id = p_document_id,
        document_attached_by = auth.uid(),
        -- A different document is a different investigation. Whatever was
        -- accepted before was accepted about the old one.
        document_accepted_by = null,
        document_accepted_at = null
    where snag_id = p_snag_id;

  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    values (v_snag.org_id, 'snag', p_snag_id, 'investigation_document_attached', auth.uid());
end;
$$;

revoke all on function public.assign_investigation(uuid, uuid, public.investigation_mode) from public, anon;
revoke all on function public.attach_investigation_document(uuid, uuid) from public, anon;
grant execute on function public.assign_investigation(uuid, uuid, public.investigation_mode) to authenticated;
grant execute on function public.attach_investigation_document(uuid, uuid) to authenticated;

-- ─── Repairing what the old behaviour left behind ───────────────────────────

-- A snag-mode investigation holding an attached document was converted to
-- document mode at some point and switched back, abandoning the document. Where
-- there is no snag-mode work to lose, the document is the only investigation
-- anybody actually did, so the truthful mode is the one that counts it.
--
-- Deliberately narrow: rows with a root cause or any corrective action are left
-- alone, because there the right answer is a judgement call for a human rather
-- than something a migration should guess at.
update public.investigations i
  set mode = 'document'
  where i.mode = 'snag'
    and i.document_id is not null
    and i.root_cause_text is null
    and not exists (
      select 1 from public.corrective_actions ca where ca.snag_id = i.snag_id
    );

commit;
