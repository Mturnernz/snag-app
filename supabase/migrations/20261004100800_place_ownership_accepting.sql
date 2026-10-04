-- Place ownership, part 9 of 11. Why: 20261004100000_place_ownership_roles.sql.
-- Split into small files so each can be applied and approved on its own.

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
