-- A place has an owner, and only its owner can take it away from anybody.
--
-- On 4 October 2026 one joiner removed a household. The chain was four calls,
-- every one of them allowed:
--
--   1. accept_invitation made the joiner `owner`. Every joiner was an owner,
--      because household_members.role was never read and defaulted to owner.
--   2. remove_member, twice. Any member could remove any other member: the two
--      people who had built the household were taken out of it.
--   3. delete_my_account. The joiner was now the only member, and a household
--      somebody is alone in "goes with them". Both places and every job went.
--
-- And the joiner had only ever been shown the household's name, never the
-- name of the place they were being let into.
--
-- The fix is roles, **per place**, by the owner's decision. Mike owns 32 Le Roy
-- and Martin's Bay; he lets Leonie into Martin's Bay as a member and can hand
-- her ownership of it. She then sees only Martin's Bay, and can take Mike off
-- it, or he can leave it. Nothing she does can touch 32 Le Roy.
--
-- * `property_members.role` (owner | member). A place always has an owner.
-- * `household_members.role` is read at last: the household's owner is who made
--   it. A joiner is a member of the household, never its owner.
-- * Removing somebody else needs ownership: of the place (unlink_property_member)
--   or of the household (remove_member). Anybody can leave.
-- * Nothing leaves a place without an owner: hand it over first.
-- * Deleting a place or a household needs ownership of it.
-- * Deleting your account deletes only a household you own and are alone in.
--   A place you own and share is handed on.
-- * Invitations name places, and only a place's owner can invite to it.
--
-- Moving a place into another household is not here. Once Mike leaves Martin's
-- Bay it still sits in his household's row; nobody can see that from the app,
-- and it is a later step.

-- ---------------------------------------------------------------- the column

alter table home.property_members
  add column role home.member_role not null default 'member';

-- A joiner was an owner by default. The default is what a forgotten column in
-- an insert falls back to, so it is the safe answer now.
alter table home.household_members alter column role set default 'member';

-- Whoever has been on a place longest made it: create_household and
-- create_property link the creator in the same breath as the row.
update home.property_members pm
set role = 'owner'
where (pm.property_id, pm.profile_id) in (
  select distinct on (x.property_id) x.property_id, x.profile_id
  from home.property_members x
  order by x.property_id, x.created_at, x.profile_id
);

-- The same for a household: its earliest member made it, and everybody who
-- joined after is a member.
update home.household_members hm
set role = case
  when (hm.household_id, hm.profile_id) in (
    select distinct on (x.household_id) x.household_id, x.profile_id
    from home.household_members x
    order by x.household_id, x.created_at, x.profile_id
  ) then 'owner'::home.member_role
  else 'member'::home.member_role
end;

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

-- Stops every live link to a place the caller owns.
create or replace function home.revoke_invite_link(p_household_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform home.require_member(p_household_id);

  delete from home.invitations i
  where i.household_id = p_household_id
    and i.token is not null
    and not exists (
      select 1 from unnest(i.property_ids) x
      where not home.is_property_owner_profile(x, auth.uid())
    );
end;
$$;

revoke execute on function home.revoke_invite_link(uuid) from public, anon;
grant execute on function home.revoke_invite_link(uuid) to authenticated;

-- What a scanner is being asked to join, by place. Dropped rather than
-- replaced, because the row it returns gains a column.
drop function home.invitation_by_token(uuid);

create function home.invitation_by_token(p_token uuid)
returns table (
  id uuid,
  household_id uuid,
  household_name text,
  invited_by_name text,
  expires_at timestamptz,
  already_a_member boolean,
  property_names text[]
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    i.id, i.household_id, h.name, p.display_name, i.expires_at,
    not exists (
      select 1 from unnest(i.property_ids) x
      where not exists (
        select 1 from home.property_members m
        where m.property_id = x and m.profile_id = auth.uid()
      )
    ),
    array(
      select pr.name from home.properties pr
      where pr.id = any(i.property_ids)
      order by pr.created_at, pr.id
    )
  from home.invitations i
  join home.households h on h.id = i.household_id
  join home.profiles p   on p.id = i.invited_by
  where i.token = p_token
    and i.expires_at > now();
$$;

revoke execute on function home.invitation_by_token(uuid) from public, anon;
grant execute on function home.invitation_by_token(uuid) to authenticated;

drop function home.my_invitations();

create function home.my_invitations()
returns table (
  id uuid,
  household_id uuid,
  household_name text,
  invited_by_name text,
  created_at timestamptz,
  property_names text[]
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    i.id, i.household_id, h.name, p.display_name, i.created_at,
    array(
      select pr.name from home.properties pr
      where pr.id = any(i.property_ids)
      order by pr.created_at, pr.id
    )
  from home.invitations i
  join home.households h on h.id = i.household_id
  join home.profiles p   on p.id = i.invited_by
  where i.email = home.my_email()
    and i.token is null
  order by i.created_at;
$$;

revoke execute on function home.my_invitations() from public, anon;
grant execute on function home.my_invitations() to authenticated;

-- Both doors in. A joiner is a member of the household and of the places the
-- invitation names, never an owner of either, and a role somebody already
-- holds is never rewritten by joining again. Answering one invitation answers
-- every other one addressed to them for that household.
create or replace function home.accept_invitation(p_invitation_id uuid)
returns home.household_members
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invitation home.invitations;
  v_member home.household_members;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  if not exists (select 1 from home.profiles pr where pr.id = auth.uid()) then
    raise exception 'Save your name first';
  end if;

  select * into v_invitation
  from home.invitations
  where id = p_invitation_id and email = home.my_email();

  if v_invitation.id is null then
    raise exception 'That invitation is no longer open';
  end if;

  if not exists (
    select 1 from home.properties p
    where p.household_id = v_invitation.household_id
      and p.id = any(v_invitation.property_ids)
  ) then
    raise exception 'The place you were invited to has gone';
  end if;

  insert into home.household_members (household_id, profile_id, role)
  values (v_invitation.household_id, auth.uid(), 'member')
  on conflict (household_id, profile_id) do nothing;

  select * into v_member from home.household_members
  where household_id = v_invitation.household_id and profile_id = auth.uid();

  insert into home.property_members (property_id, profile_id, role)
  select p.id, auth.uid(), 'member'
  from home.properties p
  where p.household_id = v_invitation.household_id
    and p.id = any(v_invitation.property_ids)
  on conflict do nothing;

  delete from home.invitations
  where household_id = v_invitation.household_id
    and email = home.my_email();

  return v_member;
end;
$$;

revoke execute on function home.accept_invitation(uuid) from public, anon;
grant execute on function home.accept_invitation(uuid) to authenticated;

create or replace function home.accept_invitation_by_token(p_token uuid)
returns home.household_members
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invitation home.invitations;
  v_member home.household_members;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  if not exists (select 1 from home.profiles pr where pr.id = auth.uid()) then
    raise exception 'Save your name first';
  end if;

  select * into v_invitation
  from home.invitations
  where token = p_token and expires_at > now();

  if v_invitation.id is null then
    raise exception 'That code has expired — ask them for a new one';
  end if;

  if not exists (
    select 1 from home.properties p
    where p.household_id = v_invitation.household_id
      and p.id = any(v_invitation.property_ids)
  ) then
    raise exception 'The place you were invited to has gone';
  end if;

  insert into home.household_members (household_id, profile_id, role)
  values (v_invitation.household_id, auth.uid(), 'member')
  on conflict (household_id, profile_id) do nothing;

  select * into v_member from home.household_members
  where household_id = v_invitation.household_id and profile_id = auth.uid();

  insert into home.property_members (property_id, profile_id, role)
  select p.id, auth.uid(), 'member'
  from home.properties p
  where p.household_id = v_invitation.household_id
    and p.id = any(v_invitation.property_ids)
  on conflict do nothing;

  -- The link is not consumed: it is good for its window, for two people in one
  -- sitting. An address invitation to this person for the same household has
  -- been answered by other means.
  delete from home.invitations
  where household_id = v_invitation.household_id
    and email = home.my_email();

  return v_member;
end;
$$;

revoke execute on function home.accept_invitation_by_token(uuid) from public, anon;
grant execute on function home.accept_invitation_by_token(uuid) to authenticated;

-- ---------------------------------------------------------------- an ending

-- What deleting this account would delete: households it owns and is alone in.
-- Named, so the confirmation can say what will actually go rather than warn in
-- general. A household it shares, or does not own, is never on this list.
create function home.my_account_deletes()
returns table (household_id uuid, household_name text, property_names text[])
language sql
stable
security definer
set search_path = ''
as $$
  select h.id, h.name,
    array(
      select p.name from home.properties p
      where p.household_id = h.id
      order by p.created_at, p.id
    )
  from home.households h
  join home.household_members m on m.household_id = h.id
  where m.profile_id = auth.uid()
    and m.role = 'owner'
    and not exists (
      select 1 from home.household_members o
      where o.household_id = h.id and o.profile_id <> auth.uid()
    )
  order by h.created_at, h.id;
$$;

revoke execute on function home.my_account_deletes() from public, anon;
grant execute on function home.my_account_deletes() to authenticated;

create or replace function home.my_orphan_file_paths()
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_paths text[] := '{}';
  v_household uuid;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  for v_household in
    select d.household_id from home.my_account_deletes() d
  loop
    v_paths := v_paths || home.household_file_paths(v_household);
  end loop;

  return v_paths;
end;
$$;

revoke execute on function home.my_orphan_file_paths() from public, anon;
grant execute on function home.my_orphan_file_paths() to authenticated;

-- A household goes only when the leaver owns it and nobody else is in it. Every
-- other household is left the way remove_member leaves one, and a place they
-- owned and shared is handed on. A joiner deleting their account can never
-- delete what they do not own.
create or replace function home.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_email text := home.my_email();
  v_household uuid;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;

  for v_household in
    select m.household_id
    from home.household_members m
    where m.profile_id = v_uid
      and exists (
        select 1 from home.household_members o
        where o.household_id = m.household_id and o.profile_id <> v_uid
      )
  loop
    perform home.leave_household_as(v_household, v_uid, null);
  end loop;

  delete from home.households h
  where exists (
    select 1 from home.household_members m
    where m.household_id = h.id and m.profile_id = v_uid and m.role = 'owner'
  )
  and not exists (
    select 1 from home.household_members o
    where o.household_id = h.id and o.profile_id <> v_uid
  );

  delete from home.invitations where email = v_email;

  update home.profiles
  set display_name = 'Someone who left',
      deleted_at   = coalesce(deleted_at, now())
  where id = v_uid;

  update public.profiles
  set name  = 'Someone who left',
      email = ''
  where id = v_uid;

  if v_email is not null then
    update public.invites
    set email = ''
    where lower(btrim(email)) = v_email;
  end if;

  delete from auth.users where id = v_uid;
end;
$$;

revoke execute on function home.delete_my_account() from public, anon;
grant execute on function home.delete_my_account() to authenticated;

-- The same for a login deleted from the dashboard.
create or replace function home.forget_login(p_uid uuid, p_email text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_household uuid;
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
begin
  for v_household in
    select m.household_id
    from home.household_members m
    where m.profile_id = p_uid
      and exists (
        select 1 from home.household_members o
        where o.household_id = m.household_id and o.profile_id <> p_uid
      )
  loop
    perform home.leave_household_as(v_household, p_uid, null);
  end loop;

  delete from home.households h
  where exists (
    select 1 from home.household_members m
    where m.household_id = h.id and m.profile_id = p_uid and m.role = 'owner'
  )
  and not exists (
    select 1 from home.household_members o
    where o.household_id = h.id and o.profile_id <> p_uid
  );

  if v_email is not null then
    delete from home.invitations where lower(btrim(email)) = v_email;
  end if;

  update home.profiles
  set display_name = 'Someone who left',
      deleted_at   = coalesce(deleted_at, now())
  where id = p_uid
    and (display_name is distinct from 'Someone who left' or deleted_at is null);

  update public.invites i
  set email = ''
  from public.profiles p
  where p.id = p_uid
    and p.email <> ''
    and lower(btrim(i.email)) = lower(btrim(p.email));

  if v_email is not null then
    update public.invites set email = '' where lower(btrim(email)) = v_email;
  end if;

  update public.profiles
  set name  = 'Someone who left',
      email = ''
  where id = p_uid
    and (name <> 'Someone who left' or email <> '');
end;
$$;

revoke execute on function home.forget_login(uuid, text) from public, anon, authenticated;
