-- Download my data holds what this person can see, and nothing else.
--
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/export_my_data.sql
--
-- Run it against a local stack (`supabase start`), never the live project: it
-- inserts auth users. Everything happens inside one transaction that is rolled
-- back at the end. See 20260928100000_what_snag_keeps_about_you.sql.

begin;

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
  is_sso_user, is_anonymous
) values
  ('00000000-0000-0000-0000-000000000000', 'e0a0e0a0-0000-4000-8000-0000000000a1',
   'authenticated', 'authenticated', 'ana@example.invalid', '',
   now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', false, false),
  ('00000000-0000-0000-0000-000000000000', 'e0a0e0a0-0000-4000-8000-0000000000b1',
   'authenticated', 'authenticated', 'ben@example.invalid', '',
   now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', false, false);

create function pg_temp.act(who text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', case who
    when 'ana' then '{"sub":"e0a0e0a0-0000-4000-8000-0000000000a1","email":"ana@example.invalid","role":"authenticated"}'
    when 'ben' then '{"sub":"e0a0e0a0-0000-4000-8000-0000000000b1","email":"ben@example.invalid","role":"authenticated"}'
    when 'nobody' then '{"role":"authenticated"}'
  end, true);
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

-- Two households, each with a job, one with a live join link and a project
-- whose bill address has been minted.
do $$
declare
  v_hh uuid;
  v_prop uuid;
  v_project uuid;
begin
  perform pg_temp.act('ana');
  perform home.upsert_profile('Ana');
  select id into v_hh from home.create_household('Ana house');
  select id into v_prop from home.properties where household_id = v_hh;
  insert into ids values ('ana_household', v_hh);
  perform home.create_snag(v_prop, 'Kitchen', 'Ana''s dripping tap');
  perform home.create_invite_link(v_hh);
  select id into v_project from home.create_project(v_prop, 'Ana''s bathroom');
  perform home.project_inbox_token(v_project);

  perform pg_temp.act('ben');
  perform home.upsert_profile('Ben');
  select id into v_hh from home.create_household('Ben house');
  select id into v_prop from home.properties where household_id = v_hh;
  insert into ids values ('ben_household', v_hh);
  perform home.create_snag(v_prop, 'Garage', 'Ben''s door');
end;
$$;

do $$
declare
  d jsonb;
begin
  perform pg_temp.act('ana');
  d := home.export_my_data();

  perform pg_temp.expect(d -> 'account' ->> 'email' = 'ana@example.invalid', 'the file says whose it is');
  perform pg_temp.expect(
    (select array_agg(h ->> 'id') from jsonb_array_elements(d -> 'households') h)
      = array[(select id::text from ids where name = 'ana_household')],
    'Ana''s export holds her household and only hers');
  perform pg_temp.expect(
    (select array_agg(s ->> 'description') from jsonb_array_elements(d -> 'snags') s)
      = array['Ana''s dripping tap'],
    'Ana''s export holds her job and not Ben''s');
  perform pg_temp.expect(
    not exists (select 1 from jsonb_array_elements(d -> 'profiles') p where p ->> 'display_name' = 'Ben'),
    'nobody from another household is named');
  perform pg_temp.expect(
    jsonb_array_length(d -> 'invitations') = 1
      and not exists (select 1 from jsonb_array_elements(d -> 'invitations') i where i ? 'token'),
    'the join link is listed without the token that opens it');
  perform pg_temp.expect(
    jsonb_array_length(d -> 'projects') = 1
      and not exists (select 1 from jsonb_array_elements(d -> 'projects') p where p ? 'inbox_token'),
    'the project is listed without the address bills are emailed to');
  perform pg_temp.expect(
    not (d ? 'label_reads') and not (d ? 'staff') and not (d ? 'support_access_log'),
    'the tables nobody reads are not in the file');

  perform pg_temp.act('ben');
  d := home.export_my_data();
  perform pg_temp.expect(
    (select array_agg(s ->> 'description') from jsonb_array_elements(d -> 'snags') s)
      = array['Ben''s door'],
    'Ben''s export holds his job and not Ana''s');
  perform pg_temp.expect(jsonb_array_length(d -> 'projects') = 0, 'Ben sees no project');

  perform pg_temp.act('nobody');
  begin
    perform home.export_my_data();
    raise exception 'Failed: an unsigned caller got a file';
  exception when insufficient_privilege then
    perform pg_temp.expect(sqlerrm = 'Sign in to download your data', 'refused in words');
  end;
end;
$$;

reset role;

do $$
begin
  perform pg_temp.expect(
    not has_function_privilege('anon', 'home.export_my_data()', 'execute'),
    'a signed-out caller cannot run it');
end;
$$;

do $$ begin raise notice 'export_my_data: every check passed'; end $$;

rollback;
