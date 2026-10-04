-- Place ownership, part 6 of 11. Why: 20261004100000_place_ownership_roles.sql.
-- Split into small files so each can be applied and approved on its own.

-- ---------------------------------------------------------------- a member

-- Anybody can leave. Only the household's owner can take somebody else out,
-- and never another owner — they leave on their own.
create or replace function home.remove_member(p_household_id uuid, p_profile_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform home.require_member(p_household_id);

  if not home.is_member_profile(p_household_id, p_profile_id) then
    raise exception 'They are not in this household';
  end if;

  if p_profile_id is distinct from auth.uid() then
    if not home.is_household_owner_profile(p_household_id, auth.uid()) then
      raise exception 'Only the owner of this household can take somebody out of it';
    end if;
    if home.is_household_owner_profile(p_household_id, p_profile_id) then
      raise exception 'They own this household too — only they can leave it';
    end if;
  end if;

  if (select count(*) from home.household_members where household_id = p_household_id) <= 1 then
    raise exception 'You are the only one here — delete the household instead';
  end if;

  perform home.leave_household_as(
    p_household_id,
    p_profile_id,
    case when p_profile_id is distinct from auth.uid() then auth.uid() end
  );
end;
$$;

revoke execute on function home.remove_member(uuid, uuid) from public, anon;
grant execute on function home.remove_member(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------- deleting

create or replace function home.delete_property(p_property_id uuid)
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

  if not home.is_property_owner_profile(p_property_id, auth.uid()) then
    raise exception 'Only the owner of this place can delete it';
  end if;

  select household_id into v_household_id
  from home.properties where id = p_property_id;

  if (select count(*) from home.properties where household_id = v_household_id) <= 1 then
    raise exception 'This is the only place — delete the household instead';
  end if;

  v_paths := home.property_file_paths(p_property_id);

  delete from home.properties where id = p_property_id;

  return v_paths;
end;
$$;

revoke execute on function home.delete_property(uuid) from public, anon;
grant execute on function home.delete_property(uuid) to authenticated;

create or replace function home.delete_household(p_household_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform home.require_member(p_household_id);

  if not home.is_household_owner_profile(p_household_id, auth.uid()) then
    raise exception 'Only the owner of this household can delete it';
  end if;

  if (select count(*) from home.household_members where household_id = p_household_id) > 1 then
    raise exception 'Someone else is in this household — leave it instead of deleting it';
  end if;

  delete from home.households where id = p_household_id;
end;
$$;

revoke execute on function home.delete_household(uuid) from public, anon;
grant execute on function home.delete_household(uuid) to authenticated;
