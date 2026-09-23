-- Five renovations, replayed through the app's own functions, checked against
-- figures worked out by hand.
--
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/project_scenarios.sql
--
-- Run it against a local stack (`supabase start`), never the live project: it
-- inserts an auth user. Everything happens inside one transaction that is
-- rolled back at the end, so a run leaves nothing behind either way.
--
-- It exists because the rollup views are the most dangerous arithmetic in the
-- app and no jest suite can reach them. The five scenarios are the ones that
-- found `20260923090000`'s bug: a signed quote at a scope hid every other
-- supplier's bills there, so an ensuite read $1,450 committed against $3,929
-- invoiced, and a renovation lost its architect, engineer and council bills.
--
-- Each check asserts two things:
--   * committed is what the paperwork says, and
--   * the supplier rows sum to committed — the invariant the money model is
--     built on, which is how "who is owed what" and the total stay one rule.

begin;

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
  is_sso_user, is_anonymous
) values (
  '00000000-0000-0000-0000-000000000000', '5ce9a410-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'scenarios@example.invalid', '',
  now(), now(), now(), '{}', '{}', false, false
);

-- A price, as the Add sheet writes one. Scope is the item, else the part, else
-- the whole job, exactly as `create_quote` insists.
create function pg_temp.q(
  p uuid, sup text, amt numeric,
  kind text default 'invoice', st text default 'accepted',
  el uuid default null, it uuid default null,
  against uuid default null, answers uuid default null, through uuid default null,
  incl boolean default true, basis text default 'fixed'
) returns uuid language sql as $$
  select (home.create_quote(
    p_item_id => it, p_element_id => el,
    p_project_id => case when it is null and el is null then p end,
    p_supplier => sup, p_detail => null, p_amount => amt, p_amount_incl_gst => incl,
    p_kind => kind::home.project_quote_kind, p_status => st::home.project_quote_status,
    p_basis => basis::home.project_quote_basis, p_dated => null, p_notes => null,
    p_supersedes_line_id => answers, p_photo_paths => null, p_document_paths => null,
    p_due_on => null, p_billed_through_id => through, p_settles_milestone_id => null,
    p_against_quote_id => against
  )).id
$$;

create function pg_temp.set_aside(quote_id uuid, name text, amt numeric) returns uuid language sql as $$
  select (home.add_quote_line(
    p_quote_id => quote_id, p_name => name, p_detail => null, p_amount => amt,
    p_amount_incl_gst => true, p_is_allowance => true, p_allowance_kind => 'pc_sum',
    p_additional => false, p_attendance_pct => null
  )).id
$$;

create function pg_temp.line(quote_id uuid, name text, amt numeric) returns uuid language sql as $$
  select (home.add_quote_line(
    p_quote_id => quote_id, p_name => name, p_detail => null, p_amount => amt,
    p_amount_incl_gst => true, p_is_allowance => false, p_allowance_kind => null,
    p_additional => false, p_attendance_pct => null
  )).id
$$;

create function pg_temp.check(project uuid, label text, want_committed numeric) returns void
language plpgsql as $$
declare
  got numeric;
  suppliers numeric;
begin
  select committed_total into got from home.projects_with_totals where id = project;
  select sum(committed) into suppliers from home.project_supplier_totals where project_id = project;
  if got is distinct from want_committed then
    raise exception '% — committed is %, the paperwork says %', label, got, want_committed;
  end if;
  if suppliers is distinct from got then
    raise exception '% — supplier rows sum to %, committed is %', label, suppliers, got;
  end if;
  raise notice 'ok  %: committed % and the supplier rows agree', label, got;
end;
$$;

grant execute on function pg_temp.q(uuid, text, numeric, text, text, uuid, uuid, uuid, uuid, uuid, boolean, text) to authenticated;
grant execute on function pg_temp.set_aside(uuid, text, numeric) to authenticated;
grant execute on function pg_temp.line(uuid, text, numeric) to authenticated;
grant execute on function pg_temp.check(uuid, text, numeric) to authenticated;

set local role authenticated;
set local request.jwt.claims = '{"sub":"5ce9a410-0000-4000-8000-000000000001","role":"authenticated"}';

do $$
declare
  prop uuid;
  p uuid;
  c uuid; v uuid; x uuid;
  el_kitchen uuid; el_bath uuid; el_laundry uuid; el_living uuid; el_outside uuid;
  l_tiles uuid; l_fixtures uuid; l_laundry uuid; l_hardware uuid;
  i_tiles uuid; i_fixtures uuid; i_laundry uuid; i_hardware uuid; i_skylight uuid;
begin
  perform home.upsert_profile('Scenarios');
  perform home.create_household('Scenario house', 'Home');
  select id into prop from home.properties limit 1;

  -- ── 1 · an ensuite, $6k, four suppliers and one signed quote ────────────
  -- The plumber's signed quote must hide only the plumber's own bill. The
  -- plumber billed $160 over the quote; that shows as still-to-bill of -160,
  -- which is the over-billing signal, not a figure to hide.
  p := (home.create_project(p_property_id => prop, p_name => 'S1 Ensuite', p_status => 'underway',
        p_summary => null, p_rooms => array['Bathroom'], p_started_on => null, p_target_on => null,
        p_finished_on => null, p_budget => 6000, p_budget_incl_gst => true,
        p_photo_paths => null, p_document_paths => null)).id;
  perform pg_temp.q(p, 'Bunnings', 899);
  perform pg_temp.q(p, 'Tile Space', 1240);
  c := pg_temp.q(p, 'Pete''s Plumbing', 1450, 'quote');
  perform pg_temp.q(p, 'Pete''s Plumbing', 1610, against => c);
  perform pg_temp.q(p, 'Resene', 180);
  perform pg_temp.check(p, 'S1 ensuite', 3769);

  -- ── 2 · a kitchen: contract, a variation, direct appliances, trades ─────
  p := (home.create_project(p_property_id => prop, p_name => 'S2 Kitchen', p_status => 'underway',
        p_summary => null, p_rooms => array['Kitchen'], p_started_on => null, p_target_on => null,
        p_finished_on => null, p_budget => 40000, p_budget_incl_gst => true,
        p_photo_paths => null, p_document_paths => null)).id;
  c := pg_temp.q(p, 'Kitchen Things', 28000, 'quote');
  perform pg_temp.q(p, 'Kitchen Things', 11200, against => c);
  perform pg_temp.q(p, 'Kitchen Things', 1200, 'quote');
  perform pg_temp.q(p, 'Kitchen Things', 14000, against => c);
  perform pg_temp.q(p, 'Noel Leeming', 6400);
  perform pg_temp.q(p, 'Sparky Electrical', 1800);
  x := pg_temp.q(p, 'Pete''s Plumbing', 950, 'quote');
  perform pg_temp.q(p, 'Pete''s Plumbing', 950, against => x);
  perform pg_temp.check(p, 'S2 kitchen', 38350);

  -- ── 3 · a bathroom with a builder: two set-asides, settled two ways ─────
  -- Tiles bought direct: the $6,000 leaves the contract and Tile Depot's $7,300
  -- counts on its own. Fixtures supplied by the builder at $5,100: the fixed
  -- contract absorbs the difference. 42,000 − 6,000 − 900 + 7,300 = 42,400.
  p := (home.create_project(p_property_id => prop, p_name => 'S3 Bathroom', p_status => 'underway',
        p_summary => null, p_rooms => array['Bathroom'], p_started_on => null, p_target_on => null,
        p_finished_on => null, p_budget => 45000, p_budget_incl_gst => true,
        p_photo_paths => null, p_document_paths => null)).id;
  select id into el_bath from home.project_elements where project_id = p limit 1;
  c := pg_temp.q(p, 'BuildRight', 42000, 'quote');
  perform pg_temp.line(c, 'Labour and building', 26000);
  perform pg_temp.line(c, 'Waterproofing', 4000);
  l_tiles := pg_temp.set_aside(c, 'Tiles supply', 6000);
  l_fixtures := pg_temp.set_aside(c, 'Fixtures and fittings', 6000);
  i_tiles := (home.create_item(el_bath, 'Tiles', null, 'considering')).id;
  i_fixtures := (home.create_item(el_bath, 'Fixtures', null, 'considering')).id;
  perform home.set_item_set_aside(i_tiles, l_tiles);
  perform home.set_item_set_aside(i_fixtures, l_fixtures);
  x := pg_temp.q(p, 'Tile Depot', 7300, 'quote', it => i_tiles, answers => l_tiles);
  perform pg_temp.q(p, 'Tile Depot', 7300, it => i_tiles, against => x);
  perform pg_temp.q(p, 'BuildRight', 5100, 'quote', it => i_fixtures, answers => l_fixtures, through => c);
  perform pg_temp.q(p, 'BuildRight', 20000, against => c);
  perform pg_temp.q(p, 'BuildRight', 12000, against => c);
  perform pg_temp.check(p, 'S3 bathroom', 42400);

  -- ── 4 · a downstairs conversion: architect, council, engineer, builder ──
  -- The laundry set-aside is chosen (Kitchen Mania, $9,400, direct); the
  -- bathroom hardware is still open and its only quote is not agreed.
  -- 14,000 + 4,820 + 2,300 + (185,000 − 8,000 − 12,000 open) + 12,000 open + 9,400
  --   = 207,520, of which 12,000 is the open set-aside.
  -- Known limit: a bill from the builder *before* the contract (their $800
  -- investigation) reads as a draw on it once it is signed, because nothing
  -- on the row can tell the two apart. It is left out here on purpose.
  p := (home.create_project(p_property_id => prop, p_name => 'S4 Downstairs', p_status => 'underway',
        p_summary => null, p_rooms => array['Laundry', 'Bathroom', 'Living room'], p_started_on => null,
        p_target_on => null, p_finished_on => null, p_budget => 230000, p_budget_incl_gst => true,
        p_photo_paths => null, p_document_paths => null)).id;
  select id into el_laundry from home.project_elements where project_id = p and room = 'Laundry';
  select id into el_bath from home.project_elements where project_id = p and room = 'Bathroom';
  x := pg_temp.q(p, 'Studio North', 14000, 'quote', basis => 'estimate');
  perform pg_temp.q(p, 'Studio North', 4200, against => x);
  perform pg_temp.q(p, 'Studio North', 3900, against => x);
  perform pg_temp.q(p, 'Auckland Council', 4820);
  perform pg_temp.q(p, 'Hutton Engineering', 2300);
  c := pg_temp.q(p, 'ReliaBuilder', 185000, 'quote');
  perform pg_temp.line(c, 'Building work', 165000);
  l_laundry := pg_temp.set_aside(c, 'Laundry fixtures and fittings', 8000);
  l_hardware := pg_temp.set_aside(c, 'Bathroom hardware', 12000);
  i_laundry := (home.create_item(el_laundry, 'Laundry fixtures and fittings', null, 'considering')).id;
  i_hardware := (home.create_item(el_bath, 'Bathroom hardware', null, 'considering')).id;
  perform home.set_item_set_aside(i_laundry, l_laundry);
  perform home.set_item_set_aside(i_hardware, l_hardware);
  perform pg_temp.q(p, 'ReliaBuilder', 46000, against => c);
  perform pg_temp.q(p, 'Kitchen Mania', 9400, 'quote', it => i_laundry, answers => l_laundry);
  perform pg_temp.q(p, 'Plumbing World', 10300, 'quote', 'tbc', it => i_hardware);
  perform pg_temp.check(p, 'S4 downstairs', 207520);
  if (select allowance_open from home.projects_with_totals where id = p) <> 12000 then
    raise exception 'S4 downstairs — the open set-aside should be 12,000';
  end if;

  -- ── 5 · a whole house and an extension: ten suppliers, GST both ways ────
  p := (home.create_project(p_property_id => prop, p_name => 'S5 Whole house', p_status => 'underway',
        p_summary => null, p_rooms => array['Kitchen', 'Living room', 'Bathroom', 'Outside'],
        p_started_on => null, p_target_on => null, p_finished_on => null, p_budget => 420000,
        p_budget_incl_gst => true, p_photo_paths => null, p_document_paths => null)).id;
  select id into el_kitchen from home.project_elements where project_id = p and room = 'Kitchen';
  select id into el_living from home.project_elements where project_id = p and room = 'Living room';
  select id into el_bath from home.project_elements where project_id = p and room = 'Bathroom';
  select id into el_outside from home.project_elements where project_id = p and room = 'Outside';
  x := pg_temp.q(p, 'Arch & Co', 38000, 'quote', basis => 'estimate');
  perform pg_temp.q(p, 'Arch & Co', 12000, against => x);
  perform pg_temp.q(p, 'Arch & Co', 9500, against => x);
  perform pg_temp.q(p, 'Geotech NZ', 3450);
  x := pg_temp.q(p, 'Hutton Engineering', 11500, 'quote', incl => false);
  perform pg_temp.q(p, 'Hutton Engineering', 6000, against => x, incl => false);
  perform pg_temp.q(p, 'Auckland Council', 10240);
  perform pg_temp.q(p, 'Auckland Council', 1150);
  x := pg_temp.q(p, 'Kiwi Builders', 185000, 'quote', basis => 'estimate');
  perform pg_temp.q(p, 'Kiwi Builders', 40000, against => x);
  perform pg_temp.q(p, 'Kiwi Builders', 38000, against => x);
  perform pg_temp.q(p, 'Roof Pro', 32000, 'quote', el => el_outside);
  perform pg_temp.q(p, 'Top Roofing', 36500, 'quote', 'declined', el => el_outside);
  x := pg_temp.q(p, 'Sparky Electrical', 24000, 'quote', incl => false, basis => 'estimate');
  perform pg_temp.q(p, 'Sparky Electrical', 15000, against => x, incl => false);
  perform pg_temp.q(p, 'Sparky Electrical', 3200, 'quote', incl => false);
  perform pg_temp.q(p, 'Pete''s Plumbing', 18500, 'quote', el => el_bath);
  x := pg_temp.q(p, 'Kitchen Mania', 41000, 'quote', el => el_kitchen);
  perform pg_temp.q(p, 'Kitchen Mania', 20500, el => el_kitchen, against => x);
  i_skylight := (home.create_item(el_living, 'Skylight', null, 'considering')).id;
  perform pg_temp.q(p, 'Velux Direct', 4900, 'quote', 'tbc', it => i_skylight);
  perform home.set_item_excluded(i_skylight, true);
  -- 38,000 + 3,450 + 13,225 + 11,390 + 185,000 + 32,000 + 31,280 + 18,500 + 41,000
  perform pg_temp.check(p, 'S5 whole house', 373845);
end;
$$;

rollback;
