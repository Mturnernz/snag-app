-- A servicing regime creates a job that is due later, not one that has started.
--
-- The thing page now has a *Schedule service* modal: pick a cycle, name who
-- does it, and the recurring job goes on the list. The obvious way to build
-- that is `create_snag` followed by `update_snag` with the date and the repeat
-- — and it is wrong, for a reason the schema is already explicit about.
--
-- **Setting a due date or a repeat is one of the four things that start a job.**
-- `update_snag`'s `v_started` moves a snag to 'doing' when the assignee, the due
-- date, the repeat or the parts list is set, because doing something about a
-- snag is the evidence it has started and no client can be trusted to remember.
-- That rule is right, and it makes the two-call version produce a heat pump
-- service marked *Doing* for the six months before anybody touches it — which
-- empties the status of meaning from exactly the end the retired *Start it*
-- button emptied it from.
--
-- So the date arrives with the row instead. Creating a snag is not "doing
-- something about" it, whatever it is created holding: a job filed on Monday as
-- due in March is a job nobody has started. One call, one row, and `v_started`
-- never runs.
--
-- This does not open a second way to schedule anything. It is the same
-- `due_at` + `repeat_days` pair, set through the same table, rolled forward by
-- the same `set_snag_status`. The compose bar does not pass either and never
-- will — capture asks nothing before it files.
--
-- Adding parameters means drop and recreate: `create or replace` would leave
-- both signatures resolvable and a six-argument call would still bind to the
-- old one. The drop takes the grant with it, so it is re-issued in full.

drop function if exists home.create_snag(
  uuid, text, text, text[], home.snag_priority, uuid
);

create function home.create_snag(
  p_property_id uuid,
  p_room text default null,
  p_description text default null,
  p_photo_paths text[] default '{}',
  p_priority home.snag_priority default null,
  p_thing_id uuid default null,
  p_due_at timestamptz default null,
  p_repeat_days integer default null
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

  -- A repeat with no date on it never surfaces: nothing is due, so nothing
  -- comes round. `update_snag` makes the same call for the same reason.
  if p_repeat_days is not null and p_repeat_days <= 0 then
    raise exception 'A cycle has to be a number of days';
  end if;
  if p_repeat_days is not null and p_due_at is null then
    raise exception 'A job that comes round needs a first date';
  end if;

  insert into home.snags (
    household_id, property_id, room, description, photo_paths, priority,
    thing_id, due_at, repeat_days, reporter_id, updated_by
  )
  values (
    v_household_id, p_property_id,
    nullif(btrim(coalesce(p_room, '')), ''),
    v_description, v_photos, p_priority,
    p_thing_id, p_due_at, p_repeat_days, auth.uid(), auth.uid()
  )
  returning * into v_snag;

  return v_snag;
end;
$$;

grant execute on function home.create_snag(
  uuid, text, text, text[], home.snag_priority, uuid, timestamptz, integer
) to authenticated;
