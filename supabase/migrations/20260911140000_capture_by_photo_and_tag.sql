-- Capture becomes: a photo, an optional line of description, a location tag,
-- and high/low. No title, and no typing a room name.
--
-- Three changes, all of them to make capture a sequence of taps:
--
-- 1. `title` is gone. A photo of a broken toilet seat says what a title would,
--    and requiring one put a keyboard between someone and the thing they were
--    standing in front of. `description` becomes the optional line, and a snag
--    now needs a photo OR a description -- one with neither is nothing.
--
-- 2. Locations are a seeded pick-list (`home.locations`) rather than free text
--    with suggestions derived from use. Derived suggestions are empty on the
--    day the app is installed, which is exactly the day someone decides whether
--    it is worth using.
--
-- 3. Priority moves into capture and becomes high/low. It is the one judgement
--    only the person standing there can make.
--
-- `snags.room` stays TEXT rather than a foreign key to the pick-list: the list
-- query then needs no join, and renaming a location later doesn't silently
-- rewrite the history of snags filed under the old name.
--
-- The tables are empty, so the enum is redefined rather than extended -- no
-- carrying 'now'/'soon'/'someday' around forever as dead values.

-- ---------------------------------------------------------------- teardown

drop view if exists home.snags_with_details;

drop function if exists home.create_snag(uuid, text, text, text[], text);
drop function if exists home.update_snag(
  uuid, text, text, text, home.snag_priority, home.snag_effort,
  boolean, timestamptz, integer, uuid, text[], text[]
);

-- ---------------------------------------------------------------- columns

alter table home.snags drop column title;
alter table home.snags drop column priority;

alter table home.snags
  add constraint snags_has_something check (
    photo_paths <> '{}' or nullif(btrim(coalesce(description, '')), '') is not null
  );

alter table home.snags
  add constraint snags_description_length check (
    description is null or length(btrim(description)) between 1 and 200
  );

drop type home.snag_priority;
create type home.snag_priority as enum ('high', 'low');

alter table home.snags add column priority home.snag_priority;

-- ---------------------------------------------------------------- locations

-- The tags offered at capture. Seeded per household so the list is full the
-- moment the app is opened, and per-household rather than global so a bach or a
-- flat can diverge from a family home later without a migration.
create table home.locations (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references home.households(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 40),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (household_id, name)
);

create index on home.locations (household_id, sort_order);

alter table home.locations enable row level security;

create policy "members read their locations"
  on home.locations for select using (home.is_member(household_id));

grant select on home.locations to authenticated;

-- Ordered by how often a household actually needs them, not alphabetically:
-- the first row of chips should cover most of what gets logged. `Elsewhere`
-- is last and is the escape hatch that keeps a fixed list from being a dead
-- end.
create function home.seed_locations(p_household_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into home.locations (household_id, name, sort_order)
  select p_household_id, name, ord
  from (values
    ('Kitchen', 1), ('Bathroom', 2), ('Bedroom', 3), ('Living room', 4),
    ('Laundry', 5), ('Hallway', 6), ('Garage', 7), ('Outside', 8),
    ('Deck', 9), ('Roof', 10), ('Under the house', 11), ('Elsewhere', 12)
  ) as seed(name, ord)
  on conflict (household_id, name) do nothing;
$$;

revoke execute on function home.seed_locations(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- writes

create or replace function home.create_household(p_name text, p_property_name text default 'Home')
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

  perform home.seed_locations(v_household.id);

  return v_household;
end;
$$;

create function home.create_snag(
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

  perform home.require_member(v_household_id);

  -- Said in words rather than left to the check constraint, which would
  -- surface as `snags_has_something` and mean nothing to anyone.
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

create function home.update_snag(
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
  perform home.require_member(home.snag_household(p_snag_id));

  if p_assignee_id is not null
     and not home.is_member_profile(home.snag_household(p_snag_id), p_assignee_id) then
    raise exception 'That person is not in this household';
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

-- ---------------------------------------------------------------- grants

grant select on home.snags_with_details to authenticated;

grant execute on function home.create_snag(uuid, text, text, text[], home.snag_priority) to authenticated;
grant execute on function home.update_snag(
  uuid, text, text, home.snag_priority, home.snag_effort,
  boolean, timestamptz, integer, uuid, text[], text[]
) to authenticated;
