-- Scaling pass: cover the hot query paths that were relying on sequential
-- scans. Verified against live pg_indexes before adding — none of these
-- existed.

-- Every comment read goes through the RLS policy's EXISTS (... where
-- s.id = comments.snag_id ...) plus the detail screen's .eq('snag_id', ...);
-- without this, both scan the whole comments table per snag viewed.
create index comments_snag_id_idx on public.comments (snag_id);

-- Filtered by every Snags-list load, the tab badge count, and the merged-
-- children fetch (.is('parent_snag_id', null) / .eq('parent_snag_id', id)).
create index snags_parent_snag_id_idx on public.snags (parent_snag_id);

-- Owner/work-group lookups: auto-assignment trigger, bulk actions, and any
-- future "assigned to me" / per-work-group filtering.
create index snags_owner_id_idx on public.snags (owner_id);
create index snags_work_group_id_idx on public.snags (work_group_id);

-- Comment author join on the detail screen (comments -> profiles).
create index comments_author_id_idx on public.comments (author_id);

-- Vote lookups are by (snag_id, user_id) — covered — but "my vote" checks
-- also come in by user alone via getUserVote's .eq chain; harmless and tiny.
create index votes_user_id_idx on public.votes (user_id);
