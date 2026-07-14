-- snags_with_details never exposed work_group_id, even though it's a real
-- column on snags used throughout the work-group feature — the Snags list's
-- new "Unassigned in my work groups" scope filter needs to read/filter on
-- it. Re-apply security_invoker explicitly afterward: CREATE OR REPLACE
-- VIEW shouldn't reset it, but this view's RLS-enforcement property is
-- critical enough (see 20260712090000_security_hardening_pass.sql) to be
-- unambiguous about rather than relying on that assumption.
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
    from corrective_actions where corrective_actions.status = 'open'::corrective_action_status
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
