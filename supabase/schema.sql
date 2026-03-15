-- ============================================================
-- SNAG — Supabase Schema
-- Run this in your Supabase project: SQL Editor → New Query
-- ============================================================

-- Enable UUID extension (already enabled on Supabase by default)
create extension if not exists "uuid-ossp";

-- ─── Enums ──────────────────────────────────────────────────────────────────

create type issue_status as enum ('open', 'in_progress', 'resolved', 'closed');
create type issue_priority as enum ('low', 'medium', 'high');
create type issue_category as enum ('niggle', 'broken_equipment', 'health_and_safety', 'other');

-- ─── Organisations ───────────────────────────────────────────────────────────

create table organisations (
  id          uuid primary key default uuid_generate_v4(),
  name        text not null,
  created_at  timestamptz not null default now()
);

-- ─── Profiles ────────────────────────────────────────────────────────────────
-- Extends Supabase auth.users — created automatically on sign-up via trigger

create table profiles (
  id               uuid primary key references auth.users(id) on delete cascade,
  name             text not null default '',
  email            text not null default '',
  organisation_id  uuid references organisations(id),
  invite_code      text unique not null default upper(substring(md5(random()::text) from 1 for 6)),
  avatar_url       text,
  created_at       timestamptz not null default now()
);

-- Trigger: auto-create profile row when a user signs up
create or replace function handle_new_user()
returns trigger as $$
begin
  insert into profiles (id, email)
  values (new.id, new.email);
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();

-- ─── Issues ──────────────────────────────────────────────────────────────────

create table issues (
  id               uuid primary key default uuid_generate_v4(),
  title            text not null,
  description      text,
  photo_url        text,
  category         issue_category not null default 'niggle',
  priority         issue_priority not null default 'medium',
  status           issue_status not null default 'open',
  reporter_id      uuid not null references profiles(id) on delete cascade,
  assignee_id      uuid references profiles(id) on delete set null,
  organisation_id  uuid not null references organisations(id) on delete cascade,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- Auto-update updated_at
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger issues_updated_at
  before update on issues
  for each row execute procedure update_updated_at();

-- ─── Comments ────────────────────────────────────────────────────────────────

create table comments (
  id          uuid primary key default uuid_generate_v4(),
  issue_id    uuid not null references issues(id) on delete cascade,
  author_id   uuid not null references profiles(id) on delete cascade,
  body        text not null,
  created_at  timestamptz not null default now()
);

-- ─── Storage bucket ──────────────────────────────────────────────────────────
-- Create this in Storage → New Bucket, name: "issue-photos", public: true
-- Or run via Supabase dashboard. SQL bucket creation is not directly supported.

-- ─── Row Level Security (RLS) ────────────────────────────────────────────────

alter table organisations enable row level security;
alter table profiles enable row level security;
alter table issues enable row level security;
alter table comments enable row level security;

-- Profiles: users can read all profiles in their org, update only their own
create policy "Profiles are viewable by org members"
  on profiles for select
  using (
    organisation_id = (select organisation_id from profiles where id = auth.uid())
  );

create policy "Users can update their own profile"
  on profiles for update
  using (id = auth.uid());

-- Issues: scoped to the user's organisation
create policy "Issues visible to org members"
  on issues for select
  using (
    organisation_id = (select organisation_id from profiles where id = auth.uid())
  );

create policy "Org members can insert issues"
  on issues for insert
  with check (
    organisation_id = (select organisation_id from profiles where id = auth.uid())
    and reporter_id = auth.uid()
  );

create policy "Reporters and admins can update issues"
  on issues for update
  using (
    organisation_id = (select organisation_id from profiles where id = auth.uid())
  );

-- Comments: scoped to the issue's organisation
create policy "Comments visible to org members"
  on comments for select
  using (
    issue_id in (
      select id from issues
      where organisation_id = (select organisation_id from profiles where id = auth.uid())
    )
  );

create policy "Org members can add comments"
  on comments for insert
  with check (
    author_id = auth.uid()
    and issue_id in (
      select id from issues
      where organisation_id = (select organisation_id from profiles where id = auth.uid())
    )
  );

-- ─── Useful views ────────────────────────────────────────────────────────────

-- Issues with comment count and reporter/assignee names
create or replace view issues_with_details as
select
  i.*,
  p.name  as reporter_name,
  p.avatar_url as reporter_avatar,
  a.name  as assignee_name,
  a.avatar_url as assignee_avatar,
  count(c.id)::int as comment_count
from issues i
left join profiles p on p.id = i.reporter_id
left join profiles a on a.id = i.assignee_id
left join comments c on c.issue_id = i.id
group by i.id, p.name, p.avatar_url, a.name, a.avatar_url;
