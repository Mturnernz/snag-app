-- Who can see a job that was asked about, replayed through the app's own
-- functions.
--
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/support_access.sql
--
-- Run it against a local stack (`supabase start`), never the live project: it
-- inserts auth users and a staff row. Everything happens inside one
-- transaction that is rolled back at the end.
--
-- It exists because every rule it checks fails silently. A staff member who
-- can read a job nobody asked about sees more rows, and more rows are
-- indistinguishable from rows they were entitled to — the same shape of bug as
-- a view without `security_invoker`. So each rule is asserted from both sides:
-- what is shared while a question is open, and that it stops being shared.

begin;

-- ---------------------------------------------------------------- people

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
  is_sso_user, is_anonymous
) values
  ('00000000-0000-0000-0000-000000000000', '5ab0a110-0000-4000-8000-00000000000a',
   'authenticated', 'authenticated', 'alice@example.invalid', '',
   now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', false, false),
  ('00000000-0000-0000-0000-000000000000', '5ab0a110-0000-4000-8000-00000000000b',
   'authenticated', 'authenticated', 'bob@example.invalid', '',
   now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', false, false),
  ('00000000-0000-0000-0000-000000000000', '5ab0a110-0000-4000-8000-00000000005a',
   'authenticated', 'authenticated', 'sam@snaghq.co.nz', '',
   now(), now(), now(), '{"provider":"google","providers":["google"]}', '{}', false, false),
  ('00000000-0000-0000-0000-000000000000', '5ab0a110-0000-4000-8000-00000000000e',
   'authenticated', 'authenticated', 'eve@snaghq.co.nz', '',
   now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', false, false);

-- Sam is staff and signs in with Google. Eve has a staff row but an
-- email-and-password account, which is not what the staff list vouches for.
insert into home.staff (user_id, display_name, email) values
  ('5ab0a110-0000-4000-8000-00000000005a', 'Sam', 'sam@snaghq.co.nz'),
  ('5ab0a110-0000-4000-8000-00000000000e', 'Eve', 'eve@snaghq.co.nz');

-- Sets the token a request would carry. Role switches stay at the top level.
create function pg_temp.act(who text) returns void language plpgsql as $$
declare
  v jsonb := case who
    when 'alice' then '{"sub":"5ab0a110-0000-4000-8000-00000000000a","email":"alice@example.invalid","app_metadata":{"provider":"email","providers":["email"]}}'
    when 'bob'   then '{"sub":"5ab0a110-0000-4000-8000-00000000000b","email":"bob@example.invalid","app_metadata":{"provider":"email","providers":["email"]}}'
    when 'sam'   then '{"sub":"5ab0a110-0000-4000-8000-00000000005a","email":"sam@snaghq.co.nz","app_metadata":{"provider":"google","providers":["google"]}}'
    when 'eve'   then '{"sub":"5ab0a110-0000-4000-8000-00000000000e","email":"eve@snaghq.co.nz","app_metadata":{"provider":"email","providers":["email"]}}'
  end::jsonb;
begin
  perform set_config('request.jwt.claims', (v || '{"role":"authenticated"}')::text, true);
end;
$$;

create function pg_temp.refuses(stmt text, label text) returns void language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    return;
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

-- ---------------------------------------------------------------- two houses

do $$
declare
  v_prop uuid;
  v_hh uuid;
begin
  perform pg_temp.act('alice');
  perform home.upsert_profile('Alice');
  perform home.create_household('Alice house', 'Home');
  select id, household_id into v_prop, v_hh from home.properties limit 1;
  insert into ids values ('alice_hh', v_hh), ('alice_prop', v_prop);
  insert into ids values ('alice_snag', (home.create_snag(
    p_property_id => v_prop, p_room => 'Bathroom', p_description => 'Tap drips',
    p_photo_paths => array[v_hh::text || '/tap.jpg'])).id);

  perform pg_temp.act('bob');
  perform home.upsert_profile('Bob');
  perform home.create_household('Bob house', 'Home');
  select id, household_id into v_prop, v_hh from home.properties limit 1;
  insert into ids values ('bob_hh', v_hh), ('bob_snag', (home.create_snag(
    p_property_id => v_prop, p_description => 'Gutter',
    p_photo_paths => array[v_hh::text || '/gutter.jpg'])).id);
end;
$$;

-- ---------------------------------------------------------------- nothing is shared yet

do $$
declare
  v_alice_hh text := (select id from ids where name = 'alice_hh');
begin
  perform pg_temp.act('sam');
  perform pg_temp.expect(home.is_staff(), 'Sam is staff');
  perform pg_temp.expect(not home.staff_can_read_file(v_alice_hh || '/tap.jpg'),
    'no photo is readable before anybody asks');
  perform pg_temp.expect(jsonb_array_length(home.staff_queue('open') -> 'rows') = 0,
    'the queue starts empty');

  perform pg_temp.act('eve');
  perform pg_temp.expect(not home.is_staff(), 'a staff row on a non-Google account is not staff');
  perform pg_temp.refuses($q$select home.staff_queue('open')$q$, 'Eve reading the queue');

  perform pg_temp.act('alice');
  perform pg_temp.expect(not home.is_staff(), 'a customer is not staff');
  perform pg_temp.refuses($q$select home.staff_queue('open')$q$, 'a customer reading the queue');
end;
$$;

-- ---------------------------------------------------------------- asking

do $$
declare
  v_snag uuid := (select id from ids where name = 'alice_snag');
begin
  perform pg_temp.act('bob');
  perform pg_temp.refuses(format('select home.create_support_request(%L, %L)', v_snag, 'Mine now?'),
    'asking about somebody else''s job');

  perform pg_temp.act('alice');
  perform pg_temp.refuses(format('select home.create_support_request(%L, %L)', v_snag, '   '),
    'an empty question');
  insert into ids values ('req1', (home.create_support_request(v_snag, 'Why does it drip?')).id);
  perform pg_temp.refuses(format('select home.create_support_request(%L, %L)', v_snag, 'Again?'),
    'a second open question on one job');

  perform pg_temp.act('bob');
  perform pg_temp.expect((select count(*) from home.support_requests) = 0,
    'another household cannot see the question');
end;
$$;

-- ---------------------------------------------------------------- staff read what was shared, and only that

do $$
declare
  v_req uuid := (select id from ids where name = 'req1');
  v_alice_hh text := (select id from ids where name = 'alice_hh');
  v_bob_hh text := (select id from ids where name = 'bob_hh');
  v_page jsonb;
  v_queue jsonb;
begin
  perform pg_temp.act('sam');
  v_queue := home.staff_queue('unclaimed');
  perform pg_temp.expect(jsonb_array_length(v_queue -> 'rows') = 1, 'the question is in the queue');
  perform pg_temp.expect(v_queue -> 'rows' -> 0 -> 'job' ->> 'description' = 'Tap drips',
    'an open row carries the job');

  perform pg_temp.expect(home.staff_can_read_file(v_alice_hh || '/tap.jpg'),
    'the photograph on the asked-about job is readable');
  perform pg_temp.expect(not home.staff_can_read_file(v_alice_hh || '/other.jpg'),
    'another file in the same household folder is not');
  perform pg_temp.expect(not home.staff_can_read_file(v_bob_hh || '/gutter.jpg'),
    'a job nobody asked about is not');

  v_page := home.staff_request_page(v_req);
  perform pg_temp.expect(v_page -> 'job' ->> 'room' = 'Bathroom', 'the page carries the job');
  perform pg_temp.expect(v_page -> 'request' ->> 'asked_by_name' = 'Alice', 'the page names who asked');
  perform pg_temp.expect(v_page -> 'request' ->> 'first_seen_at' is not null, 'opening it is seen');
  perform pg_temp.expect(v_page -> 'log' -> 0 ->> 'action' = 'opened', 'opening it is logged');

  perform home.staff_request_page(v_req);
  perform pg_temp.expect(jsonb_array_length(home.staff_request_page(v_req) -> 'log') = 1,
    'reopening within half an hour is logged once');

  perform pg_temp.expect(
    (select email from home.staff_reply_email_target(v_req)) = 'alice@example.invalid',
    'the email goes to whoever asked');

  perform home.staff_assign(v_req, '5ab0a110-0000-4000-8000-00000000005a');
  perform pg_temp.expect(jsonb_array_length(home.staff_queue('mine') -> 'rows') = 1, 'claimed is mine');
  perform pg_temp.expect(jsonb_array_length(home.staff_queue('unclaimed') -> 'rows') = 0,
    'claimed is not unclaimed');
  perform pg_temp.refuses(format('select home.staff_assign(%L, %L)', v_req, gen_random_uuid()),
    'assigning to somebody not on the staff list');

  perform pg_temp.act('alice');
  perform pg_temp.refuses(format('select home.staff_request_page(%L)', v_req),
    'a customer calling the staff page');
  perform pg_temp.refuses(format('select * from home.staff_reply_email_target(%L)', v_req),
    'a customer reading the email target');
end;
$$;

-- ---------------------------------------------------------------- answering

do $$
declare
  v_req uuid := (select id from ids where name = 'req1');
  v_snag uuid := (select id from ids where name = 'alice_snag');
  v_before home.snags;
  v_after home.snags;
  v_msg uuid;
begin
  reset role;
  select * into v_before from home.snags where id = v_snag;
  set local role authenticated;

  perform pg_temp.act('sam');
  perform home.staff_add_note(v_req, 'Probably the washer — check the photo again');

  perform pg_temp.refuses(format(
    'select home.staff_reply(%L, %L, %L::jsonb)', v_req, 'Here you go',
    '{"diagnosis":"Worn washer","verdict":"trade","tradies":[{"name":"Drip Co","phone":"021 000 000"}]}'),
    'a tradesman with no source');
  perform pg_temp.refuses(format('select home.staff_reply(%L, null, null)', v_req),
    'a reply with nothing in it');

  v_msg := home.staff_reply(v_req, 'Hi Alice — it''s the washer.',
    '{"diagnosis":"Worn tap washer","verdict":"diy","steps":["Turn off the water","Swap the washer"],
      "parts":[{"item":"15mm tap washer","where":"Mitre 10","approxNzd":"5"}],
      "tradies":[{"name":"Drip Co","phone":null,"url":null,"source":"https://example.invalid/drip","calloutNzd":"90","totalNzd":"120-150"}]}'::jsonb);
  insert into ids values ('msg1', v_msg);
  perform home.staff_mark_emailed(v_msg);

  reset role;
  select * into v_after from home.snags where id = v_snag;
  perform pg_temp.expect(v_after.status = v_before.status, 'answering does not start the job');
  perform pg_temp.expect(v_after.updated_at = v_before.updated_at, 'answering does not touch the job');
  perform pg_temp.expect(v_after.parts = v_before.parts, 'answering does not fill the shopping list');
  perform pg_temp.expect(
    (select staff_id from home.snag_advice where snag_id = v_snag) = '5ab0a110-0000-4000-8000-00000000005a',
    'the advice says SnagHQ wrote it');
  perform pg_temp.expect(
    (select source like 'SnagHQ · %' from home.snag_advice where snag_id = v_snag),
    'the advice source line names SnagHQ');
  perform pg_temp.expect(
    (select status from home.support_requests where id = v_req) = 'replied',
    'a reply puts the ball in the household''s court');
  set local role authenticated;

  perform pg_temp.act('alice');
  perform pg_temp.expect((select count(*) from home.support_messages) = 1,
    'the household sees the reply and not the internal note');
  perform pg_temp.expect((select emailed_at is not null from home.support_messages), 'the reply says it was emailed');
  perform pg_temp.expect((select count(*) from home.snag_advice where snag_id = v_snag) = 1,
    'the household sees the assessment');

  perform home.add_support_message(v_req, 'Thanks — which size washer?');
  perform pg_temp.expect(
    (select status from home.support_requests where id = v_req) = 'waiting',
    'a follow-up puts it back with SnagHQ');

  perform pg_temp.act('bob');
  perform pg_temp.expect((select count(*) from home.support_messages) = 0,
    'another household sees no messages');
  perform pg_temp.refuses(format('select home.add_support_message(%L, %L)', v_req, 'Hello'),
    'another household adding to the thread');
end;
$$;

-- ---------------------------------------------------------------- access lapses on its own

do $$
declare
  v_req uuid := (select id from ids where name = 'req1');
  v_snag uuid := (select id from ids where name = 'alice_snag');
  v_alice_hh text := (select id from ids where name = 'alice_hh');
  v_closed jsonb;
begin
  reset role;
  update home.support_requests
  set status = 'replied', last_staff_reply_at = now() - interval '15 days'
  where id = v_req;
  set local role authenticated;

  perform pg_temp.act('sam');
  perform pg_temp.refuses(format('select home.staff_request_page(%L)', v_req),
    'opening a question fourteen days after the last reply');
  perform pg_temp.expect(not home.staff_can_read_file(v_alice_hh || '/tap.jpg'),
    'the photograph stops being readable when access lapses');
  perform pg_temp.refuses(format('select home.staff_reply(%L, %L)', v_req, 'Still there?'),
    'replying after access lapsed');
  v_closed := home.staff_queue('closed');
  perform pg_temp.expect(jsonb_array_length(v_closed -> 'rows') = 1, 'a lapsed question is in Closed');
  perform pg_temp.expect(v_closed -> 'rows' -> 0 -> 'job' = 'null'::jsonb,
    'a lapsed question carries nothing about the job');
  perform pg_temp.expect(v_closed -> 'rows' -> 0 ->> 'closed_by' = 'expired', 'and says it lapsed');

  perform pg_temp.act('alice');
  perform pg_temp.refuses(format('select home.add_support_message(%L, %L)', v_req, 'Hello?'),
    'following up a lapsed question');
  insert into ids values ('req2', (home.create_support_request(v_snag, 'The new washer drips too')).id);
  perform pg_temp.expect(
    (select closed_by from home.support_requests where id = v_req) = 'expired',
    'asking again closes the lapsed one');

  perform pg_temp.act('sam');
  perform pg_temp.expect(home.staff_can_read_file(v_alice_hh || '/tap.jpg'), 'a new question shares it again');
end;
$$;

-- ---------------------------------------------------------------- closing ends it at once

do $$
declare
  v_req uuid := (select id from ids where name = 'req2');
  v_snag uuid := (select id from ids where name = 'alice_snag');
  v_alice_hh text := (select id from ids where name = 'alice_hh');
begin
  perform pg_temp.act('alice');
  perform home.close_support_request(v_req);
  perform home.close_support_request(v_req);  -- twice is not an error

  perform pg_temp.act('sam');
  perform pg_temp.refuses(format('select home.staff_request_page(%L)', v_req), 'opening a closed question');
  perform pg_temp.refuses(format('select home.staff_close_request(%L, %L)', v_req, 'resolved'),
    'closing a closed question');
  perform pg_temp.expect(not home.staff_can_read_file(v_alice_hh || '/tap.jpg'),
    'closing stops the photograph being readable');

  -- The household can still paste its own assessment over SnagHQ's.
  perform pg_temp.act('alice');
  perform home.record_snag_advice(v_snag, 'My own answer', 'diy', 'Pasted 25 Sep');

  reset role;
  perform pg_temp.expect(
    (select staff_id is null and created_by is not null from home.snag_advice where snag_id = v_snag),
    'a paste replaces SnagHQ''s authorship rather than carrying both');
end;
$$;

do $$ begin raise notice 'support_access: every check passed'; end $$;

rollback;
