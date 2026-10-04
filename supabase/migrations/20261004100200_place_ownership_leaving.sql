-- Place ownership, part 3 of 11. Why: 20261004100000_place_ownership_roles.sql.
-- Split into small files so each can be applied and approved on its own.

-- ---------------------------------------------------------------- leaving
--
-- What happens when somebody leaves a household, by any door: remove_member,
-- unlink_property_member taking them off their last place, delete_my_account,
-- and a login deleted from the dashboard. One body, so the four cannot come to
-- disagree. No check on the caller: every door checks before it calls.
--
-- p_keeper is who inherits a place nobody is left on. Null means the
-- household's owner, or failing that whoever has been in it longest.

create function home.leave_household_as(p_household_id uuid, p_profile_id uuid, p_keeper uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_place uuid;
  v_heir uuid;
  v_keeper uuid := p_keeper;
begin
  -- An assignee who cannot see the place is a job that silently never gets done.
  update home.snags set assignee_id = null, updated_at = now()
  where household_id = p_household_id and assignee_id = p_profile_id;

  -- A place they owned alone, that somebody else is on: the longest-linked of
  -- the others owns it now. Handed on, never deleted.
  for v_place in
    select pm.property_id
    from home.property_members pm
    join home.properties p on p.id = pm.property_id
    where p.household_id = p_household_id
      and pm.profile_id = p_profile_id
      and pm.role = 'owner'
      and not exists (
        select 1 from home.property_members o
        where o.property_id = pm.property_id
          and o.role = 'owner'
          and o.profile_id <> p_profile_id
      )
  loop
    update home.property_members
    set role = 'owner'
    where property_id = v_place
      and profile_id = (
        select o.profile_id from home.property_members o
        where o.property_id = v_place and o.profile_id <> p_profile_id
        order by o.created_at, o.profile_id
        limit 1
      );
  end loop;

  delete from home.property_members pm
  using home.properties p
  where pm.property_id = p.id
    and p.household_id = p_household_id
    and pm.profile_id = p_profile_id;

  -- The household's owner, if they were it and nobody else is: somebody who
  -- owns a place in it first, because that is somebody already trusted with
  -- one; then whoever has been in it longest.
  if home.is_household_owner_profile(p_household_id, p_profile_id)
     and not exists (
       select 1 from home.household_members o
       where o.household_id = p_household_id
         and o.profile_id <> p_profile_id
         and o.role = 'owner'
     ) then
    select m.profile_id into v_heir
    from home.household_members m
    where m.household_id = p_household_id and m.profile_id <> p_profile_id
    order by
      exists (
        select 1 from home.property_members pm
        join home.properties p on p.id = pm.property_id
        where p.household_id = p_household_id
          and pm.profile_id = m.profile_id
          and pm.role = 'owner'
      ) desc,
      m.created_at, m.profile_id
    limit 1;

    if v_heir is not null then
      update home.household_members set role = 'owner'
      where household_id = p_household_id and profile_id = v_heir;
    end if;
  end if;

  if v_keeper is null or v_keeper = p_profile_id then
    select m.profile_id into v_keeper
    from home.household_members m
    where m.household_id = p_household_id and m.profile_id <> p_profile_id
    order by (m.role = 'owner') desc, m.created_at, m.profile_id
    limit 1;
  end if;

  -- A place nobody is on now is invisible to everyone. Somebody inherits it,
  -- as its owner.
  if v_keeper is not null then
    for v_place in
      select p.id from home.properties p
      where p.household_id = p_household_id
        and not exists (select 1 from home.property_members pm where pm.property_id = p.id)
    loop
      insert into home.property_members (property_id, profile_id, role)
      values (v_place, v_keeper, 'owner')
      on conflict (property_id, profile_id) do update set role = 'owner';
    end loop;
  end if;

  delete from home.household_members
  where household_id = p_household_id and profile_id = p_profile_id;
end;
$$;

revoke execute on function home.leave_household_as(uuid, uuid, uuid) from public, anon, authenticated;
