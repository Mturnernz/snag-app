-- Nobody let into a place can take the household away.
--
-- On 4 October 2026 a joiner was made `owner` by accept_invitation, removed the
-- two people who had built the household with remove_member, and then deleted
-- their own account — which deleted the household, both places and every job,
-- because they were by then its only member. 20261004100000 gives places
-- owners. This replays that afternoon and the rules around it, and rolls back.
--
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/membership_safety.sql

begin;

create or replace function pg_temp.make_login(p_name text) returns uuid
language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
                          created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  values (v, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          lower(p_name) || '-' || v || '@example.invalid', '', now(), now(), now(),
          '{"provider":"email","providers":["email"]}', '{}');
  perform pg_temp.act_as(v);
  perform home.upsert_profile(p_name);
  return v;
end $$;

create or replace function pg_temp.act_as(p_uid uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
end $$;

-- Runs a statement that must be refused, and fails the test if it is not.
create or replace function pg_temp.refused(p_sql text, p_what text) returns void
language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    return;
  end;
  raise exception 'Allowed, and must not be: %', p_what;
end $$;

create or replace function pg_temp.role_on(p_place uuid, p_uid uuid) returns text
language sql as $$
  select role::text from home.property_members where property_id = p_place and profile_id = p_uid;
$$;

do $$
declare
  v_mike uuid; v_alyssa uuid; v_leonie uuid; v_kim uuid; v_pat uuid; v_sam uuid;
  v_house uuid; v_leroy uuid; v_bay uuid;
  v_link home.invitations;
  v_invite home.invitations;
  v_names text[];
  v_snags_before integer;
begin
  -- Mike makes the household, and a second place.
  v_mike := pg_temp.make_login('Mike');
  select (home.create_household('32 Le Roy', '32 Le Roy')).id into v_house;
  select id into v_leroy from home.properties where household_id = v_house;
  -- A household is one home since 20261005120000, and create_property says
  -- so. Households made before then can hold two, which is the shape this
  -- afternoon happened in, so the second is made directly, as it was then.
  perform pg_temp.refused(format('select home.create_property(%L, %L)', v_house, 'Martin''s Bay'),
    'a second place in a household');
  insert into home.properties (household_id, name) values (v_house, 'Martin''s Bay')
  returning id into v_bay;
  insert into home.property_members (property_id, profile_id, role) values (v_bay, v_mike, 'owner');
  perform home.seed_locations(v_bay);

  if pg_temp.role_on(v_leroy, v_mike) <> 'owner' or pg_temp.role_on(v_bay, v_mike) <> 'owner' then
    raise exception 'The creator does not own the places they made';
  end if;
  if (select role from home.household_members where household_id = v_house and profile_id = v_mike) <> 'owner' then
    raise exception 'The creator does not own the household';
  end if;

  insert into home.snags (household_id, property_id, reporter_id, description)
  values (v_house, v_leroy, v_mike, 'Toilet seat'), (v_house, v_bay, v_mike, 'Gutters');
  select count(*) into v_snags_before from home.snags where household_id = v_house;

  -- Alyssa is invited by address to Le Roy, and joins as a member.
  v_alyssa := pg_temp.make_login('Alyssa');
  perform pg_temp.act_as(v_mike);
  v_invite := home.invite_to_household(v_house,
    (select email from auth.users where id = v_alyssa), array[v_leroy]);
  perform pg_temp.act_as(v_alyssa);
  perform home.accept_invitation(v_invite.id);
  if (select role from home.household_members where household_id = v_house and profile_id = v_alyssa) <> 'member'
     or pg_temp.role_on(v_leroy, v_alyssa) <> 'member'
     or pg_temp.role_on(v_bay, v_alyssa) is not null then
    raise exception 'An address invitation did not make a member of only the place it named';
  end if;

  -- A member cannot invite: only an owner can.
  perform pg_temp.refused(format('select home.create_invite_link(%L, array[%L]::uuid[])', v_house, v_leroy),
    'a member minting a link');

  -- Mike shares Martin's Bay by link. The joiner is told the place, not the house.
  perform pg_temp.act_as(v_mike);
  v_link := home.create_invite_link(v_house, array[v_bay]);
  v_leonie := pg_temp.make_login('Leonie');
  select property_names into v_names from home.invitation_by_token(v_link.token);
  if v_names is distinct from array['Martin''s Bay'] then
    raise exception 'invitation_by_token named %, not Martin''s Bay', v_names;
  end if;

  -- She also has an address invitation waiting; joining by link answers it.
  perform pg_temp.act_as(v_mike);
  perform home.invite_to_household(v_house,
    (select email from auth.users where id = v_leonie), array[v_bay]);
  perform pg_temp.act_as(v_leonie);
  perform home.accept_invitation_by_token(v_link.token);
  if exists (
    select 1 from home.invitations i join auth.users u on lower(u.email) = i.email
    where u.id = v_leonie
  ) then
    raise exception 'Joining by link left the address invitation waiting';
  end if;
  if (select role from home.household_members where household_id = v_house and profile_id = v_leonie) <> 'member'
     or pg_temp.role_on(v_bay, v_leonie) <> 'member'
     or pg_temp.role_on(v_leroy, v_leonie) is not null then
    raise exception 'A link made the joiner more than a member of Martin''s Bay';
  end if;

  -- 4 October, replayed. A member cannot remove the owner, or anybody else.
  perform pg_temp.act_as(v_leonie);
  perform pg_temp.refused(format('select home.remove_member(%L, %L)', v_house, v_mike),
    'a member removing the household owner');
  perform pg_temp.refused(format('select home.remove_member(%L, %L)', v_house, v_alyssa),
    'a member removing another member');
  perform pg_temp.refused(format('select home.unlink_property_member(%L, %L)', v_bay, v_mike),
    'a member taking the owner off a place');
  perform pg_temp.refused(format('select home.delete_property(%L)', v_bay),
    'a member deleting a place');
  perform pg_temp.refused(format('select home.delete_household(%L)', v_house),
    'a member deleting the household');
  perform pg_temp.refused(format('select home.transfer_property_ownership(%L, %L)', v_bay, v_leonie),
    'a member making themselves owner');

  -- And her deleting her account deletes nothing that is not hers.
  perform home.delete_my_account();
  if not exists (select 1 from home.households where id = v_house)
     or (select count(*) from home.properties where household_id = v_house) <> 2
     or (select count(*) from home.snags where household_id = v_house) <> v_snags_before then
    raise exception 'A joiner deleting their account deleted the household or a place';
  end if;
  if not home.is_member_profile(v_house, v_mike) or not home.is_member_profile(v_house, v_alyssa) then
    raise exception 'A joiner deleting their account took somebody else out';
  end if;

  -- An owner can take a member off their place. Pat is only on Martin's Bay,
  -- so being taken off it takes Pat out of the household too.
  v_pat := pg_temp.make_login('Pat');
  perform pg_temp.act_as(v_mike);
  v_link := home.create_invite_link(v_house, array[v_bay]);
  perform pg_temp.act_as(v_pat);
  perform home.accept_invitation_by_token(v_link.token);
  perform pg_temp.act_as(v_mike);
  perform home.unlink_property_member(v_bay, v_pat);
  if pg_temp.role_on(v_bay, v_pat) is not null or home.is_member_profile(v_house, v_pat) then
    raise exception 'The owner could not take a member off their place';
  end if;

  -- The household owner can take somebody out of the household.
  v_sam := pg_temp.make_login('Sam');
  perform pg_temp.act_as(v_mike);
  v_link := home.create_invite_link(v_house, array[v_leroy]);
  perform pg_temp.act_as(v_sam);
  perform home.accept_invitation_by_token(v_link.token);
  perform pg_temp.act_as(v_mike);
  perform home.remove_member(v_house, v_sam);
  if home.is_member_profile(v_house, v_sam) then
    raise exception 'The household owner could not remove a member';
  end if;

  -- Anybody can leave.
  v_kim := pg_temp.make_login('Kim');
  perform pg_temp.act_as(v_mike);
  v_link := home.create_invite_link(v_house, array[v_bay]);
  perform pg_temp.act_as(v_kim);
  perform home.accept_invitation_by_token(v_link.token);
  perform home.unlink_property_member(v_bay, v_kim);
  if home.is_member_profile(v_house, v_kim) then
    raise exception 'A member could not leave their only place';
  end if;
  perform home.accept_invitation_by_token(v_link.token);
  perform home.remove_member(v_house, v_kim);
  if home.is_member_profile(v_house, v_kim) then
    raise exception 'A member could not leave the household';
  end if;

  -- Nobody leaves a place without an owner.
  perform home.accept_invitation_by_token(v_link.token);
  perform pg_temp.act_as(v_mike);
  perform pg_temp.refused(format('select home.unlink_property_member(%L, %L)', v_bay, v_mike),
    'the only owner leaving a place somebody else is on');

  -- Handing over works, and then the new owner may take the old one off.
  perform home.transfer_property_ownership(v_bay, v_kim, true);
  if pg_temp.role_on(v_bay, v_kim) <> 'owner' or pg_temp.role_on(v_bay, v_mike) <> 'member' then
    raise exception 'Handing Martin''s Bay over did not move the ownership';
  end if;
  perform pg_temp.act_as(v_kim);
  perform home.unlink_property_member(v_bay, v_mike);
  if pg_temp.role_on(v_bay, v_mike) is not null or not home.is_member_profile(v_house, v_mike) then
    raise exception 'Taking Mike off Martin''s Bay took him off the house as well';
  end if;

  -- Kim now owns Martin's Bay and shares it with nobody; Kim deleting the
  -- account hands it back rather than deleting it.
  perform home.delete_my_account();
  if not exists (select 1 from home.properties where id = v_bay) then
    raise exception 'A place went with an account that did not own the household';
  end if;
  if not exists (select 1 from home.property_members where property_id = v_bay and role = 'owner') then
    raise exception 'Martin''s Bay was left with no owner';
  end if;
  if (select count(*) from home.snags where household_id = v_house) <> v_snags_before then
    raise exception 'Jobs went with somebody who left';
  end if;

  -- The household owner alone, and only then, deletes it with their account.
  perform pg_temp.act_as(v_alyssa);
  perform home.remove_member(v_house, v_alyssa);
  perform pg_temp.act_as(v_mike);
  if (select count(*) from home.my_account_deletes()) <> 1 then
    raise exception 'my_account_deletes did not name the household Mike owns alone';
  end if;
  perform home.delete_my_account();
  if exists (select 1 from home.households where id = v_house) then
    raise exception 'The owner, alone, deleting the account left the household behind';
  end if;

  raise notice 'membership_safety.sql: all passed';
end $$;

rollback;
