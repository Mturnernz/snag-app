-- Engagement features additive to the real Snagv1 schema: team discussion,
-- lightweight "others affected" voting, and points/leaderboard gamification.
-- None of this exists in the core HSWA schema (snags/investigations/rca/etc)
-- by design — these are engagement features layered on top, not compliance
-- records. Follows the existing convention: RLS grants SELECT only, every
-- write goes through a SECURITY DEFINER RPC.

-- ─── Tables ─────────────────────────────────────────────────────────────────

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  snag_id uuid not null references public.snags(id) on delete cascade,
  author_id uuid not null references public.profiles(id),
  body text not null,
  created_at timestamptz not null default now()
);

alter table public.comments enable row level security;

create policy "org members can view comments"
  on public.comments for select
  using (exists (
    select 1 from public.snags s
    where s.id = comments.snag_id and s.org_id = current_org_id()
  ));

create table public.votes (
  id uuid primary key default gen_random_uuid(),
  snag_id uuid not null references public.snags(id) on delete cascade,
  user_id uuid not null references public.profiles(id),
  value smallint not null check (value in (1, -1)),
  created_at timestamptz not null default now(),
  unique (snag_id, user_id)
);

alter table public.votes enable row level security;

create policy "org members can view votes"
  on public.votes for select
  using (exists (
    select 1 from public.snags s
    where s.id = votes.snag_id and s.org_id = current_org_id()
  ));

create table public.user_points (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id),
  org_id uuid not null references public.organisations(id),
  points integer not null default 0,
  updated_at timestamptz not null default now(),
  unique (user_id, org_id)
);

alter table public.user_points enable row level security;

create policy "org members can view points"
  on public.user_points for select
  using (org_id = current_org_id());

create table public.points_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id),
  org_id uuid not null references public.organisations(id),
  event text not null,
  points integer not null,
  snag_id uuid references public.snags(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.points_log enable row level security;

create policy "org members can view points log"
  on public.points_log for select
  using (org_id = current_org_id());

-- ─── RPCs (writes) ──────────────────────────────────────────────────────────

create or replace function public.add_comment(p_snag_id uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_comment_id uuid;
begin
  if not exists (select 1 from public.snags s where s.id = p_snag_id and s.org_id = current_org_id()) then
    raise exception 'snag not found';
  end if;

  insert into public.comments (snag_id, author_id, body)
  values (p_snag_id, auth.uid(), p_body)
  returning id into v_comment_id;

  return v_comment_id;
end;
$$;

create or replace function public.cast_vote(p_snag_id uuid, p_value smallint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.snags s where s.id = p_snag_id and s.org_id = current_org_id()) then
    raise exception 'snag not found';
  end if;

  insert into public.votes (snag_id, user_id, value)
  values (p_snag_id, auth.uid(), p_value)
  on conflict (snag_id, user_id) do update set value = excluded.value, created_at = now();
end;
$$;

create or replace function public.remove_vote(p_snag_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.votes where snag_id = p_snag_id and user_id = auth.uid();
end;
$$;

-- Client-invoked (mirrors the old app's pattern: the frontend calls this at
-- the moment an action should award points, e.g. after a successful report
-- or resolution — no automatic trigger wiring into the core snag lifecycle).
create or replace function public.award_points(p_event text, p_points integer, p_snag_id uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid := current_org_id();
begin
  insert into public.points_log (user_id, org_id, event, points, snag_id)
  values (auth.uid(), v_org_id, p_event, p_points, p_snag_id);

  insert into public.user_points (user_id, org_id, points)
  values (auth.uid(), v_org_id, p_points)
  on conflict (user_id, org_id) do update
    set points = public.user_points.points + excluded.points,
        updated_at = now();
end;
$$;

create or replace function public.get_leaderboard(p_org_id uuid, p_since timestamptz)
returns table(user_id uuid, name text, total_points bigint)
language sql
security definer
set search_path = public
as $$
  select pl.user_id, p.name, sum(pl.points)::bigint as total_points
  from public.points_log pl
  join public.profiles p on p.id = pl.user_id
  where pl.org_id = p_org_id
    and pl.org_id = current_org_id()
    and pl.created_at >= p_since
  group by pl.user_id, p.name
  order by total_points desc
  limit 50;
$$;
