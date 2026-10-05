-- A consumable is used with things at its own place, and only through
-- set_thing_uses. Replays the dishwasher tablets, the heat pump filters that
-- fit two heads, and the weed killer that goes with nothing, then rolls back.
--
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/thing_uses.sql

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

do $$
declare
  v_mike uuid; v_kim uuid;
  v_house uuid; v_place uuid; v_other_house uuid; v_other_place uuid;
  v_dishwasher uuid; v_head1 uuid; v_head2 uuid; v_tabs uuid; v_filters uuid; v_weed uuid;
  v_theirs uuid;
  v_used jsonb; v_uses jsonb;
begin
  v_mike := pg_temp.make_login('Mike');
  select (home.create_household('32 Le Roy', '32 Le Roy')).id into v_house;
  select id into v_place from home.properties where household_id = v_house;

  v_dishwasher := (home.create_thing(v_place, 'appliance', 'Dishwasher', 'Kitchen')).id;
  v_head1 := (home.create_thing(v_place, 'appliance', 'Heat pump head', 'Lounge')).id;
  v_head2 := (home.create_thing(v_place, 'appliance', 'Heat pump head', 'Master bedroom')).id;
  v_tabs := (home.create_thing(v_place, 'consumable', 'Dishwasher tablets', 'Kitchen', p_make => 'Finish')).id;
  v_filters := (home.create_thing(v_place, 'consumable', 'Heat pump filters', 'Garage')).id;
  v_weed := (home.create_thing(v_place, 'consumable', 'Weed killer', 'Garage', p_make => 'Roundup')).id;

  -- One, and several.
  perform home.set_thing_uses(v_tabs, array[v_dishwasher]);
  perform home.set_thing_uses(v_filters, array[v_head1, v_head2]);

  select used_with into v_used from home.things_with_details where id = v_filters;
  if jsonb_array_length(v_used) <> 2 then
    raise exception 'The filters should be used with two heads, not %', v_used;
  end if;
  select uses into v_uses from home.things_with_details where id = v_dishwasher;
  if jsonb_array_length(v_uses) <> 1 or v_uses->0->>'name' <> 'Dishwasher tablets' then
    raise exception 'The dishwasher should use the tablets, not %', v_uses;
  end if;

  -- None is an answer.
  select used_with into v_used from home.things_with_details where id = v_weed;
  if v_used <> '[]'::jsonb then
    raise exception 'The weed killer goes with nothing, not %', v_used;
  end if;

  -- The whole set is replaced.
  perform home.set_thing_uses(v_filters, array[v_head2]);
  if (select count(*) from home.thing_uses where consumable_id = v_filters) <> 1 then
    raise exception 'Replacing the set should leave one head';
  end if;

  -- Refusals.
  perform pg_temp.refused(format('select home.set_thing_uses(%L, array[%L]::uuid[])', v_dishwasher, v_head1),
    'an appliance used with something');
  perform pg_temp.refused(format('select home.set_thing_uses(%L, array[%L]::uuid[])', v_tabs, v_weed),
    'a consumable used with a consumable');

  v_kim := pg_temp.make_login('Kim');
  select (home.create_household('Kim''s', 'Kim''s')).id into v_other_house;
  select id into v_other_place from home.properties where household_id = v_other_house;
  v_theirs := (home.create_thing(v_other_place, 'appliance', 'Dishwasher', 'Kitchen')).id;

  perform pg_temp.refused(format('select home.set_thing_uses(%L, array[%L]::uuid[])', v_tabs, v_dishwasher),
    'somebody else''s consumable');

  perform pg_temp.act_as(v_mike);
  perform pg_temp.refused(format('select home.set_thing_uses(%L, array[%L]::uuid[])', v_tabs, v_theirs),
    'a thing at another place');

  -- Kim cannot read Mike's links.
  perform pg_temp.act_as(v_kim);
  set local role authenticated;
  if (select count(*) from home.thing_uses) <> 0 then
    raise exception 'Another household read the links';
  end if;
  reset role;

  -- Deleting the appliance takes the link, never the consumable.
  perform pg_temp.act_as(v_mike);
  delete from home.things where id = v_dishwasher;
  if exists (select 1 from home.thing_uses where consumable_id = v_tabs) then
    raise exception 'A link to a deleted appliance survived';
  end if;
  if not exists (select 1 from home.things where id = v_tabs) then
    raise exception 'Deleting the appliance took the tablets with it';
  end if;

  raise notice 'thing_uses: all good';
end $$;

rollback;
