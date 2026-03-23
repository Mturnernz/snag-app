-- ============================================================
-- SNAG — Vote aggregation in view + RLS optimisation
-- Run in Supabase SQL Editor → New Query
-- ============================================================

-- ─── Votes table ─────────────────────────────────────────────────────────────
-- Create if not already present (may have been created manually).

create table if not exists votes (
  id         uuid primary key default gen_random_uuid(),
  issue_id   uuid not null references issues(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  value      smallint not null check (value in (1, -1)),
  created_at timestamptz not null default now(),
  unique (issue_id, user_id)
);

alter table votes enable row level security;

-- Allow org members to read votes on their org's issues
do $$ begin
  if not exists (
    select 1 from pg_policies where tablename = 'votes' and policyname = 'Org members can view votes'
  ) then
    create policy "Org members can view votes" on votes
      for select using (
        issue_id in (
          select id from issues
          where organisation_id = (select organisation_id from profiles where id = auth.uid())
        )
      );
  end if;
end $$;

-- Users can insert/update/delete their own votes
do $$ begin
  if not exists (
    select 1 from pg_policies where tablename = 'votes' and policyname = 'Users can manage own votes'
  ) then
    create policy "Users can manage own votes" on votes
      for all using (user_id = auth.uid())
      with check (user_id = auth.uid());
  end if;
end $$;

-- Index to speed up vote lookups by issue (used in view aggregation)
create index if not exists idx_votes_issue_id on votes(issue_id);

-- ─── RLS optimisation helper ──────────────────────────────────────────────────
-- Replaces the inline `select organisation_id from profiles where id = auth.uid()`
-- subquery that previously ran once per row evaluated by RLS policies.
-- As a STABLE SECURITY DEFINER function it is evaluated once per query instead.

create or replace function auth_organisation_id()
returns uuid
language sql
stable
security definer
as $$
  select organisation_id from profiles where id = auth.uid()
$$;

-- ─── Update RLS policies to use the helper ────────────────────────────────────

-- issues
drop policy if exists "Issues visible to org members" on issues;
create policy "Issues visible to org members"
  on issues for select
  using (organisation_id = auth_organisation_id());

drop policy if exists "Org members can insert issues" on issues;
create policy "Org members can insert issues"
  on issues for insert
  with check (
    organisation_id = auth_organisation_id()
    and reporter_id = auth.uid()
  );

drop policy if exists "Reporters and admins can update issues" on issues;
create policy "Reporters and admins can update issues"
  on issues for update
  using (organisation_id = auth_organisation_id());

-- comments
drop policy if exists "Comments visible to org members" on comments;
create policy "Comments visible to org members"
  on comments for select
  using (
    issue_id in (
      select id from issues where organisation_id = auth_organisation_id()
    )
  );

drop policy if exists "Org members can add comments" on comments;
create policy "Org members can add comments"
  on comments for insert
  with check (
    author_id = auth.uid()
    and issue_id in (
      select id from issues where organisation_id = auth_organisation_id()
    )
  );

-- profiles
drop policy if exists "Profiles are viewable by org members" on profiles;
create policy "Profiles are viewable by org members"
  on profiles for select
  using (organisation_id = auth_organisation_id());

-- ─── Update issues_with_details view — add vote aggregation ──────────────────
-- vote_score, upvote_count, downvote_count were previously always NULL
-- because the votes table was not joined.

create or replace view issues_with_details as
select
  i.*,
  p.name                                                      as reporter_name,
  p.avatar_url                                                as reporter_avatar,
  a.name                                                      as assignee_name,
  a.avatar_url                                                as assignee_avatar,
  count(distinct c.id)::int                                   as comment_count,
  coalesce(sum(v.value), 0)::int                              as vote_score,
  count(distinct case when v.value =  1 then v.id end)::int  as upvote_count,
  count(distinct case when v.value = -1 then v.id end)::int  as downvote_count
from issues i
left join profiles p on p.id = i.reporter_id
left join profiles a on a.id = i.assignee_id
left join comments c on c.issue_id = i.id
left join votes   v on v.issue_id = i.id
group by i.id, p.name, p.avatar_url, a.name, a.avatar_url;
