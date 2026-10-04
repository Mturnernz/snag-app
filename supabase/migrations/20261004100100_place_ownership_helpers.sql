-- Place ownership, part 2 of 11. Why: 20261004100000_place_ownership_roles.sql.
-- Split into small files so each can be applied and approved on its own.

-- ---------------------------------------------------------------- helpers
--
-- Only ever called from inside SECURITY DEFINER functions here, so they stay
-- revoked: the caller's EXECUTE is never consulted.

create function home.is_property_owner_profile(p_property_id uuid, p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from home.property_members m
    where m.property_id = p_property_id
      and m.profile_id = p_profile_id
      and m.role = 'owner'
  );
$$;

revoke execute on function home.is_property_owner_profile(uuid, uuid) from public, anon, authenticated;

create function home.is_household_owner_profile(p_household_id uuid, p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from home.household_members m
    where m.household_id = p_household_id
      and m.profile_id = p_profile_id
      and m.role = 'owner'
  );
$$;

revoke execute on function home.is_household_owner_profile(uuid, uuid) from public, anon, authenticated;

-- Which places an invitation from the caller names. Null or empty means every
-- place the caller owns in that household — never every place in it, which is
-- how a joiner used to arrive on a place nobody had chosen. Sorted and
-- de-duplicated, so the one-live-link index below compares like with like.
create function home.invitable_places(p_household_id uuid, p_property_ids uuid[])
returns uuid[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_places uuid[];
begin
  if p_property_ids is null or cardinality(p_property_ids) = 0 then
    select coalesce(array_agg(pm.property_id order by pm.property_id), '{}')
    into v_places
    from home.property_members pm
    join home.properties p on p.id = pm.property_id
    where p.household_id = p_household_id
      and pm.profile_id = auth.uid()
      and pm.role = 'owner';
  else
    select coalesce(array_agg(distinct x order by x), '{}')
    into v_places
    from unnest(p_property_ids) x;
  end if;

  if cardinality(v_places) = 0 then
    raise exception 'Only the owner of a place can invite somebody to it';
  end if;

  if exists (
    select 1 from unnest(v_places) x
    where not exists (
      select 1 from home.properties p
      where p.id = x and p.household_id = p_household_id
    )
    or not home.is_property_owner_profile(x, auth.uid())
  ) then
    raise exception 'Only the owner of a place can invite somebody to it';
  end if;

  return v_places;
end;
$$;

revoke execute on function home.invitable_places(uuid, uuid[]) from public, anon, authenticated;
