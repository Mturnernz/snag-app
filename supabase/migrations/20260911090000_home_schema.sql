-- Snag Home — the household maintenance schema.
--
-- Lives in its own `home` schema alongside a frozen `public`. `public` is the
-- retired SnagHQ B2B product: it is not migrated, not dropped, and not read
-- from here. Leaving it intact is the archive (see SNAG_HOME_PIVOT_REVIEW.md),
-- which is why this is a new schema rather than surgery on the old one.
--
-- auth.users is shared — the same accounts sign into both — so nothing about
-- Auth, SMTP or the redirect allow-list changes.
--
-- REQUIRES A DASHBOARD STEP: Settings → API → Exposed schemas must include
-- `home`, or PostgREST serves none of this and every client call 404s.

create schema if not exists home;

-- ---------------------------------------------------------------- types

create type home.member_role as enum ('owner', 'member');
create type home.snag_status as enum ('open', 'doing', 'done');
create type home.snag_priority as enum ('now', 'soon', 'someday');
create type home.snag_effort as enum ('quick', 'half_day', 'big_job');

-- ---------------------------------------------------------------- tables

create table home.households (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 80),
  created_at timestamptz not null default now()
);

create table home.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (length(btrim(display_name)) between 1 and 80),
  created_at timestamptz not null default now()
);

create table home.household_members (
  household_id uuid not null references home.households(id) on delete cascade,
  profile_id uuid not null references home.profiles(id) on delete cascade,
  -- Unread by the client in v1: both of you are owners and the UI has no role
  -- checks. It exists because a shared bach (a family reports, the owner fixes)
  -- is the one second shape worth not foreclosing, and adding it later is a
  -- backfill across every row.
  role home.member_role not null default 'owner',
  created_at timestamptz not null default now(),
  primary key (household_id, profile_id)
);

-- Properties are real rows from day one even though there is exactly one and
-- the UI never shows it. `snags.property_id` is not-null, so adding this later
-- would mean a migration, a backfill, and a change to every query.
create table home.properties (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references home.households(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 80),
  created_at timestamptz not null default now()
);

create index on home.properties (household_id);

create sequence home.snag_reference_seq;

create table home.snags (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique
    default ('SNAG-' || lpad(nextval('home.snag_reference_seq')::text, 4, '0')),
  household_id uuid not null references home.households(id) on delete cascade,
  property_id uuid not null references home.properties(id) on delete cascade,

  -- Capture: what someone standing in the bathroom with ten seconds of
  -- patience provides. Everything below this block is added later, in triage.
  title text not null check (length(btrim(title)) between 1 and 120),
  room text check (room is null or length(btrim(room)) between 1 and 60),
  photo_paths text[] not null default '{}',
  description text,

  -- Triage.
  status home.snag_status not null default 'open',
  priority home.snag_priority,
  effort home.snag_effort,
  -- The most common reason a small job never gets done is that it needs a trip
  -- to the hardware store first. Grouping those into one trip is the point.
  needs_parts boolean not null default false,
  due_at timestamptz,
  repeat_days integer check (repeat_days is null or repeat_days between 1 and 3650),
  assignee_id uuid references home.profiles(id) on delete set null,

  reporter_id uuid not null references home.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references home.profiles(id),
  -- When a recurring item was last completed. A repeating snag never reaches
  -- 'done' — it rolls forward — so done_at alone would lose the fact.
  last_done_at timestamptz,
  done_at timestamptz
);

create index on home.snags (household_id, status);
create index on home.snags (property_id);
create index on home.snags (due_at) where due_at is not null;
create index on home.snags (assignee_id) where assignee_id is not null;

create table home.comments (
  id uuid primary key default gen_random_uuid(),
  snag_id uuid not null references home.snags(id) on delete cascade,
  author_id uuid not null references home.profiles(id),
  body text not null check (length(btrim(body)) between 1 and 4000),
  created_at timestamptz not null default now()
);

create index on home.comments (snag_id, created_at);

-- ---------------------------------------------------------------- access

-- SECURITY DEFINER so the household_members policy can call it without
-- recursing into its own RLS.
create function home.is_member(p_household_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from home.household_members m
    where m.household_id = p_household_id
      and m.profile_id = auth.uid()
  );
$$;

create function home.is_member_profile(p_household_id uuid, p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from home.household_members m
    where m.household_id = p_household_id and m.profile_id = p_profile_id
  );
$$;

create function home.snag_household(p_snag_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select s.household_id from home.snags s where s.id = p_snag_id;
$$;

alter table home.households        enable row level security;
alter table home.profiles          enable row level security;
alter table home.household_members enable row level security;
alter table home.properties        enable row level security;
alter table home.snags             enable row level security;
alter table home.comments          enable row level security;

-- Reads are policy-driven. There are deliberately no insert/update/delete
-- policies anywhere: every write goes through a SECURITY DEFINER RPC below,
-- which is the one discipline from the retired product worth keeping. It means
-- the shape of a write can change without hunting through client code.

create policy "members read their households"
  on home.households for select using (home.is_member(id));

create policy "members read their memberships"
  on home.household_members for select using (home.is_member(household_id));

create policy "members read household profiles"
  on home.profiles for select using (
    id = auth.uid()
    or exists (
      select 1
      from home.household_members mine
      join home.household_members theirs
        on theirs.household_id = mine.household_id
      where mine.profile_id = auth.uid()
        and theirs.profile_id = home.profiles.id
    )
  );

create policy "members read their properties"
  on home.properties for select using (home.is_member(household_id));

create policy "members read their snags"
  on home.snags for select using (home.is_member(household_id));

create policy "members read their comments"
  on home.comments for select using (home.is_member(home.snag_household(snag_id)));

-- ---------------------------------------------------------------- view

create view home.snags_with_details
with (security_invoker = true)
as
select
  s.*,
  p.name                                        as property_name,
  reporter.display_name                         as reporter_name,
  assignee.display_name                         as assignee_name,
  (select count(*) from home.comments c where c.snag_id = s.id) as comment_count
from home.snags s
join home.properties p       on p.id = s.property_id
join home.profiles reporter  on reporter.id = s.reporter_id
left join home.profiles assignee on assignee.id = s.assignee_id;

-- ---------------------------------------------------------------- writes

create function home.require_member(p_household_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not home.is_member(p_household_id) then
    raise exception 'Not a member of this household';
  end if;
end;
$$;

-- Called once per person, straight after sign-up.
create function home.upsert_profile(p_display_name text)
returns home.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile home.profiles;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  insert into home.profiles (id, display_name)
  values (auth.uid(), btrim(p_display_name))
  on conflict (id) do update set display_name = excluded.display_name
  returning * into v_profile;

  return v_profile;
end;
$$;

-- Creating a household creates its first property in the same breath. A
-- household with no property cannot receive a snag, and naming the house is not
-- a second decision worth a second screen.
create function home.create_household(p_name text, p_property_name text default 'Home')
returns home.households
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_household home.households;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  insert into home.households (name) values (btrim(p_name))
  returning * into v_household;

  insert into home.household_members (household_id, profile_id, role)
  values (v_household.id, auth.uid(), 'owner');

  insert into home.properties (household_id, name)
  values (v_household.id, coalesce(nullif(btrim(p_property_name), ''), 'Home'));

  return v_household;
end;
$$;

-- The whole of v1's "invite" flow. Both of you sign up, then one adds the
-- other by the address they signed up with. No tokens, no email delivery, and
-- therefore none of the ways the old invite pipeline failed silently.
create function home.add_member_by_email(p_household_id uuid, p_email text)
returns home.household_members
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_member home.household_members;
begin
  perform home.require_member(p_household_id);

  select u.id into v_user_id
  from auth.users u
  where lower(u.email) = lower(btrim(p_email));

  if v_user_id is null then
    raise exception 'No account with that email yet — ask them to sign up first';
  end if;

  if not exists (select 1 from home.profiles pr where pr.id = v_user_id) then
    raise exception 'That account has not finished signing up yet';
  end if;

  insert into home.household_members (household_id, profile_id, role)
  values (p_household_id, v_user_id, 'owner')
  on conflict (household_id, profile_id) do update set role = excluded.role
  returning * into v_member;

  return v_member;
end;
$$;

create function home.create_snag(
  p_property_id uuid,
  p_title text,
  p_room text default null,
  p_photo_paths text[] default '{}',
  p_description text default null
)
returns home.snags
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_household_id uuid;
  v_snag home.snags;
begin
  select pr.household_id into v_household_id
  from home.properties pr where pr.id = p_property_id;

  if v_household_id is null then
    raise exception 'No such property';
  end if;

  perform home.require_member(v_household_id);

  insert into home.snags (
    household_id, property_id, title, room, photo_paths, description,
    reporter_id, updated_by
  )
  values (
    v_household_id, p_property_id, btrim(p_title),
    nullif(btrim(coalesce(p_room, '')), ''),
    coalesce(p_photo_paths, '{}'),
    nullif(btrim(coalesce(p_description, '')), ''),
    auth.uid(), auth.uid()
  )
  returning * into v_snag;

  return v_snag;
end;
$$;

-- Triage. Every argument is optional and null means "leave it alone", so the
-- client can send one field from a list row without re-sending the item.
-- p_clear names the fields to null out, since null cannot mean both.
create function home.update_snag(
  p_snag_id uuid,
  p_title text default null,
  p_room text default null,
  p_description text default null,
  p_priority home.snag_priority default null,
  p_effort home.snag_effort default null,
  p_needs_parts boolean default null,
  p_due_at timestamptz default null,
  p_repeat_days integer default null,
  p_assignee_id uuid default null,
  p_photo_paths text[] default null,
  p_clear text[] default '{}'
)
returns home.snags
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_snag home.snags;
  v_clear text[] := coalesce(p_clear, '{}');
begin
  perform home.require_member(home.snag_household(p_snag_id));

  if p_assignee_id is not null
     and not home.is_member_profile(home.snag_household(p_snag_id), p_assignee_id) then
    raise exception 'That person is not in this household';
  end if;

  update home.snags s set
    title        = coalesce(btrim(p_title), s.title),
    room         = case when 'room'        = any(v_clear) then null
                        else coalesce(nullif(btrim(coalesce(p_room, '')), ''), s.room) end,
    description  = case when 'description' = any(v_clear) then null
                        else coalesce(nullif(btrim(coalesce(p_description, '')), ''), s.description) end,
    priority     = case when 'priority'    = any(v_clear) then null else coalesce(p_priority, s.priority) end,
    effort       = case when 'effort'      = any(v_clear) then null else coalesce(p_effort, s.effort) end,
    needs_parts  = coalesce(p_needs_parts, s.needs_parts),
    due_at       = case when 'due_at'      = any(v_clear) then null else coalesce(p_due_at, s.due_at) end,
    repeat_days  = case when 'repeat_days' = any(v_clear) then null else coalesce(p_repeat_days, s.repeat_days) end,
    assignee_id  = case when 'assignee_id' = any(v_clear) then null else coalesce(p_assignee_id, s.assignee_id) end,
    photo_paths  = coalesce(p_photo_paths, s.photo_paths),
    updated_at   = now(),
    updated_by   = auth.uid()
  where s.id = p_snag_id
  returning * into v_snag;

  if v_snag.id is null then
    raise exception 'No such snag';
  end if;

  return v_snag;
end;
$$;

-- Marking a repeating snag done doesn't close it — it schedules the next one.
-- That is the whole of the recurring feature: no scheduler, no second table.
create function home.set_snag_status(p_snag_id uuid, p_status home.snag_status)
returns home.snags
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_snag home.snags;
begin
  perform home.require_member(home.snag_household(p_snag_id));

  select * into v_snag from home.snags where id = p_snag_id;
  if v_snag.id is null then
    raise exception 'No such snag';
  end if;

  if p_status = 'done' and v_snag.repeat_days is not null then
    update home.snags s set
      status       = 'open',
      last_done_at = now(),
      due_at       = now() + make_interval(days => s.repeat_days),
      updated_at   = now(),
      updated_by   = auth.uid()
    where s.id = p_snag_id
    returning * into v_snag;
  else
    update home.snags s set
      status       = p_status,
      done_at      = case when p_status = 'done' then now() else null end,
      last_done_at = case when p_status = 'done' then now() else s.last_done_at end,
      updated_at   = now(),
      updated_by   = auth.uid()
    where s.id = p_snag_id
    returning * into v_snag;
  end if;

  return v_snag;
end;
$$;

create function home.add_comment(p_snag_id uuid, p_body text)
returns home.comments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_comment home.comments;
begin
  perform home.require_member(home.snag_household(p_snag_id));

  insert into home.comments (snag_id, author_id, body)
  values (p_snag_id, auth.uid(), btrim(p_body))
  returning * into v_comment;

  return v_comment;
end;
$$;

create function home.delete_snag(p_snag_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Deliberately unlike the retired product, where snags could never be deleted
  -- under any circumstance. That was a regulatory record; this is a list of
  -- household chores, and a mis-typed one should be removable.
  perform home.require_member(home.snag_household(p_snag_id));
  delete from home.snags where id = p_snag_id;
end;
$$;

-- ---------------------------------------------------------------- grants
--
-- Granted by name, never by sweep. `20260803120200` in the retired product
-- swept the schema granting `authenticated` everything outside a small anon
-- allow-list and handed ten internal functions — including a scheduled deletion
-- job — to any signed-in caller. A sweep that grants needs both lists; this
-- lists what it grants.

grant usage on schema home to authenticated;

grant select on home.households        to authenticated;
grant select on home.profiles          to authenticated;
grant select on home.household_members to authenticated;
grant select on home.properties        to authenticated;
grant select on home.snags             to authenticated;
grant select on home.comments          to authenticated;
grant select on home.snags_with_details to authenticated;

grant execute on function home.upsert_profile(text)                          to authenticated;
grant execute on function home.create_household(text, text)                  to authenticated;
grant execute on function home.add_member_by_email(uuid, text)               to authenticated;
grant execute on function home.create_snag(uuid, text, text, text[], text)   to authenticated;
grant execute on function home.update_snag(uuid, text, text, text, home.snag_priority, home.snag_effort, boolean, timestamptz, integer, uuid, text[], text[]) to authenticated;
grant execute on function home.set_snag_status(uuid, home.snag_status)       to authenticated;
grant execute on function home.add_comment(uuid, text)                       to authenticated;
grant execute on function home.delete_snag(uuid)                             to authenticated;

-- The helpers are internal: policies and the RPCs above call them as the
-- definer, so nobody needs EXECUTE to be gated by them.
revoke execute on function home.is_member(uuid)         from public, anon, authenticated;
revoke execute on function home.is_member_profile(uuid, uuid) from public, anon, authenticated;
revoke execute on function home.snag_household(uuid)    from public, anon, authenticated;
revoke execute on function home.require_member(uuid)    from public, anon, authenticated;
