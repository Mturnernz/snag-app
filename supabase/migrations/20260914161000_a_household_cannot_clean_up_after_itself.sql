-- A household cannot clean up after itself.
--
-- `20260914160000` had `delete_household` hand back the storage keys its
-- cascade orphaned, the same contract as `delete_property`, so the client could
-- clear them through the Storage API. For a property that works. For a
-- household it cannot, and the reason is the storage policy:
--
--   using (bucket_id = 'home-photos' and home.can_use_photo_folder(name))
--
-- `can_use_photo_folder` reads the first path segment as a household id and
-- answers `home.is_member(...)`. Deleting a property leaves your membership
-- intact, so the delete that follows is allowed. Deleting a *household* removes
-- the very row that permission is read from — so by the time the client holds
-- the keys, every one of them is refused, and the one path that orphans the
-- most files orphans all of them. Silently, because `deleteStoredFiles`
-- deliberately never throws: the rows are already gone by then and failing the
-- delete somebody just confirmed would be worse.
--
-- So the order inverts: read the keys, clear the files while you are still a
-- member, then delete the household. If the delete then fails you are left with
-- rows pointing at files that aren't there, which is the recoverable direction
-- and the case SNAG_INFRA_NOTES.md's audit query already covers by flipping its
-- `not exists`. The other direction is bytes nobody can reach again.

-- The read half, granted this time: the client calls it *before* the delete.
create function home.household_file_paths(p_household_id uuid)
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_paths text[] := '{}';
  v_property uuid;
begin
  perform home.require_member(p_household_id);

  for v_property in
    select id from home.properties where household_id = p_household_id
  loop
    v_paths := v_paths || home.property_file_paths(v_property);
  end loop;

  return v_paths;
end;
$$;

grant execute on function home.household_file_paths(uuid) to authenticated;

-- Returns void now. Handing back keys the caller can no longer act on is worse
-- than handing back nothing: it reads like the files were dealt with.
drop function home.delete_household(uuid);

create function home.delete_household(p_household_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform home.require_member(p_household_id);

  if (select count(*) from home.household_members where household_id = p_household_id) > 1 then
    raise exception 'Someone else is in this household — leave it instead of deleting it';
  end if;

  delete from home.households where id = p_household_id;
end;
$$;

grant execute on function home.delete_household(uuid) to authenticated;
