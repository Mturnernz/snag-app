-- snags_with_details never carried is_public_submission: the column was added
-- to snags by 20260708090000_public_orgs.sql, but the view (last defined by
-- 20260707130000_snags_multi_photo.sql, before that column existed) was never
-- updated to expose it. IssueListScreen/IssueDetailScreen both select and
-- filter on is_public_submission, so every query against this view has been
-- failing with PostgREST 400 ("column does not exist") — the issue list
-- couldn't load at all.

create or replace view public.snags_with_details as
 select s.id,
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
    s.is_public_submission
   from (((((((( public.snags s
     left join public.profiles reporter on reporter.id = s.reporter_id)
     left join public.profiles owner on owner.id = s.owner_id)
     left join public.sites site on site.id = s.site_id)
     left join ( select checklist_completions.snag_id,
            count(*) as completed_count
           from public.checklist_completions
          group by checklist_completions.snag_id) cc on cc.snag_id = s.id)
     left join ( select evidence_items.snag_id,
            count(*) as evidence_count
           from public.evidence_items
          group by evidence_items.snag_id) ev on ev.snag_id = s.id)
     left join ( select corrective_actions.snag_id,
            count(*) as open_count
           from public.corrective_actions
          where corrective_actions.status = 'open'::public.corrective_action_status
          group by corrective_actions.snag_id) ca on ca.snag_id = s.id)
     left join ( select comments.snag_id,
            count(*) as comment_count
           from public.comments
          group by comments.snag_id) cm on cm.snag_id = s.id)
     left join ( select votes.snag_id,
            sum(votes.value) as vote_score,
            count(*) filter (where votes.value = 1) as upvote_count,
            count(*) filter (where votes.value = '-1'::integer) as downvote_count
           from public.votes
          group by votes.snag_id) v on v.snag_id = s.id);
