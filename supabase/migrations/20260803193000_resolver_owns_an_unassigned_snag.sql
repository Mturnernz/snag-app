-- A snag that closes unassigned has nobody's name on the work.
--
-- Both resolve paths already stamp resolved_by, but owner_id was left as it
-- found it — so a niggle nobody picked up, fixed by whoever happened to deal
-- with it, closed reading "Unassigned" forever. The person is recorded two
-- fields away, and every list, export and report that shows an owner shows a
-- blank.
--
-- Resolving now fills the gap: if the snag has no owner at the moment it is
-- resolved, the person resolving it becomes the owner. Only ever a gap-fill —
-- coalesce, never an overwrite — so a deliberate assignment always wins, the
-- same rule apply_default_owner follows for serious snags.
--
-- This mostly lands on niggles. apply_default_owner already gives every
-- serious snag an owner on the way in, so update_snag_status's branch is
-- defensive rather than routine.

begin;

-- The trigger has to know the difference between a hand-off and a signature.
--
-- notify_after_snag_update mails 'niggle_assigned' on any owner change, so
-- filling owner_id during a resolve would email the resolver to tell them a
-- snag they had just closed was now theirs to do. Nobody needs assigning to
-- finished work — which is equally true of assign_snag_owner on an
-- already-resolved snag, so the guard is on the resolved state rather than on
-- this one code path.
create or replace function public.notify_after_snag_update()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.owner_id is not null
     and new.owner_id is distinct from old.owner_id
     and new.status <> 'resolved' then
    perform public.dispatch_snag_notification(new.id, 'niggle_assigned');
  end if;
  if new.status = 'resolved' and old.status is distinct from 'resolved' then
    perform public.dispatch_snag_notification(new.id, 'snag_resolved');
  end if;
  return new;
end;
$$;

-- Niggles. Identical to the previous definition except for owner_id and the
-- extra audit row.
create or replace function public.resolve_snag(p_snag_id uuid, p_note text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org_id uuid := public.current_org_id();
  v_snag public.snags;
begin
  if p_note is null or btrim(p_note) = '' then
    raise exception 'Add a note describing what was done before marking this resolved';
  end if;

  select * into v_snag from public.snags where id = p_snag_id and org_id = v_org_id;
  if v_snag is null then
    raise exception 'Snag not found';
  end if;
  if v_snag.lane <> 'niggle' then
    raise exception 'Only niggles use the resolve/confirm flow';
  end if;
  if v_snag.status not in ('flagged', 'in_progress') then
    raise exception 'This snag is not open';
  end if;

  update public.snags
    set status = 'resolved',
        owner_id = coalesce(owner_id, auth.uid()),
        resolved_by = auth.uid(),
        resolved_at = now(),
        resolution_note = p_note
    where id = p_snag_id;

  -- Merged duplicates close with their parent, and inherit the same gap-fill.
  if exists (select 1 from public.snags where parent_snag_id = p_snag_id) then
    update public.snags
      set status = 'resolved',
          owner_id = coalesce(owner_id, auth.uid()),
          resolved_by = auth.uid(),
          resolved_at = now(),
          resolution_note = p_note
      where parent_snag_id = p_snag_id;
  end if;

  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    values (v_org_id, 'snag', p_snag_id, 'status_resolved', auth.uid());

  -- Recorded separately so the history says the owner was picked up at the
  -- close rather than decided by somebody earlier.
  if v_snag.owner_id is null then
    insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
      values (v_org_id, 'snag', p_snag_id, 'owner_assigned_on_resolve', auth.uid());
  end if;
end;
$$;

-- Serious lane. Identical to the previous definition except for owner_id and
-- the extra audit row; every gate condition is untouched.
create or replace function public.update_snag_status(p_snag_id uuid, p_status public.snag_status, p_note text default null)
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
        owner_id = case when p_status = 'resolved' then coalesce(owner_id, auth.uid()) else owner_id end,
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
          owner_id = case when p_status = 'resolved' then coalesce(owner_id, auth.uid()) else owner_id end,
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

  if p_status = 'resolved' and v_snag.owner_id is null then
    insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
      values (v_org_id, 'snag', p_snag_id, 'owner_assigned_on_resolve', auth.uid());
  end if;
end;
$$;

commit;
