-- A bach is a second property, not a location tag.
--
-- `properties` has been a real not-null column on every snag since the schema
-- was stood up, precisely so this wouldn't be a rewrite. This surfaces it:
-- people are linked to properties, a snag belongs to the property its reporter
-- picked, and you see the snags of the properties you're linked to.
--
-- Three things follow, and the third is the one that was wrong before:
--
-- 1. `property_members` -- who is linked to which property. Household
--    membership no longer implies seeing every property: a family can share a
--    bach without seeing the snags in each other's houses, which is the whole
--    reason the case is interesting.
--
-- 2. Locations move from the household to the PROPERTY. A bach has a boatshed
--    and a jetty; a house has a laundry and a hallway. Sharing one tag list
--    across both would force the union on everybody, and a bach's tags are the
--    clearest illustration of why "bach" was never a tag itself.
--
-- 3. Reads are scoped by property, not by household. Selecting which property a
--    snag goes to and seeing that property's snags have to draw the same line,
--    or the picker offers somewhere you can't then read.
--
-- Everything here is invisible to a one-property household: the picker renders
-- only when there is more than one to choose between.

-- ---------------------------------------------------------------- membership

create table home.property_members (
  property_id uuid not null references home.properties(id) on delete cascade,
  profile_id uuid not null references home.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (property_id, profile_id)
);

create index on home.property_members (profile_id);

alter table home.property_members enable row level security;

-- SECURITY DEFINER so the property_members policy can call it without
-- recursing into its own RLS -- same shape as home.is_member.
--
-- This MUST be EXECUTE-able by `authenticated`: a policy expression is
-- evaluated as the calling role, so revoking it would raise 42501 on every
-- read rather than returning no rows. That is the mistake 20260911093000
-- exists to fix; don't make it twice.
create function home.is_property_member(p_property_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from home.property_members m
    where m.property_id = p_property_id
      and m.profile_id = auth.uid()
  );
$$;

grant execute on function home.is_property_member(uuid) to authenticated;

create function home.snag_property(p_snag_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select s.property_id from home.snags s where s.id = p_snag_id;
$$;

revoke execute on function home.snag_property(uuid) from public, anon, authenticated;

create function home.require_property_member(p_property_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not home.is_property_member(p_property_id) then
    raise exception 'You are not linked to that property';
  end if;
end;
$$;

revoke execute on function home.require_property_member(uuid) from public, anon, authenticated;

create policy "members read their property links"
  on home.property_members for select using (home.is_property_member(property_id));

grant select on home.property_members to authenticated;

-- ---------------------------------------------------------------- locations

-- The existing policy reads household_id, so it has to go before the column
-- does -- Postgres refuses the drop otherwise, and the whole migration rolls
-- back with it.
drop policy "members read their locations" on home.locations;

alter table home.locations add column property_id uuid references home.properties(id) on delete cascade;

-- Each household has exactly one property at this point, so the move is
-- unambiguous. Written out rather than assumed because a migration that only
-- works on an empty table is a migration nobody can trust.
update home.locations l
set property_id = (
  select p.id from home.properties p
  where p.household_id = l.household_id
  order by p.created_at, p.id
  limit 1
);

delete from home.locations where property_id is null;

alter table home.locations alter column property_id set not null;
alter table home.locations drop column household_id;
alter table home.locations add constraint locations_unique_per_property unique (property_id, name);

create index on home.locations (property_id, sort_order);

create policy "members read their locations"
  on home.locations for select using (home.is_property_member(property_id));

-- ---------------------------------------------------------------- re-scope

drop policy "members read their properties" on home.properties;
drop policy "members read their snags" on home.snags;
drop policy "members read their comments" on home.comments;

create policy "members read their properties"
  on home.properties for select using (home.is_property_member(id));

create policy "members read their snags"
  on home.snags for select using (home.is_property_member(property_id));

create policy "members read their comments"
  on home.comments for select using (
    exists (
      select 1 from home.snags s
      where s.id = home.comments.snag_id
        and home.is_property_member(s.property_id)
    )
  );

-- ---------------------------------------------------------------- writes

-- Dropped rather than replaced: the parameter is renamed (p_household_id ->
-- p_property_id) and Postgres refuses to rename an input parameter in place.
-- plpgsql resolves calls at runtime, so create_household below is unaffected
-- between the drop and the create.
drop function home.seed_locations(uuid);

create function home.seed_locations(p_property_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into home.locations (property_id, name, sort_order)
  select p_property_id, name, ord
  from (values
    ('Kitchen', 1), ('Bathroom', 2), ('Bedroom', 3), ('Living room', 4),
    ('Laundry', 5), ('Hallway', 6), ('Garage', 7), ('Outside', 8),
    ('Deck', 9), ('Roof', 10), ('Under the house', 11), ('Elsewhere', 12)
  ) as seed(name, ord)
  on conflict (property_id, name) do nothing;
$$;

revoke execute on function home.seed_locations(uuid) from public, anon, authenticated;

create or replace function home.create_household(p_name text, p_property_name text default 'Home')
returns home.households
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_household home.households;
  v_property_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  insert into home.households (name) values (btrim(p_name))
  returning * into v_household;

  insert into home.household_members (household_id, profile_id, role)
  values (v_household.id, auth.uid(), 'owner');

  insert into home.properties (household_id, name)
  values (v_household.id, coalesce(nullif(btrim(p_property_name), ''), 'Home'))
  returning id into v_property_id;

  insert into home.property_members (property_id, profile_id)
  values (v_property_id, auth.uid());

  perform home.seed_locations(v_property_id);

  return v_household;
end;
$$;

-- Adding a second property is the bach. The creator is linked to it and nobody
-- else: the point of a separate property is that its people are a different
-- set, so linking the whole household by default would defeat it on the first
-- use.
create function home.create_property(p_household_id uuid, p_name text)
returns home.properties
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_property home.properties;
begin
  perform home.require_member(p_household_id);

  insert into home.properties (household_id, name)
  values (p_household_id, btrim(p_name))
  returning * into v_property;

  insert into home.property_members (property_id, profile_id)
  values (v_property.id, auth.uid());

  perform home.seed_locations(v_property.id);

  return v_property;
end;
$$;

create function home.rename_property(p_property_id uuid, p_name text)
returns home.properties
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_property home.properties;
begin
  perform home.require_property_member(p_property_id);

  update home.properties set name = btrim(p_name)
  where id = p_property_id
  returning * into v_property;

  return v_property;
end;
$$;

create function home.link_property_member(p_property_id uuid, p_profile_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_household_id uuid;
begin
  perform home.require_property_member(p_property_id);

  select household_id into v_household_id from home.properties where id = p_property_id;

  if not home.is_member_profile(v_household_id, p_profile_id) then
    raise exception 'That person is not in this household';
  end if;

  insert into home.property_members (property_id, profile_id)
  values (p_property_id, p_profile_id)
  on conflict do nothing;
end;
$$;

-- Refuses to unlink the last person, the same shape as the old product's
-- last-owner refusal: a property nobody is linked to is invisible to everyone,
-- including whoever would need to link somebody back to it.
create function home.unlink_property_member(p_property_id uuid, p_profile_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform home.require_property_member(p_property_id);

  if (select count(*) from home.property_members where property_id = p_property_id) <= 1 then
    raise exception 'Someone has to stay linked to a property, or nobody can see it again';
  end if;

  delete from home.property_members
  where property_id = p_property_id and profile_id = p_profile_id;
end;
$$;

-- Dropped rather than replaced: the argument list changes, so `create or
-- replace` would leave the two-argument version behind as an overload -- one
-- that adds a household member and links them to no property at all, which is
-- an account that can see nothing.
drop function home.add_member_by_email(uuid, text);

-- `p_property_ids` null means every property in the household, which is right
-- while there is one and wrong the moment there is a bach -- so the client
-- passes an explicit list once there is more than one to choose between.
create function home.add_member_by_email(
  p_household_id uuid,
  p_email text,
  p_property_ids uuid[] default null
)
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

  insert into home.property_members (property_id, profile_id)
  select p.id, v_user_id
  from home.properties p
  where p.household_id = p_household_id
    and (p_property_ids is null or p.id = any(p_property_ids))
  on conflict do nothing;

  return v_member;
end;
$$;

-- create_snag now checks the PROPERTY, not the household: a household member
-- who isn't linked to the bach must not be able to file against it.
create or replace function home.create_snag(
  p_property_id uuid,
  p_room text default null,
  p_description text default null,
  p_photo_paths text[] default '{}',
  p_priority home.snag_priority default null
)
returns home.snags
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_household_id uuid;
  v_snag home.snags;
  v_description text := nullif(btrim(coalesce(p_description, '')), '');
  v_photos text[] := coalesce(p_photo_paths, '{}');
begin
  select pr.household_id into v_household_id
  from home.properties pr where pr.id = p_property_id;

  if v_household_id is null then
    raise exception 'No such property';
  end if;

  perform home.require_property_member(p_property_id);

  if v_photos = '{}' and v_description is null then
    raise exception 'Add a photo or a few words — otherwise there is nothing to go on';
  end if;

  insert into home.snags (
    household_id, property_id, room, description, photo_paths, priority,
    reporter_id, updated_by
  )
  values (
    v_household_id, p_property_id,
    nullif(btrim(coalesce(p_room, '')), ''),
    v_description, v_photos, p_priority,
    auth.uid(), auth.uid()
  )
  returning * into v_snag;

  return v_snag;
end;
$$;

-- The remaining snag writes follow the same line as reading one.
create or replace function home.update_snag(
  p_snag_id uuid,
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
  perform home.require_property_member(home.snag_property(p_snag_id));

  -- The assignee has to be linked to the property, not merely in the
  -- household: assigning the bach's gutters to someone who cannot see the bach
  -- is a job that silently never gets done.
  if p_assignee_id is not null
     and not exists (
       select 1 from home.property_members m
       where m.property_id = home.snag_property(p_snag_id)
         and m.profile_id = p_assignee_id
     ) then
    raise exception 'That person is not linked to this property';
  end if;

  update home.snags s set
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

create or replace function home.set_snag_status(p_snag_id uuid, p_status home.snag_status)
returns home.snags
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_snag home.snags;
begin
  perform home.require_property_member(home.snag_property(p_snag_id));

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

create or replace function home.add_comment(p_snag_id uuid, p_body text)
returns home.comments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_comment home.comments;
begin
  perform home.require_property_member(home.snag_property(p_snag_id));

  insert into home.comments (snag_id, author_id, body)
  values (p_snag_id, auth.uid(), btrim(p_body))
  returning * into v_comment;

  return v_comment;
end;
$$;

create or replace function home.delete_snag(p_snag_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform home.require_property_member(home.snag_property(p_snag_id));
  delete from home.snags where id = p_snag_id;
end;
$$;

-- ---------------------------------------------------------------- default

-- Which property the capture screen starts on.
--
-- Deliberately "the one they last actually filed against", not the one they
-- last tapped. The retired product learned this the expensive way: its
-- equivalent took `my_member_site_ids()[0]` from an RPC with no ORDER BY, so a
-- member of three sites sent every report to whichever row Postgres happened
-- to return first, forever, with nothing in the UI naming the site at all. It
-- looked like a permissions problem to the person hitting it.
--
-- A server read, so it holds on a new device and on the web build.
create function home.last_reported_property()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select s.property_id
  from home.snags s
  where s.reporter_id = auth.uid()
    and home.is_property_member(s.property_id)
  order by s.created_at desc
  limit 1;
$$;

grant execute on function home.last_reported_property() to authenticated;

-- ---------------------------------------------------------------- grants

grant execute on function home.create_property(uuid, text)                  to authenticated;
grant execute on function home.rename_property(uuid, text)                  to authenticated;
grant execute on function home.link_property_member(uuid, uuid)             to authenticated;
grant execute on function home.unlink_property_member(uuid, uuid)           to authenticated;
grant execute on function home.add_member_by_email(uuid, text, uuid[])      to authenticated;
