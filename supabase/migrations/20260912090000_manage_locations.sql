-- Let a household add and remove its own location tags.
--
-- The seeded twelve were always meant to be a starting point rather than the
-- whole vocabulary -- a bach needs a boatshed, a villa needs a sleepout, and
-- `Elsewhere` was the escape hatch standing in for this. Profile -> Location
-- tags is the screen that calls these.
--
-- Removing a tag does NOT touch the snags filed under it. `snags.room` is TEXT
-- rather than a foreign key precisely so that history survives: a snag logged
-- in the Sleepout still says Sleepout after the tag is retired, and the list
-- still filters on it. What removal changes is only what capture offers next
-- time.

create function home.create_location(p_property_id uuid, p_name text)
returns home.locations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := btrim(p_name);
  v_location home.locations;
begin
  perform home.require_property_member(p_property_id);

  if v_name = '' then
    raise exception 'Give the tag a name';
  end if;

  -- Said in words: the unique index would otherwise surface as
  -- `locations_unique_per_property`, which means nothing to anyone.
  if exists (
    select 1 from home.locations l
    where l.property_id = p_property_id and lower(l.name) = lower(v_name)
  ) then
    raise exception '% is already a tag here', v_name;
  end if;

  insert into home.locations (property_id, name, sort_order)
  values (
    p_property_id,
    v_name,
    -- After everything that exists, so the seeded order stays intact and a new
    -- tag lands at the end of the chips rather than in the middle of them.
    coalesce((select max(sort_order) from home.locations where property_id = p_property_id), 0) + 1
  )
  returning * into v_location;

  return v_location;
end;
$$;

create function home.delete_location(p_location_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_property_id uuid;
begin
  select property_id into v_property_id from home.locations where id = p_location_id;

  if v_property_id is null then
    raise exception 'No such tag';
  end if;

  perform home.require_property_member(v_property_id);

  delete from home.locations where id = p_location_id;
end;
$$;

grant execute on function home.create_location(uuid, text) to authenticated;
grant execute on function home.delete_location(uuid)       to authenticated;
