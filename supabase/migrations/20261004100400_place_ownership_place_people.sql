-- Place ownership, part 5 of 11. Why: 20261004100000_place_ownership_roles.sql.
-- Split into small files so each can be applied and approved on its own.

-- ---------------------------------------------------------------- a place's people

-- Only a place's owner puts somebody on it, and they arrive as a member.
create or replace function home.link_property_member(p_property_id uuid, p_profile_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_household_id uuid;
begin
  perform home.require_property_member(p_property_id);

  if not home.is_property_owner_profile(p_property_id, auth.uid()) then
    raise exception 'Only the owner of this place can add somebody to it';
  end if;

  select household_id into v_household_id from home.properties where id = p_property_id;

  if not home.is_member_profile(v_household_id, p_profile_id) then
    raise exception 'That person is not in this household';
  end if;

  insert into home.property_members (property_id, profile_id, role)
  values (p_property_id, p_profile_id, 'member')
  on conflict do nothing;
end;
$$;

revoke execute on function home.link_property_member(uuid, uuid) from public, anon;
grant execute on function home.link_property_member(uuid, uuid) to authenticated;

-- Taking somebody off a place, or leaving it yourself.
--
-- Anybody can leave. Only the place's owner can take somebody else off it. And
-- nothing leaves a place without an owner — the last owner hands it over first,
-- which is what stops a place becoming one nobody can manage.
--
-- Somebody left on no place in the household has left the household too: a
-- membership with nothing to see is the account that reads as empty.
create or replace function home.unlink_property_member(p_property_id uuid, p_profile_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_place home.properties;
begin
  perform home.require_property_member(p_property_id);

  select * into v_place from home.properties where id = p_property_id;

  if p_profile_id is distinct from auth.uid()
     and not home.is_property_owner_profile(p_property_id, auth.uid()) then
    raise exception 'Only the owner of % can take somebody off it', v_place.name;
  end if;

  if not exists (
    select 1 from home.property_members
    where property_id = p_property_id and profile_id = p_profile_id
  ) then
    return;
  end if;

  if (select count(*) from home.property_members where property_id = p_property_id) <= 1 then
    raise exception 'Someone has to stay on %, or nobody can see it again', v_place.name;
  end if;

  if home.is_property_owner_profile(p_property_id, p_profile_id)
     and not exists (
       select 1 from home.property_members o
       where o.property_id = p_property_id
         and o.role = 'owner'
         and o.profile_id <> p_profile_id
     ) then
    raise exception 'Hand % to somebody else first — it can''t be left without an owner', v_place.name;
  end if;

  update home.snags set assignee_id = null, updated_at = now()
  where property_id = p_property_id and assignee_id = p_profile_id;

  delete from home.property_members
  where property_id = p_property_id and profile_id = p_profile_id;

  if not exists (
    select 1 from home.property_members pm
    join home.properties p on p.id = pm.property_id
    where p.household_id = v_place.household_id and pm.profile_id = p_profile_id
  ) and (
    select count(*) from home.household_members where household_id = v_place.household_id
  ) > 1 then
    perform home.leave_household_as(v_place.household_id, p_profile_id, null);
  end if;
end;
$$;

revoke execute on function home.unlink_property_member(uuid, uuid) from public, anon;
grant execute on function home.unlink_property_member(uuid, uuid) to authenticated;

-- Making somebody an owner of a place. They must already be on it. A place can
-- have more than one owner; p_step_down hands it over outright.
create function home.transfer_property_ownership(
  p_property_id uuid,
  p_profile_id uuid,
  p_step_down boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform home.require_property_member(p_property_id);

  if not home.is_property_owner_profile(p_property_id, auth.uid()) then
    raise exception 'Only an owner of this place can hand it on';
  end if;

  if not exists (
    select 1 from home.property_members
    where property_id = p_property_id and profile_id = p_profile_id
  ) then
    raise exception 'They have to be on this place before they can own it';
  end if;

  update home.property_members set role = 'owner'
  where property_id = p_property_id and profile_id = p_profile_id;

  if coalesce(p_step_down, false) and p_profile_id is distinct from auth.uid() then
    update home.property_members set role = 'member'
    where property_id = p_property_id and profile_id = auth.uid();
  end if;
end;
$$;

revoke execute on function home.transfer_property_ownership(uuid, uuid, boolean) from public, anon;
grant execute on function home.transfer_property_ownership(uuid, uuid, boolean) to authenticated;
