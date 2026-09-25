-- An anonymous session cannot become a member, replayed through the app's own
-- functions.
--
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/anonymous_sessions.sql
--
-- Run it against a local stack (`supabase start`), never the live project: it
-- inserts auth users. Everything happens inside one transaction that is rolled
-- back at the end.
--
-- It exists because the gap it pins was invisible. Supabase runs an anonymous
-- sign-in as the `authenticated` role, so every function this schema grants to
-- `authenticated` answered one — and the three that make a membership asked
-- only whether *somebody* was signed in. See
-- 20260926100000_an_anonymous_session_is_not_an_account.sql.

begin;

-- ---------------------------------------------------------------- people

-- Mike has an account. The two anonymous sessions have no address at all; the
-- second is given a profile below, as if from before the guard, so the
-- membership trigger is reached on its own rather than only through the
-- profile one.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
  is_sso_user, is_anonymous
) values
  ('00000000-0000-0000-0000-000000000000', '5ab0a110-0000-4000-8000-0000000000a1',
   'authenticated', 'authenticated', 'mike@example.invalid', '',
   now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', false, false),
  ('00000000-0000-0000-0000-000000000000', '5ab0a110-0000-4000-8000-0000000000b1',
   'authenticated', 'authenticated', null, '',
   null, now(), now(), '{"provider":"anonymous","providers":["anonymous"]}', '{}', false, true),
  ('00000000-0000-0000-0000-000000000000', '5ab0a110-0000-4000-8000-0000000000b2',
   'authenticated', 'authenticated', null, '',
   null, now(), now(), '{"provider":"anonymous","providers":["anonymous"]}', '{}', false, true);

-- The guard refuses this insert too, which is the point; it goes in with
-- triggers off to stand for a row that predates it.
set local session_replication_role = replica;
insert into home.profiles (id, display_name)
values ('5ab0a110-0000-4000-8000-0000000000b2', 'Made before the guard');
set local session_replication_role = origin;

-- Sets the token a request would carry. Role switches stay at the top level.
create function pg_temp.act(who text) returns void language plpgsql as $$
declare
  v jsonb := case who
    when 'mike'  then '{"sub":"5ab0a110-0000-4000-8000-0000000000a1","email":"mike@example.invalid","is_anonymous":false}'
    when 'anon'  then '{"sub":"5ab0a110-0000-4000-8000-0000000000b1","is_anonymous":true}'
    when 'anon2' then '{"sub":"5ab0a110-0000-4000-8000-0000000000b2","is_anonymous":true}'
  end::jsonb;
begin
  perform set_config('request.jwt.claims', (v || '{"role":"authenticated"}')::text, true);
end;
$$;

-- A refusal in the guard's own words, and nothing else: a refusal for some
-- other reason would pass a looser check while proving nothing about this one.
create function pg_temp.refused_as_anonymous(stmt text, label text) returns void language plpgsql as $$
begin
  begin
    execute stmt;
  exception when insufficient_privilege then
    if sqlerrm = 'Create an account to use Snag' then
      return;
    end if;
    raise exception 'Refused for the wrong reason (%): %', label, sqlerrm;
  end;
  raise exception 'Expected a refusal: %', label;
end;
$$;

create function pg_temp.expect(ok boolean, label text) returns void language plpgsql as $$
begin
  if ok is not true then
    raise exception 'Failed: %', label;
  end if;
end;
$$;

create temp table ids (name text primary key, id uuid);
grant all on ids to authenticated;

set local role authenticated;

-- ---------------------------------------------------------------- an account

do $$
declare
  v_hh uuid;
begin
  -- Every door still opens for somebody with an address, including the
  -- rename, which is upsert_profile's on-conflict path.
  perform pg_temp.act('mike');
  perform home.upsert_profile('Mike');
  perform home.upsert_profile('Mike T');
  select id into v_hh from home.create_household('32 Le Roy');
  insert into ids values ('household', v_hh);
  insert into ids select 'token', token from home.create_invite_link(v_hh);
end;
$$;

-- ---------------------------------------------------------------- anonymous

do $$
declare
  v_token uuid := (select id from ids where name = 'token');
begin
  -- No profile yet: refused at the name.
  perform pg_temp.act('anon');
  perform pg_temp.refused_as_anonymous(
    $q$select home.upsert_profile('Bot')$q$, 'an anonymous session naming itself');

  -- A profile somehow already there: refused at both doors that make a member.
  perform pg_temp.act('anon2');
  perform pg_temp.refused_as_anonymous(
    $q$select home.create_household('Bot house')$q$, 'an anonymous session creating a household');
  perform pg_temp.refused_as_anonymous(
    format('select home.accept_invitation_by_token(%L)', v_token),
    'an anonymous session holding a join code');
  perform pg_temp.refused_as_anonymous(
    $q$select home.upsert_profile('Renamed')$q$, 'an anonymous session renaming its profile');
end;
$$;

reset role;

do $$
begin
  perform pg_temp.expect(
    not exists (
      select 1 from home.household_members m
      join auth.users u on u.id = m.profile_id
      where u.is_anonymous
    ),
    'no anonymous session is a member of anything');
  perform pg_temp.expect(
    not exists (select 1 from home.profiles where id = '5ab0a110-0000-4000-8000-0000000000b1'),
    'an anonymous session that tried to name itself has no profile');
  perform pg_temp.expect(
    (select display_name from home.profiles where id = '5ab0a110-0000-4000-8000-0000000000b2')
      = 'Made before the guard',
    'the refused rename changed nothing');
  perform pg_temp.expect(
    (select count(*) from home.household_members
     where household_id = (select id from ids where name = 'household')) = 1,
    'the household still holds only the person who made it');
  perform pg_temp.expect(
    not has_function_privilege('authenticated', 'home.refuse_anonymous_member()', 'execute')
      and not has_function_privilege('anon', 'home.refuse_anonymous_member()', 'execute'),
    'the guard is called by its triggers and by nobody else');
end;
$$;

do $$ begin raise notice 'anonymous_sessions: every check passed'; end $$;

rollback;
