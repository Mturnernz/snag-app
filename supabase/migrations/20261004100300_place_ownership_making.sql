-- Place ownership, part 4 of 11. Why: 20261004100000_place_ownership_roles.sql.
-- Split into small files so each can be applied and approved on its own.

-- ---------------------------------------------------------------- making

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

  insert into home.property_members (property_id, profile_id, role)
  values (v_property_id, auth.uid(), 'owner');

  perform home.seed_locations(v_property_id);

  return v_household;
end;
$$;

revoke execute on function home.create_household(text, text) from public, anon;
grant execute on function home.create_household(text, text) to authenticated;

-- Anybody in a household can add a place to it, and owns what they add.
create or replace function home.create_property(p_household_id uuid, p_name text)
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

  insert into home.property_members (property_id, profile_id, role)
  values (v_property.id, auth.uid(), 'owner');

  perform home.seed_locations(v_property.id);

  return v_property;
end;
$$;

revoke execute on function home.create_property(uuid, text) from public, anon;
grant execute on function home.create_property(uuid, text) to authenticated;
