-- The house record: what's *there*, beside the list of what's wrong.
--
-- A snag is almost always about a thing — the heat pump, the hallway paint,
-- the toilet cistern. The list has never known that, so the same question gets
-- answered from scratch every time: which filter, which green, which model.
-- This is the table that holds the answer, and the column on `snags` that
-- points at it.
--
-- **A thing is a photograph of its label.** That is the whole design, and it
-- is the same move capture made: the rating plate on the back of the heat pump
-- and the lid of the paint tin are already the record — somebody printed them
-- so you could read them later. One tap captures make, model, serial,
-- refrigerant charge and date of manufacture without typing a character or
-- knowing which of those will matter. So `things_has_something` mirrors
-- `snags_has_something`: a photo, or a name, or a model number. Every other
-- column is optional and asked afterwards, on the same amend row a snag gets.
--
-- The failure mode this is built against is specific. Every house-inventory
-- product ever shipped opens on an empty thirty-field form, a house has four
-- hundred things in it, and the record ends up 8% complete — which is worse
-- than nothing, because you check it once, it's empty, and you never check
-- again. Hence: no required fields anywhere, and no completeness score.
--
-- Five kinds, of which the app ships two. `fitting`, `fabric` and `contact`
-- are in the enum from the start so that adding them later is a screen and not
-- a migration; `appliance` and `finish` are the two with the sharpest read
-- moments (a model number read out on a repair call, a colour code read in the
-- shop) and the two that get filled in.
--
-- One table rather than five, because the kinds share most of their columns —
-- a name, a room, a photo, a make, a date. Five tables would mean five read
-- policies, five write functions and five places to get the property check
-- wrong. The genuinely per-kind fields (a paint's sheen and tint formula, a
-- cylinder's litres, a ceiling's R-value) go in `spec`, which is jsonb and is
-- deliberately the small tail rather than the body.
--
-- Photos reuse `home-photos` and the existing `<household_id>/<file>` layout,
-- which is why this migration touches no storage policy: `can_use_photo_folder`
-- already answers for the folder a thing's photo lands in.

-- ---------------------------------------------------------------- the table

create type home.thing_kind as enum ('appliance', 'finish', 'fitting', 'fabric', 'contact');

create table home.things (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references home.households(id) on delete cascade,
  property_id uuid not null references home.properties(id) on delete cascade,
  kind home.thing_kind not null,

  -- Capture: what a photograph and four seconds of tapping provide.
  name text check (name is null or length(btrim(name)) between 1 and 80),
  -- TEXT, not a foreign key to home.locations, for exactly the reason
  -- snags.room is: removing a room tag must not rewrite what is filed under it.
  room text check (room is null or length(btrim(room)) between 1 and 60),
  photo_paths text[] not null default '{}',

  -- The three strings somebody else asks you for. `make`/`model` carry the
  -- paint case as readily as the appliance one — Resene / 7BB 83/018 sits in
  -- the same two columns as Bosch / SMS46MI01A, and both are read aloud.
  make text check (make is null or length(btrim(make)) between 1 and 80),
  model text check (model is null or length(btrim(model)) between 1 and 80),
  serial text check (serial is null or length(btrim(serial)) between 1 and 80),

  -- What you re-buy for it: the filter part number, the bulb fitting, the
  -- cartridge. This is what a snag's parts list inherits.
  consumables text[] not null default '{}',

  installed_at date,
  warranty_until date,
  -- Feeds repeat_days on a snag about this thing. Deliberately a plain integer
  -- and not a second scheduling concept: the moment there are two ways to
  -- schedule something in this app, neither of them is trustworthy.
  service_days integer check (service_days is null or service_days between 1 and 3650),

  -- The per-kind tail. Paint: sheen, product, tint, what's left and where.
  -- Object, never an array or a scalar — the client reads it as a string map.
  spec jsonb not null default '{}'::jsonb
    check (jsonb_typeof(spec) = 'object'),

  notes text check (notes is null or length(btrim(notes)) <= 1000),

  created_by uuid not null references home.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references home.profiles(id),

  -- A thing needs a photo, a name or a model number, exactly as a snag needs a
  -- photo or a few words. Anything less is a blank row that makes the record
  -- look filled in when it isn't.
  constraint things_has_something check (
    photo_paths <> '{}'
    or nullif(btrim(coalesce(name, '')), '') is not null
    or nullif(btrim(coalesce(model, '')), '') is not null
  )
);

create index on home.things (property_id, kind);
create index on home.things (property_id, room);

alter table home.things enable row level security;

create policy "members read their things"
  on home.things for select using (home.is_property_member(property_id));

grant select on home.things to authenticated;

-- ---------------------------------------------------------------- the join

-- `on delete set null`, not cascade: replacing the heat pump must not delete
-- the history of everything that was ever wrong with it.
alter table home.snags add column thing_id uuid references home.things(id) on delete set null;

create index on home.snags (thing_id);

-- ---------------------------------------------------------------- views

create view home.things_with_details
with (security_invoker = true)
as
select
  t.*,
  p.name as property_name,
  (select count(*) from home.snags s where s.thing_id = t.id) as snag_count,
  (select count(*) from home.snags s where s.thing_id = t.id and s.status <> 'done')
    as open_snag_count
from home.things t
join home.properties p on p.id = t.property_id;

grant select on home.things_with_details to authenticated;

-- Recreated to carry what the snag is about, so a card can say "the heat pump"
-- without a second read.
drop view home.snags_with_details;

create view home.snags_with_details
with (security_invoker = true)
as
select
  s.*,
  p.name                                        as property_name,
  reporter.display_name                         as reporter_name,
  assignee.display_name                         as assignee_name,
  thing.name                                    as thing_name,
  thing.make                                    as thing_make,
  thing.model                                   as thing_model,
  (select count(*) from home.comments c where c.snag_id = s.id) as comment_count
from home.snags s
join home.properties p       on p.id = s.property_id
join home.profiles reporter  on reporter.id = s.reporter_id
left join home.profiles assignee on assignee.id = s.assignee_id
left join home.things thing      on thing.id = s.thing_id;

grant select on home.snags_with_details to authenticated;

-- ---------------------------------------------------------------- helpers

-- Called only from inside SECURITY DEFINER functions below, which run as the
-- owner — so the caller's EXECUTE is never consulted and stays revoked. Same
-- shape, and same reasoning, as home.snag_property.
create function home.thing_property(p_thing_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select t.property_id from home.things t where t.id = p_thing_id;
$$;

revoke execute on function home.thing_property(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- writes

create function home.create_thing(
  p_property_id uuid,
  p_kind home.thing_kind,
  p_name text default null,
  p_room text default null,
  p_photo_paths text[] default '{}',
  p_make text default null,
  p_model text default null,
  p_serial text default null,
  p_consumables text[] default null,
  p_installed_at date default null,
  p_warranty_until date default null,
  p_service_days integer default null,
  p_spec jsonb default null,
  p_notes text default null
)
returns home.things
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_household_id uuid;
  v_thing home.things;
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_model text := nullif(btrim(coalesce(p_model, '')), '');
  v_photos text[] := coalesce(p_photo_paths, '{}');
begin
  select pr.household_id into v_household_id
  from home.properties pr where pr.id = p_property_id;

  if v_household_id is null then
    raise exception 'No such property';
  end if;

  perform home.require_property_member(p_property_id);

  -- Said in words rather than left to the check constraint, which would
  -- surface as `things_has_something` and mean nothing to anyone.
  if v_photos = '{}' and v_name is null and v_model is null then
    raise exception 'Photograph the label, or give it a name — otherwise there is nothing to find it by';
  end if;

  insert into home.things (
    household_id, property_id, kind, name, room, photo_paths,
    make, model, serial, consumables,
    installed_at, warranty_until, service_days, spec, notes,
    created_by, updated_by
  )
  values (
    v_household_id, p_property_id, p_kind, v_name,
    nullif(btrim(coalesce(p_room, '')), ''),
    v_photos,
    nullif(btrim(coalesce(p_make, '')), ''),
    v_model,
    nullif(btrim(coalesce(p_serial, '')), ''),
    coalesce(p_consumables, '{}'),
    p_installed_at, p_warranty_until, p_service_days,
    coalesce(p_spec, '{}'::jsonb),
    nullif(btrim(coalesce(p_notes, '')), ''),
    auth.uid(), auth.uid()
  )
  returning * into v_thing;

  return v_thing;
end;
$$;

grant execute on function home.create_thing(
  uuid, home.thing_kind, text, text, text[], text, text, text, text[],
  date, date, integer, jsonb, text
) to authenticated;

-- Every control on the spec sheet writes immediately, one field at a time, so
-- this takes one field at a time. `p_clear` names the columns being emptied,
-- because a null argument means "leave it alone" — the same convention
-- update_snag uses, for the same reason.
--
-- `p_spec` merges rather than replaces (`||`), so setting the sheen doesn't
-- drop the tint formula. Clearing a key inside spec is done by naming it as
-- `spec.<key>` in p_clear.
create function home.update_thing(
  p_thing_id uuid,
  p_name text default null,
  p_room text default null,
  p_photo_paths text[] default null,
  p_make text default null,
  p_model text default null,
  p_serial text default null,
  p_consumables text[] default null,
  p_installed_at date default null,
  p_warranty_until date default null,
  p_service_days integer default null,
  p_spec jsonb default null,
  p_notes text default null,
  p_clear text[] default '{}'
)
returns home.things
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_thing home.things;
  v_current home.things;
  v_clear text[] := coalesce(p_clear, '{}');
  v_spec jsonb;
  v_key text;
  v_name text;
  v_model text;
  v_photos text[];
begin
  perform home.require_property_member(home.thing_property(p_thing_id));

  select * into v_current from home.things t where t.id = p_thing_id;

  if v_current.id is null then
    raise exception 'No such thing';
  end if;

  v_spec := v_current.spec;

  if p_spec is not null then
    v_spec := v_spec || p_spec;
  end if;

  foreach v_key in array v_clear loop
    if v_key like 'spec.%' then
      v_spec := v_spec - substring(v_key from 6);
    end if;
  end loop;

  v_name := case when 'name'  = any(v_clear) then null
                 else coalesce(nullif(btrim(coalesce(p_name, '')), ''), v_current.name) end;
  v_model := case when 'model' = any(v_clear) then null
                 else coalesce(nullif(btrim(coalesce(p_model, '')), ''), v_current.model) end;
  v_photos := coalesce(p_photo_paths, v_current.photo_paths);

  -- Worked out and checked BEFORE the write, not after it. A check constraint
  -- is evaluated as the row is written, so a guard sitting after the UPDATE
  -- never runs: `things_has_something` raises first and surfaces its own name,
  -- which means nothing at all to whoever just cleared the last field.
  if v_photos = '{}' and v_name is null and v_model is null then
    raise exception 'Leave it a photo, a name or a model number — otherwise there is no way back to it';
  end if;

  update home.things t set
    name           = v_name,
    model          = v_model,
    photo_paths    = v_photos,
    room           = case when 'room'   = any(v_clear) then null
                          else coalesce(nullif(btrim(coalesce(p_room, '')), ''), t.room) end,
    make           = case when 'make'   = any(v_clear) then null
                          else coalesce(nullif(btrim(coalesce(p_make, '')), ''), t.make) end,
    serial         = case when 'serial' = any(v_clear) then null
                          else coalesce(nullif(btrim(coalesce(p_serial, '')), ''), t.serial) end,
    notes          = case when 'notes'  = any(v_clear) then null
                          else coalesce(nullif(btrim(coalesce(p_notes, '')), ''), t.notes) end,
    installed_at   = case when 'installed_at'   = any(v_clear) then null
                          else coalesce(p_installed_at, t.installed_at) end,
    warranty_until = case when 'warranty_until' = any(v_clear) then null
                          else coalesce(p_warranty_until, t.warranty_until) end,
    service_days   = case when 'service_days'   = any(v_clear) then null
                          else coalesce(p_service_days, t.service_days) end,
    consumables    = coalesce(p_consumables, t.consumables),
    spec           = v_spec,
    updated_at     = now(),
    updated_by     = auth.uid()
  where t.id = p_thing_id
  returning * into v_thing;

  return v_thing;
end;
$$;

grant execute on function home.update_thing(
  uuid, text, text, text[], text, text, text, text[],
  date, date, integer, jsonb, text, text[]
) to authenticated;

create function home.delete_thing(p_thing_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform home.require_property_member(home.thing_property(p_thing_id));

  -- The snags about it survive with thing_id nulled, by the FK. What was wrong
  -- with the old dishwasher is still what was wrong; it just no longer points
  -- at a dishwasher that isn't there.
  delete from home.things where id = p_thing_id;
end;
$$;

grant execute on function home.delete_thing(uuid) to authenticated;

-- ------------------------------------------------------- snags point at them

-- Dropped and recreated rather than replaced: adding a defaulted parameter to
-- an existing function leaves both signatures resolvable and every old-arity
-- call becomes ambiguous.
drop function home.create_snag(uuid, text, text, text[], home.snag_priority);

create function home.create_snag(
  p_property_id uuid,
  p_room text default null,
  p_description text default null,
  p_photo_paths text[] default '{}',
  p_priority home.snag_priority default null,
  p_thing_id uuid default null
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

  -- A thing in a different property would be a snag pointing at something
  -- whoever can see the snag cannot open.
  if p_thing_id is not null and home.thing_property(p_thing_id) is distinct from p_property_id then
    raise exception 'That is not something at this place';
  end if;

  insert into home.snags (
    household_id, property_id, room, description, photo_paths, priority,
    thing_id, reporter_id, updated_by
  )
  values (
    v_household_id, p_property_id,
    nullif(btrim(coalesce(p_room, '')), ''),
    v_description, v_photos, p_priority,
    p_thing_id, auth.uid(), auth.uid()
  )
  returning * into v_snag;

  return v_snag;
end;
$$;

grant execute on function home.create_snag(
  uuid, text, text, text[], home.snag_priority, uuid
) to authenticated;

drop function home.update_snag(
  uuid, text, text, home.snag_priority, timestamptz, integer, uuid, text[], text[], text[]
);

create function home.update_snag(
  p_snag_id uuid,
  p_room text default null,
  p_description text default null,
  p_priority home.snag_priority default null,
  p_due_at timestamptz default null,
  p_repeat_days integer default null,
  p_assignee_id uuid default null,
  p_photo_paths text[] default null,
  p_parts text[] default null,
  p_thing_id uuid default null,
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
  v_started boolean;
begin
  perform home.require_property_member(home.snag_property(p_snag_id));

  if p_assignee_id is not null
     and not exists (
       select 1 from home.property_members m
       where m.property_id = home.snag_property(p_snag_id)
         and m.profile_id = p_assignee_id
     ) then
    raise exception 'That person is not linked to this property';
  end if;

  if p_thing_id is not null
     and home.thing_property(p_thing_id) is distinct from home.snag_property(p_snag_id) then
    raise exception 'That is not something at this place';
  end if;

  -- Deciding to work on something is what starts it, and these are the fields
  -- that say so. Deliberately not room/description/priority — and deliberately
  -- not thing_id either: saying *what* a snag is about is the tail of capture,
  -- the same gesture as tagging the room, and nobody has started anything.
  v_started := p_assignee_id is not null
            or p_due_at is not null
            or p_repeat_days is not null
            or p_parts is not null
            or 'assignee_id' = any(v_clear)
            or 'due_at' = any(v_clear)
            or 'repeat_days' = any(v_clear);

  update home.snags s set
    room         = case when 'room'        = any(v_clear) then null
                        else coalesce(nullif(btrim(coalesce(p_room, '')), ''), s.room) end,
    description  = case when 'description' = any(v_clear) then null
                        else coalesce(nullif(btrim(coalesce(p_description, '')), ''), s.description) end,
    priority     = case when 'priority'    = any(v_clear) then null else coalesce(p_priority, s.priority) end,
    due_at       = case when 'due_at'      = any(v_clear) then null else coalesce(p_due_at, s.due_at) end,
    repeat_days  = case when 'repeat_days' = any(v_clear) then null else coalesce(p_repeat_days, s.repeat_days) end,
    assignee_id  = case when 'assignee_id' = any(v_clear) then null else coalesce(p_assignee_id, s.assignee_id) end,
    thing_id     = case when 'thing_id'    = any(v_clear) then null else coalesce(p_thing_id, s.thing_id) end,
    photo_paths  = coalesce(p_photo_paths, s.photo_paths),
    parts        = coalesce(p_parts, s.parts),
    -- Derived, never set by hand, so the flag and the list cannot disagree.
    needs_parts  = coalesce(p_parts, s.parts) <> '{}',
    status       = case when s.status = 'open' and v_started then 'doing' else s.status end,
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

grant execute on function home.update_snag(
  uuid, text, text, home.snag_priority, timestamptz, integer, uuid, text[], text[], uuid, text[]
) to authenticated;

-- Note what is deliberately absent: nothing here copies a thing's consumables
-- onto a snag's parts list. The client offers them as taps, because filling
-- the parts list is what moves a snag to 'doing' — a job silently starting
-- itself because somebody said which appliance it was about would empty the
-- status of meaning from the same end the Start button did.
