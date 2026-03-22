-- ============================================================
-- SNAG — Performance Indexes & get_leaderboard RPC
-- Run in Supabase SQL Editor → New Query
-- ============================================================

-- ─── Indexes ──────────────────────────────────────────────────────────────────
-- These cover the columns used in .eq(), .order(), and .gte() calls across
-- IssueListScreen, IssueDetailScreen, LeaderboardScreen, and the RLS policies.

-- issues: filter by org + status (IssueListScreen), order by created_at
create index if not exists idx_issues_org_status
  on issues (organisation_id, status);

create index if not exists idx_issues_org_created
  on issues (organisation_id, created_at desc);

-- issues: reporter_id used in AdminDashboard issue count aggregation
create index if not exists idx_issues_reporter
  on issues (reporter_id);

-- comments: eq on issue_id + order by created_at (IssueDetailScreen)
create index if not exists idx_comments_issue_created
  on comments (issue_id, created_at asc);

-- votes: eq on issue_id + user_id (getUserVote)
create index if not exists idx_votes_issue_user
  on votes (issue_id, user_id);

-- points_log: filter by org + time range (leaderboard week/month)
create index if not exists idx_points_log_org_created
  on points_log (org_id, created_at desc);

-- user_points: eq on org_id + order by points (leaderboard all-time)
create index if not exists idx_user_points_org_points
  on user_points (org_id, points desc);

-- ─── get_leaderboard RPC ──────────────────────────────────────────────────────
-- Aggregates points_log in Postgres instead of shipping every row to the client.
-- Called by LeaderboardScreen for week/month filters.

create or replace function get_leaderboard(
  p_org_id uuid,
  p_since   timestamptz
)
returns table (
  user_id      uuid,
  name         text,
  total_points bigint
)
language sql
stable
security definer
as $$
  select
    pl.user_id,
    coalesce(p.name, 'Unknown') as name,
    sum(pl.points)              as total_points
  from points_log pl
  left join profiles p on p.id = pl.user_id
  where pl.org_id    = p_org_id
    and pl.created_at >= p_since
  group by pl.user_id, p.name
  order by total_points desc
  limit 50;
$$;
