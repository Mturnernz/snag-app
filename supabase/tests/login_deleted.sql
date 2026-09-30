-- A login deleted anywhere leaves the way *Delete my account* leaves.
--
-- 20260929214235 put a trigger on auth.users, because a delete from the
-- Supabase dashboard skipped everything delete_my_account does. This replays
-- both doors — the dashboard's (no caller, straight at auth.users) and the
-- app's — plus the shared-household case, and rolls back.
--
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/login_deleted.sql

begin;

create temporary table t_ids (label text primary key, id uuid) on commit drop;

create or replace function pg_temp.make_login(p_label text, p_name text) returns uuid
language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
                          created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  values (v, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          p_label || '-' || v || '@example.invalid', '', now(), now(), now(),
          '{"provider":"email","providers":["email"]}', '{}');
  perform set_config('request.jwt.claims',
    json_build_object('sub', v, 'role', 'authenticated', 'email', p_label || '-' || v || '@example.invalid')::text, true);
  perform home.upsert_profile(p_name);
  insert into t_ids values (p_label, v);
  return v;
end $$;

do $$
declare
  v_alone uuid;
  v_app uuid;
  v_owner uuid;
  v_partner uuid;
  v_house uuid;
begin
  -- A new account starts with Projects off (20260929214206).
  v_alone := pg_temp.make_login('alone', 'Alone');
  perform home.create_household('Alone house', 'Alone house');
  if (select projects_enabled from home.profiles where id = v_alone) then
    raise exception 'A new account arrived with Projects on';
  end if;

  -- The dashboard's door.
  perform set_config('request.jwt.claims', '', true);
  delete from auth.users where id = v_alone;
  if (select display_name from home.profiles where id = v_alone) <> 'Someone who left' then
    raise exception 'A dashboard delete left the name';
  end if;
  if exists (select 1 from home.households where name = 'Alone house') then
    raise exception 'A dashboard delete left the household only they were in';
  end if;

  -- The app's door still works with the trigger behind it.
  v_app := pg_temp.make_login('app', 'App Leaver');
  perform home.create_household('App house', 'App house');
  perform home.delete_my_account();
  if exists (select 1 from auth.users where id = v_app)
     or (select display_name from home.profiles where id = v_app) <> 'Someone who left'
     or exists (select 1 from home.households where name = 'App house') then
    raise exception 'delete_my_account no longer leaves cleanly';
  end if;

  -- A shared household survives, handed to whoever is left.
  v_owner := pg_temp.make_login('owner', 'Owner');
  select (home.create_household('Shared house', 'Shared house')).id into v_house;
  v_partner := pg_temp.make_login('partner', 'Partner');
  insert into home.household_members (household_id, profile_id) values (v_house, v_partner);
  perform set_config('request.jwt.claims', '', true);
  delete from auth.users where id = v_owner;
  if not exists (select 1 from home.households where id = v_house) then
    raise exception 'A shared household went with one of its members';
  end if;
  if exists (select 1 from home.household_members where household_id = v_house and profile_id = v_owner) then
    raise exception 'The leaver is still a member';
  end if;
  if exists (
    select 1 from home.properties p
    where p.household_id = v_house
      and not exists (select 1 from home.property_members pm where pm.property_id = p.id)
  ) then
    raise exception 'A place was left with nobody on it';
  end if;

  raise notice 'login_deleted.sql: all passed';
end $$;

rollback;
