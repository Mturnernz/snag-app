-- Read-optimized view analogous to the old issues_with_details — avoids
-- client-side N+1 joins for reporter/owner/site names plus the engagement
-- and investigation-pipeline counts the list/detail screens need.
-- security_invoker ensures the view is subject to the querying user's own
-- RLS (org/site scoping via current_org_id()/can_view_site()), not the view
-- owner's — required since this project's RLS is org/site multi-tenant.

create or replace view public.snags_with_details
with (security_invoker = true) as
select
  s.*,
  reporter.name as reporter_name,
  reporter.email as reporter_email,
  owner.name as owner_name,
  site.name as site_name,
  coalesce(cc.completed_count, 0) as checklist_completed_count,
  coalesce(ev.evidence_count, 0) as evidence_count,
  coalesce(ca.open_count, 0) as open_corrective_action_count,
  coalesce(cm.comment_count, 0) as comment_count,
  coalesce(v.vote_score, 0) as vote_score,
  coalesce(v.upvote_count, 0) as upvote_count,
  coalesce(v.downvote_count, 0) as downvote_count
from public.snags s
left join public.profiles reporter on reporter.id = s.reporter_id
left join public.profiles owner on owner.id = s.owner_id
left join public.sites site on site.id = s.site_id
left join (
  select snag_id, count(*) as completed_count
  from public.checklist_completions
  group by snag_id
) cc on cc.snag_id = s.id
left join (
  select snag_id, count(*) as evidence_count
  from public.evidence_items
  group by snag_id
) ev on ev.snag_id = s.id
left join (
  select snag_id, count(*) as open_count
  from public.corrective_actions
  where status = 'open'
  group by snag_id
) ca on ca.snag_id = s.id
left join (
  select snag_id, count(*) as comment_count
  from public.comments
  group by snag_id
) cm on cm.snag_id = s.id
left join (
  select snag_id,
    sum(value) as vote_score,
    count(*) filter (where value = 1) as upvote_count,
    count(*) filter (where value = -1) as downvote_count
  from public.votes
  group by snag_id
) v on v.snag_id = s.id;
