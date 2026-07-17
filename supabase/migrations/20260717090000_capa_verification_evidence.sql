-- Corrective-action (CAPA) verification + evidence-of-completion.
--
-- create_corrective_action/complete_corrective_action already existed and
-- are fully permission-checked, but had zero client callers. This adds
-- what full CAPA closure needs beyond "marked done": an independent
-- verification step (someone other than the action's own owner signing
-- off) and photo evidence of completion, reusing the existing
-- snag-evidence bucket/RLS via a new evidence_items.corrective_action_id
-- link rather than a new bucket. The resolve gate (update_snag_status) and
-- snags_with_details' open-action count are both updated to require
-- verified, not merely done, before a serious snag can close.

alter table public.corrective_actions
  add column verified_by uuid references public.profiles(id),
  add column verified_at timestamptz;

alter table public.evidence_items
  add column corrective_action_id uuid references public.corrective_actions(id) on delete cascade;

create index on public.evidence_items (corrective_action_id);

-- Verification is deliberately restricted to a supervisor/admin of the
-- snag's site, excluding the action's own owner — the point is independent
-- sign-off, not a second tap by the same person who marked it done.
create function public.verify_corrective_action(p_action_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_action public.corrective_actions;
  v_org_id uuid := public.current_org_id();
  v_site_id uuid;
begin
  select ca.* into v_action
    from public.corrective_actions ca
    join public.snags s on s.id = ca.snag_id
    where ca.id = p_action_id and s.org_id = v_org_id;

  if v_action is null then
    raise exception 'Corrective action not found';
  end if;

  select s.site_id into v_site_id from public.snags s where s.id = v_action.snag_id;

  if not public.can_edit_site(v_site_id) then
    raise exception 'Only a supervisor of this site, or an admin, can verify a corrective action';
  end if;
  if v_action.status <> 'done' then
    raise exception 'Mark this action done before it can be verified';
  end if;
  if v_action.verified_by is not null then
    raise exception 'This action has already been verified';
  end if;

  update public.corrective_actions
    set verified_by = auth.uid(), verified_at = now()
    where id = p_action_id;

  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    values (v_org_id, 'corrective_action', p_action_id, 'verified', auth.uid());
end;
$$;

grant execute on function public.verify_corrective_action(uuid) to authenticated;

-- Completion evidence — same actor set as complete_corrective_action (the
-- action's owner, or a supervisor/admin of the snag's site), since
-- evidence is typically attached by whoever is closing the action out.
create function public.add_corrective_action_evidence(p_action_id uuid, p_media_path text, p_caption text default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_action public.corrective_actions;
  v_org_id uuid := public.current_org_id();
  v_site_id uuid;
  v_id uuid;
  v_next_index int;
begin
  select ca.* into v_action
    from public.corrective_actions ca
    join public.snags s on s.id = ca.snag_id
    where ca.id = p_action_id and s.org_id = v_org_id;

  if v_action is null then
    raise exception 'Corrective action not found';
  end if;

  select s.site_id into v_site_id from public.snags s where s.id = v_action.snag_id;

  if not public.can_edit_site(v_site_id) and auth.uid() <> v_action.owner_id then
    raise exception 'Only the owner, a supervisor of this site, or an admin can add evidence to this action';
  end if;

  select coalesce(max(sort_index) + 1, 0) into v_next_index
    from public.evidence_items where corrective_action_id = p_action_id;

  insert into public.evidence_items (snag_id, corrective_action_id, uploaded_by, media_path, caption, sort_index)
    values (v_action.snag_id, p_action_id, auth.uid(), p_media_path, p_caption, v_next_index)
    returning id into v_id;

  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    values (v_org_id, 'corrective_action', p_action_id, 'evidence_added', auth.uid());

  return v_id;
end;
$$;

grant execute on function public.add_corrective_action_evidence(uuid, text, text) to authenticated;

-- Resolve gate now requires every corrective action to be both done and
-- independently verified, not merely marked done by whoever closed it.
-- Identical to the prior definition (20260711150000_snag_merge.sql) except
-- for the v_open_actions query and its error message.
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

  update public.snags
    set status = p_status, resolution_note = coalesce(p_note, resolution_note)
    where id = p_snag_id;

  if exists (select 1 from public.snags where parent_snag_id = p_snag_id) then
    update public.snags
      set status = p_status,
          resolution_note = coalesce(p_note, resolution_note),
          resolved_by = case when p_status = 'resolved' then auth.uid() else resolved_by end,
          resolved_at = case when p_status = 'resolved' then now() else resolved_at end
      where parent_snag_id = p_snag_id;
  end if;

  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    values (v_org_id, 'snag', p_snag_id, 'status_' || p_status, auth.uid());
end;
$$;

grant execute on function public.update_snag_status(uuid, public.snag_status, text) to authenticated;

-- snags_with_details' open_corrective_action_count follows the same
-- done-and-verified definition as the resolve gate above, so the
-- "open actions" pill and any future dashboard tile agree with what
-- actually blocks resolution. Identical to the prior definition
-- (20260713140000_snags_with_details_work_group_id.sql) except for the
-- `ca` subquery's filter.
create or replace view public.snags_with_details as
select
  s.id,
  s.reference,
  s.org_id,
  s.site_id,
  s.reporter_id,
  s.kind,
  s.lane,
  s.severity,
  s.description,
  s.photo_path,
  s.occurred_at,
  s.latitude,
  s.longitude,
  s.status,
  s.created_at,
  s.owner_id,
  s.assigned_at,
  s.resolution_note,
  s.retained_until,
  s.is_notifiable,
  s.resolved_by,
  s.resolved_at,
  s.confirmed_by,
  s.confirmed_at,
  s.escalated_by,
  s.escalated_at,
  s.approver_id,
  reporter.name as reporter_name,
  reporter.email as reporter_email,
  owner.name as owner_name,
  site.name as site_name,
  coalesce(cc.completed_count, 0::bigint) as checklist_completed_count,
  coalesce(ev.evidence_count, 0::bigint) as evidence_count,
  coalesce(ca.open_count, 0::bigint) as open_corrective_action_count,
  coalesce(cm.comment_count, 0::bigint) as comment_count,
  coalesce(v.vote_score, 0::bigint) as vote_score,
  coalesce(v.upvote_count, 0::bigint) as upvote_count,
  coalesce(v.downvote_count, 0::bigint) as downvote_count,
  s.photo_paths,
  s.is_public_submission,
  s.parent_snag_id,
  s.merged_by,
  s.merged_at,
  coalesce(children.child_count, 0::bigint) as child_count,
  s.work_group_id
from snags s
  left join profiles reporter on reporter.id = s.reporter_id
  left join profiles owner on owner.id = s.owner_id
  left join sites site on site.id = s.site_id
  left join (
    select checklist_completions.snag_id, count(*) as completed_count
    from checklist_completions group by checklist_completions.snag_id
  ) cc on cc.snag_id = s.id
  left join (
    select evidence_items.snag_id, count(*) as evidence_count
    from evidence_items group by evidence_items.snag_id
  ) ev on ev.snag_id = s.id
  left join (
    select corrective_actions.snag_id, count(*) as open_count
    from corrective_actions
    where not (corrective_actions.status = 'done'::corrective_action_status and corrective_actions.verified_by is not null)
    group by corrective_actions.snag_id
  ) ca on ca.snag_id = s.id
  left join (
    select comments.snag_id, count(*) as comment_count
    from comments group by comments.snag_id
  ) cm on cm.snag_id = s.id
  left join (
    select votes.snag_id, sum(votes.value) as vote_score,
      count(*) filter (where votes.value = 1) as upvote_count,
      count(*) filter (where votes.value = '-1'::integer) as downvote_count
    from votes group by votes.snag_id
  ) v on v.snag_id = s.id
  left join (
    select snags2.parent_snag_id, count(*) as child_count
    from snags snags2 where snags2.parent_snag_id is not null
    group by snags2.parent_snag_id
  ) children on children.parent_snag_id = s.id;

alter view public.snags_with_details set (security_invoker = true);

grant select on public.snags_with_details to anon, authenticated, service_role;
