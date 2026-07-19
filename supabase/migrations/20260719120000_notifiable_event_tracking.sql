-- Notifiable-event decision support (Compliance Baseline, Phase 2).
--
-- is_notifiable and set_notifiable_flag already existed (20260621084954)
-- but had no client caller and no record of who set the flag or when —
-- every other snag state change (resolved_by/at, escalated_by/at) already
-- denormalizes an actor/timestamp pair, so this brings is_notifiable in
-- line with that pattern rather than introducing a new one. The "as soon
-- as possible" WorkSafe notification duty is easier to evidence with an
-- explicit timestamp than by reconstructing it from audit_log.

alter table public.snags
  add column notifiable_marked_by uuid references public.profiles(id),
  add column notifiable_marked_at timestamptz;

create or replace function public.set_notifiable_flag(p_snag_id uuid, p_value boolean)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org_id uuid := public.current_org_id();
begin
  if not exists (select 1 from public.snags where id = p_snag_id and org_id = v_org_id) then
    raise exception 'Snag not found';
  end if;
  if public.current_role() not in ('officer_admin', 'supervisor') then
    raise exception 'Only a supervisor or admin can set the notifiable flag';
  end if;

  update public.snags
    set is_notifiable = p_value,
        notifiable_marked_by = auth.uid(),
        notifiable_marked_at = now()
    where id = p_snag_id;

  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    values (v_org_id, 'snag', p_snag_id, case when p_value then 'marked_notifiable' else 'unmarked_notifiable' end, auth.uid());
end;
$$;

grant execute on function public.set_notifiable_flag(uuid, boolean) to authenticated;

-- Surface the two new columns on the app's central read view. Identical to
-- the prior definition (20260717090000_capa_verification_evidence.sql)
-- except for the two added select-list columns.
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
  s.work_group_id,
  s.notifiable_marked_by,
  s.notifiable_marked_at
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
