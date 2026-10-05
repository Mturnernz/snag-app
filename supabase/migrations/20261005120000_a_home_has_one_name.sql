-- A home is a household.
--
-- The bach was a second place inside the house's household, and that is how
-- Leonie, let into Martins Bay alone, came to be a member of a household called
-- 32 Le Roy — reading its name on every tab, and able to reach every file in
-- its storage folder, since storage asks `home.is_member` of the folder's
-- household. By the owner's decision a household is one home now, and one
-- person can be in several. 20261005120100 moves Martins Bay out.
--
-- Two functions follow from it.

-- No second place in a household. Another home is another household
-- (`create_household`), so only people invited to it see it.
create or replace function home.create_property(p_household_id uuid, p_name text)
returns home.properties
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform home.require_member(p_household_id);
  raise exception 'A household is one home — add another home instead';
end;
$$;

revoke execute on function home.create_property(uuid, text) from public, anon;
grant execute on function home.create_property(uuid, text) to authenticated;

-- One name for both. The tabs name the place and the Household screen, the You
-- tab and the exports name the household; renaming one without the other is
-- two names for one home. Only while the household has one place, so a
-- household that still holds two keeps its own name.
create or replace function home.rename_property(p_property_id uuid, p_name text)
returns home.properties
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_property home.properties;
begin
  perform home.require_property_member(p_property_id);

  update home.properties set name = btrim(p_name)
  where id = p_property_id
  returning * into v_property;

  update home.households h set name = v_property.name
  where h.id = v_property.household_id
    and (select count(*) from home.properties p where p.household_id = h.id) = 1;

  return v_property;
end;
$$;

revoke execute on function home.rename_property(uuid, text) from public, anon;
grant execute on function home.rename_property(uuid, text) to authenticated;
