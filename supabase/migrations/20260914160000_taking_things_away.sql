-- Taking things away: a member, a place, a household.
--
-- Eleven migrations built this schema and not one of them could remove
-- anybody from anything. `add_member_by_email` was a one-way door, a property
-- could be created and never deleted, and a household could not be left at
-- all. The last of those is the sharp one, because `getMyHousehold` reads the
-- households RLS lets you see and takes one: somebody who taps "Create it"
-- instead of "Someone else set ours up" on the Setup screen owns an empty
-- household they can never get out of, with no error anywhere to explain it.
--
-- Three functions, all SECURITY DEFINER like every other write here, and each
-- one refusing the case that would leave a row nobody can reach.

-- ---------------------------------------------------------------- helpers

-- Every storage key a property owns, photos and paperwork together.
--
-- Deleting a property cascades its snags and things away, and the bytes those
-- rows pointed at stay in the bucket with nothing left to reach them. SQL
-- cannot clear them up: storage.protect_delete() raises 42501 on a direct
-- delete of a storage.objects row, and that guard is right: removing the row
-- leaves the bytes in the backing store, which is a worse orphan than the one
-- you started with. So the delete functions below hand the keys back and the
-- client removes them through the Storage API, with a session that passes
-- home.can_use_photo_folder. See SNAG_INFRA_NOTES.md.
create function home.property_file_paths(p_property_id uuid)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct path), '{}')
  from (
    select unnest(s.photo_paths) as path
    from home.snags s where s.property_id = p_property_id
    union all
    select unnest(t.photo_paths)
    from home.things t where t.property_id = p_property_id
    union all
    select unnest(t.document_paths)
    from home.things t where t.property_id = p_property_id
  ) keys
  where nullif(btrim(path), '') is not null;
$$;

revoke execute on function home.property_file_paths(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- a member

-- Removing somebody, and leaving yourself: deliberately one function.
--
-- For two people in a house those are the same act seen from two ends, and
-- there are no roles here to make one of them a privilege -- everyone linked
-- to a place can do everything at that place, which is the only permission
-- this product has.
--
-- The profile row is left alone. It belongs to the account, not to this
-- household, so `reporter_id` still resolves and a snag filed by somebody who
-- has since left still says who filed it.
create function home.remove_member(p_household_id uuid, p_profile_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_orphan uuid;
  v_keeper uuid;
begin
  perform home.require_member(p_household_id);

  if not home.is_member_profile(p_household_id, p_profile_id) then
    raise exception 'They are not in this household';
  end if;

  -- The same refusal as unlink_property_member, for the same reason: a
  -- household nobody is in is invisible to everyone, including whoever would
  -- need to add somebody back to it. The way out of the last place is
  -- delete_household, which says so.
  if (select count(*) from home.household_members where household_id = p_household_id) <= 1 then
    raise exception 'You are the only one here — delete the household instead';
  end if;

  -- An assignee who cannot see the place is a job that silently never gets
  -- done. update_snag already refuses to create that state; removing somebody
  -- must not create it either.
  update home.snags set assignee_id = null, updated_at = now()
  where household_id = p_household_id and assignee_id = p_profile_id;

  delete from home.property_members pm
  using home.properties p
  where pm.property_id = p.id
    and p.household_id = p_household_id
    and pm.profile_id = p_profile_id;

  -- A property they were the only person on is now a property nobody is on,
  -- which is the invisible-row case again -- and refusing instead would be a
  -- dead end, because you cannot link somebody to a place you can no longer
  -- see. So somebody inherits it: the caller, unless the caller is the one
  -- leaving, in which case whoever has been here longest. There is always
  -- somebody, because the last-member case was refused above.
  v_keeper := case
    when auth.uid() is distinct from p_profile_id then auth.uid()
    else (
      select m.profile_id from home.household_members m
      where m.household_id = p_household_id and m.profile_id <> p_profile_id
      order by m.created_at, m.profile_id
      limit 1
    )
  end;

  for v_orphan in
    select p.id from home.properties p
    where p.household_id = p_household_id
      and not exists (
        select 1 from home.property_members pm where pm.property_id = p.id
      )
  loop
    insert into home.property_members (property_id, profile_id)
    values (v_orphan, v_keeper)
    on conflict do nothing;
  end loop;

  delete from home.household_members
  where household_id = p_household_id and profile_id = p_profile_id;
end;
$$;

-- ---------------------------------------------------------------- a place

-- Returns the storage keys the cascade is about to orphan, so the client can
-- clear them. Everything else goes with the row: locations, snags (and their
-- comments), things, absent_things and property_members all cascade from
-- home.properties.
create function home.delete_property(p_property_id uuid)
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_household_id uuid;
  v_paths text[];
begin
  perform home.require_property_member(p_property_id);

  select household_id into v_household_id
  from home.properties where id = p_property_id;

  -- create_household makes a property in the same breath as the household
  -- because a household with no property cannot receive a snag. Deleting the
  -- last one would undo that invariant from the other end.
  if (select count(*) from home.properties where household_id = v_household_id) <= 1 then
    raise exception 'This is the only place — delete the household instead';
  end if;

  v_paths := home.property_file_paths(p_property_id);

  delete from home.properties where id = p_property_id;

  return v_paths;
end;
$$;

-- ---------------------------------------------------------------- a house

-- The escape hatch for a household created by mistake.
--
-- Refuses while anybody else is in it: at that point the list is somebody
-- else's as much as yours, and the honest move is to take yourself out with
-- remove_member rather than to delete their house.
create function home.delete_household(p_household_id uuid)
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_paths text[] := '{}';
  v_property uuid;
begin
  perform home.require_member(p_household_id);

  if (select count(*) from home.household_members where household_id = p_household_id) > 1 then
    raise exception 'Someone else is in this household — leave it instead of deleting it';
  end if;

  -- Gathered per property rather than per household because the helper reads
  -- property_id, which is the column every file-bearing row actually carries.
  for v_property in
    select id from home.properties where household_id = p_household_id
  loop
    v_paths := v_paths || home.property_file_paths(v_property);
  end loop;

  delete from home.households where id = p_household_id;

  return v_paths;
end;
$$;

-- ---------------------------------------------------------------- grants
--
-- By name, never by sweep. The helper above stays revoked: it is only ever
-- called from inside the two SECURITY DEFINER functions here, where the
-- caller's EXECUTE is never consulted.

grant execute on function home.remove_member(uuid, uuid)  to authenticated;
grant execute on function home.delete_property(uuid)      to authenticated;
grant execute on function home.delete_household(uuid)     to authenticated;
