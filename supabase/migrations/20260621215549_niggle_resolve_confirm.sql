-- SNAPSHOT of a migration already applied to the Snagv1 project
-- (wpkdpukpllxuyqqlxkxf). Recovered from supabase_migrations.schema_migrations
-- on 2026-07-03. Do NOT re-apply.

alter table public.snags
  add column resolved_by uuid references public.profiles(id),
  add column resolved_at timestamptz,
  add column confirmed_by uuid references public.profiles(id),
  add column confirmed_at timestamptz;

create function public.resolve_snag(p_snag_id uuid, p_note text)
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
        resolved_by = auth.uid(),
        resolved_at = now(),
        resolution_note = p_note
    where id = p_snag_id;

  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    values (v_org_id, 'snag', p_snag_id, 'status_resolved', auth.uid());
end;
$$;

grant execute on function public.resolve_snag(uuid, text) to authenticated;

create function public.confirm_snag(p_snag_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org_id uuid := public.current_org_id();
  v_snag public.snags;
begin
  if public.current_role() not in ('officer_admin', 'supervisor') then
    raise exception 'Only a supervisor or admin can confirm a niggle is done';
  end if;

  select * into v_snag from public.snags where id = p_snag_id and org_id = v_org_id;
  if v_snag is null then
    raise exception 'Snag not found';
  end if;
  if v_snag.lane <> 'niggle' then
    raise exception 'Only niggles use the resolve/confirm flow';
  end if;
  if v_snag.status <> 'resolved' then
    raise exception 'This snag has not been resolved yet';
  end if;

  update public.snags
    set status = 'sorted', confirmed_by = auth.uid(), confirmed_at = now()
    where id = p_snag_id;

  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    values (v_org_id, 'snag', p_snag_id, 'status_sorted', auth.uid());
end;
$$;

grant execute on function public.confirm_snag(uuid) to authenticated;

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
  v_has_root_cause boolean;
begin
  select * into v_snag from public.snags where id = p_snag_id and org_id = v_org_id;
  if v_snag is null then
    raise exception 'Snag not found';
  end if;
  if v_snag.lane <> 'serious' then
    raise exception 'Niggles use resolve_snag / confirm_snag instead';
  end if;
  if public.current_role() not in ('officer_admin', 'supervisor') and auth.uid() <> v_snag.owner_id then
    raise exception 'Only the owner, a supervisor or an admin can change this snag''s status';
  end if;

  if p_status = 'sorted' then
    select count(*) into v_checklist_count from public.checklist_completions where snag_id = p_snag_id;
    select count(*) into v_statement_count from public.witness_statements where snag_id = p_snag_id;
    select count(*) into v_evidence_count from public.evidence_items where snag_id = p_snag_id;
    select count(*) into v_open_actions from public.corrective_actions where snag_id = p_snag_id and status = 'open';
    select exists(select 1 from public.investigations where snag_id = p_snag_id) into v_has_root_cause;

    if v_checklist_count < 5 then
      raise exception 'Finish the first-response checklist before marking this sorted';
    end if;
    if v_statement_count = 0 then
      raise exception 'Add at least one witness statement before marking this sorted';
    end if;
    if v_evidence_count = 0 then
      raise exception 'Add at least one piece of evidence before marking this sorted';
    end if;
    if not v_has_root_cause then
      raise exception 'Record a root cause before marking this sorted';
    end if;
    if v_open_actions > 0 then
      raise exception 'Close every corrective action before marking this sorted';
    end if;
  end if;

  update public.snags
    set status = p_status, resolution_note = coalesce(p_note, resolution_note)
    where id = p_snag_id;

  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    values (v_org_id, 'snag', p_snag_id, 'status_' || p_status, auth.uid());
end;
$$;
