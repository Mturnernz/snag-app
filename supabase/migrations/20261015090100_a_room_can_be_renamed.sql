-- A room can be renamed, and the rename reaches everything filed under it.
--
-- Rooms could be added from the House tab and never corrected once setup was
-- over: the Location tags screen went in d1b398d, and with it the only way to
-- remove one. The October 2026 function review found one place with 27 rooms.
-- Removal needs nothing new (`home.delete_location` is still here, and the
-- room's page now calls it). Renaming does.
--
-- **This is why there was deliberately no rename before.** `snags.room`,
-- `things.room` and the rest are TEXT, so history survives a tag being
-- removed, and renaming only the tag would have left every job and thing filed
-- under the old name saying the old name -- two names for one room. So this
-- renames the tag *and* every row at this place that names it, in one call:
-- the jobs, the house record, what this house hasn't got, and the parts of a
-- renovation. Afterwards nothing says the old name, which is what a rename is.
--
-- Not a job-starter: it writes `room` and nothing else, the column
-- `update_snag` deliberately excludes from `v_started`, and it leaves
-- `updated_at` alone because nobody did anything to the jobs themselves.

create function home.rename_location(p_location_id uuid, p_name text)
returns home.locations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_location home.locations;
  v_old text;
  v_new text := btrim(coalesce(p_name, ''));
begin
  select * into v_location from home.locations where id = p_location_id;
  if v_location.id is null then
    raise exception 'That room has gone';
  end if;

  perform home.require_property_member(v_location.property_id);

  v_old := v_location.name;

  if v_new = '' then
    raise exception 'Give the room a name';
  end if;
  if length(v_new) > 40 then
    raise exception 'That name is too long — 40 letters at most';
  end if;
  if v_new = v_old then
    return v_location;
  end if;

  -- Said in words, as `create_location` does. A change of case alone is a
  -- rename of this room, not a clash with it.
  if exists (
    select 1 from home.locations l
    where l.property_id = v_location.property_id
      and lower(l.name) = lower(v_new)
      and l.id <> p_location_id
  ) then
    raise exception '% is already a room here', v_new;
  end if;

  update home.locations set name = v_new where id = p_location_id
  returning * into v_location;

  update home.snags set room = v_new
  where property_id = v_location.property_id and room = v_old;

  update home.things set room = v_new
  where property_id = v_location.property_id and room = v_old;

  -- Its primary key is (property_id, room, name): a "not here" left under the
  -- new name by a room removed earlier would collide, and the one being renamed
  -- is the current answer.
  delete from home.absent_things a
  where a.property_id = v_location.property_id and a.room = v_new
    and exists (
      select 1 from home.absent_things b
      where b.property_id = a.property_id and b.room = v_old and b.name = a.name
    );
  update home.absent_things set room = v_new
  where property_id = v_location.property_id and room = v_old;

  update home.project_elements e set room = v_new
  from home.projects p
  where e.project_id = p.id and p.property_id = v_location.property_id and e.room = v_old;

  return v_location;
end;
$$;

revoke execute on function home.rename_location(uuid, text) from public, anon;
grant execute on function home.rename_location(uuid, text) to authenticated;

notify pgrst, 'reload schema';
