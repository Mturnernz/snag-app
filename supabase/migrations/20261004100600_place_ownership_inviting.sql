-- Place ownership, part 7 of 11. Why: 20261004100000_place_ownership_roles.sql.
-- Split into small files so each can be applied and approved on its own.

-- ---------------------------------------------------------------- invitations

-- A member sees an invitation only to a place they are on. The household-wide
-- read let somebody let into the bach read who had been asked to the house.
drop policy "members read their invitations" on home.invitations;
create policy "members read their invitations"
  on home.invitations for select using (
    home.is_member(household_id)
    and exists (
      select 1 from unnest(property_ids) pid where home.is_property_member(pid)
    )
  );

-- An invitation always names its places now. One addressed to "every place"
-- is pinned to the places there are today, so accepting it means what it meant
-- when it was written rather than whatever the household holds later.
update home.invitations i
set property_ids = (
  select coalesce(array_agg(p.id order by p.id), '{}')
  from home.properties p where p.household_id = i.household_id
)
where i.property_ids = '{}';

-- One live link per set of places, rather than per household: sharing Martin's
-- Bay must not kill the link somebody was sent for the house.
drop index home.invitations_one_link_per_household;
create unique index invitations_one_link_per_places
  on home.invitations (household_id, property_ids) where token is not null;

create or replace function home.invite_to_household(
  p_household_id uuid,
  p_email text,
  p_property_ids uuid[] default null
)
returns home.invitations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(p_email));
  v_user_id uuid;
  v_places uuid[];
  v_invitation home.invitations;
begin
  perform home.require_member(p_household_id);

  v_places := home.invitable_places(p_household_id, p_property_ids);

  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'That does not look like an email address';
  end if;

  if v_email = home.my_email() then
    raise exception 'That is your own address';
  end if;

  select u.id into v_user_id from auth.users u where lower(btrim(u.email)) = v_email;
  if v_user_id is not null and home.is_member_profile(p_household_id, v_user_id) then
    raise exception 'They are already in this household — add them to the place from its people';
  end if;

  insert into home.invitations (household_id, email, property_ids, invited_by)
  values (p_household_id, v_email, v_places, auth.uid())
  on conflict (household_id, email) do update
    set property_ids = excluded.property_ids,
        invited_by   = excluded.invited_by,
        created_at   = now()
  returning * into v_invitation;

  return v_invitation;
end;
$$;

revoke execute on function home.invite_to_household(uuid, text, uuid[]) from public, anon;
grant execute on function home.invite_to_household(uuid, text, uuid[]) to authenticated;

-- Whoever sent it, or an owner of every place it names.
create or replace function home.cancel_invitation(p_invitation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invitation home.invitations;
begin
  select * into v_invitation from home.invitations where id = p_invitation_id;

  if v_invitation.id is null then
    return;
  end if;

  perform home.require_member(v_invitation.household_id);

  if v_invitation.invited_by is distinct from auth.uid()
     and exists (
       select 1 from unnest(v_invitation.property_ids) x
       where not home.is_property_owner_profile(x, auth.uid())
     ) then
    raise exception 'Only the owner of the place can cancel that';
  end if;

  delete from home.invitations where id = p_invitation_id;
end;
$$;

revoke execute on function home.cancel_invitation(uuid) from public, anon;
grant execute on function home.cancel_invitation(uuid) to authenticated;

create or replace function home.create_invite_link(
  p_household_id uuid,
  p_property_ids uuid[] default null,
  p_hours integer default 24
)
returns home.invitations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_places uuid[];
  v_invitation home.invitations;
begin
  perform home.require_member(p_household_id);

  v_places := home.invitable_places(p_household_id, p_property_ids);

  if p_hours is null or p_hours < 1 or p_hours > 168 then
    raise exception 'A code can last between an hour and a week';
  end if;

  delete from home.invitations
  where household_id = p_household_id
    and token is not null
    and property_ids = v_places;

  insert into home.invitations (household_id, email, token, property_ids, invited_by, expires_at)
  values (
    p_household_id, null, gen_random_uuid(), v_places, auth.uid(),
    now() + make_interval(hours => p_hours)
  )
  returning * into v_invitation;

  return v_invitation;
end;
$$;

revoke execute on function home.create_invite_link(uuid, uuid[], integer) from public, anon;
grant execute on function home.create_invite_link(uuid, uuid[], integer) to authenticated;
