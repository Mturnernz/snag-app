-- Simplify flagged vs in_progress: instead of a manual toggle (serious lane
-- only, niggles never had one), a snag now moves itself from 'flagged' to
-- 'in_progress' automatically the moment any real triage/investigation
-- action is taken on it — assigning an owner, recategorising it, assigning
-- a work group, or (serious lane) any investigation step. Applies to both
-- lanes. Only ever moves flagged -> in_progress; never touches any other
-- status, so it can't interfere with rca_pending/resolved.

create function public.mark_in_progress_if_flagged(p_snag_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.snags set status = 'in_progress' where id = p_snag_id and status = 'flagged';
end;
$$;

create or replace function public.assign_snag_owner(p_snag_id uuid, p_owner_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_org_id uuid := public.current_org_id();
  v_snag public.snags;
begin
  if public.current_role() not in ('officer_admin', 'supervisor') then
    raise exception 'Only an admin or supervisor can assign an owner';
  end if;

  select * into v_snag from public.snags where id = p_snag_id and org_id = v_org_id;
  if v_snag is null then
    raise exception 'Snag not found';
  end if;

  if p_owner_id is not null and not (
    p_owner_id in (select user_id from public.site_members where site_id = v_snag.site_id)
    or p_owner_id in (select user_id from public.site_supervisors where site_id = v_snag.site_id)
    or exists (
      select 1 from public.org_memberships m
      where m.user_id = p_owner_id and m.org_id = v_snag.org_id
        and m.removed_at is null and m.role = 'officer_admin'
    )
  ) then
    raise exception 'You can only assign someone who belongs to this snag''s site';
  end if;

  update public.snags
    set owner_id = p_owner_id,
        assigned_at = case when p_owner_id is null then null else now() end
    where id = p_snag_id;

  if p_owner_id is not null then
    perform public.mark_in_progress_if_flagged(p_snag_id);
  end if;

  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    values (
      v_org_id, 'snag', p_snag_id,
      case when p_owner_id is null then 'owner_unassigned' else 'owner_assigned' end,
      auth.uid()
    );
end;
$function$;

create or replace function public.recategorise_snag(
  p_snag_id uuid,
  p_kind public.snag_kind,
  p_severity public.snag_severity default null
)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org_id uuid := public.current_org_id();
  v_snag public.snags;
  v_was_serious boolean;
begin
  select * into v_snag from public.snags where id = p_snag_id and org_id = v_org_id;
  if v_snag is null then
    raise exception 'Snag not found';
  end if;
  if public.current_role() not in ('officer_admin', 'supervisor') then
    raise exception 'Only a supervisor or admin can recategorise a snag';
  end if;
  if p_kind in ('hazard', 'incident') and p_severity is null then
    raise exception 'A hazard or incident needs a severity';
  end if;

  v_was_serious := v_snag.lane = 'serious';

  update public.snags
    set kind = p_kind,
        severity = case when p_kind in ('hazard', 'incident') then p_severity else null end
    where id = p_snag_id;

  perform public.mark_in_progress_if_flagged(p_snag_id);

  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    values (v_org_id, 'snag', p_snag_id, 'recategorised_to_' || p_kind, auth.uid());

  if not v_was_serious and p_kind in ('hazard', 'incident') then
    perform public.dispatch_snag_notification(p_snag_id, 'serious_created');
  end if;
end;
$$;

create or replace function public.assign_snag_work_group(p_snag_id uuid, p_work_group_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org_id uuid := public.current_org_id();
begin
  if public.current_role() not in ('officer_admin', 'supervisor') then
    raise exception 'Only an admin or supervisor can assign a work group';
  end if;
  if not exists (select 1 from public.snags where id = p_snag_id and org_id = v_org_id) then
    raise exception 'Snag not found';
  end if;
  if p_work_group_id is not null and not exists (
    select 1 from public.work_groups where id = p_work_group_id and org_id = v_org_id
  ) then
    raise exception 'That work group does not belong to your organisation';
  end if;

  update public.snags set work_group_id = p_work_group_id where id = p_snag_id;

  if p_work_group_id is not null then
    perform public.mark_in_progress_if_flagged(p_snag_id);
  end if;

  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    values (
      v_org_id, 'snag', p_snag_id,
      case when p_work_group_id is null then 'work_group_unassigned' else 'work_group_assigned' end,
      auth.uid()
    );
end;
$$;

create or replace function public.complete_checklist_step(p_snag_id uuid, p_step public.checklist_step)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_snag public.snags := public.require_serious_snag(p_snag_id);
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
  v_snag public.snags := public.require_serious_snag(p_snag_id);
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
  v_snag public.snags := public.require_serious_snag(p_snag_id);
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
  v_snag public.snags := public.require_serious_snag(p_snag_id);
begin
  insert into public.investigations (snag_id, root_cause_text, lead_investigator_id, completed_at)
    values (p_snag_id, p_root_cause_text, auth.uid(), now())
    on conflict (snag_id) do update
      set root_cause_text = excluded.root_cause_text,
          lead_investigator_id = excluded.lead_investigator_id,
          completed_at = now();

  perform public.mark_in_progress_if_flagged(p_snag_id);

  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    values (v_snag.org_id, 'snag', p_snag_id, 'root_cause_set', auth.uid());
end;
$$;
