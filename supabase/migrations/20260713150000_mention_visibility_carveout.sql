-- "Track a snag you're @mentioned in" only works end-to-end if the mentioned
-- user can actually see the snag AND read its comment thread — neither
-- currently has a carve-out for comment_mentions (snags has one for
-- reporter_id, comments has none at all beyond "matches your active org").
-- Mirrors the existing reporter_id pattern on snags: a mention grants
-- visibility regardless of which org is currently active.

alter policy "members can view snags at sites they can see" on public.snags
using (
  (
    org_id = (select public.current_org_id())
    and public.can_view_site(site_id)
    and (public.is_org_active(org_id) or (select public."current_role"()) = 'officer_admin'::public.user_role)
  )
  or reporter_id = (select auth.uid())
  or id in (select snag_id from public.comment_mentions where mentioned_user_id = (select auth.uid()))
);

-- Snag-level, not comment-level: being mentioned once in a thread should
-- reveal the whole thread on that snag, not just the single comment that
-- tagged you — that's what "track comments" means in practice.
alter policy "org members can view comments" on public.comments
using (
  exists (select 1 from public.snags s where s.id = comments.snag_id and s.org_id = (select public.current_org_id()))
  or exists (
    select 1 from public.comment_mentions cm
    where cm.snag_id = comments.snag_id and cm.mentioned_user_id = (select auth.uid())
  )
);
