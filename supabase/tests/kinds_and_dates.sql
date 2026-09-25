-- A project's dates in order, and a price's kind changed only where the money
-- can follow it (`20260927090000`).
--
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/kinds_and_dates.sql
--
-- Run it against a local stack, never the live project: it inserts an auth
-- user. One transaction, rolled back at the end, like `project_scenarios.sql`.
--
-- Every refusal is checked by its words, because the words are the point: a
-- constraint name or a 22008 raised at somebody who pressed a pill is the
-- failure these functions exist to prevent.

begin;

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
  is_sso_user, is_anonymous
) values (
  '00000000-0000-0000-0000-000000000000', '5ce9a410-0000-4000-8000-0000000000d7',
  'authenticated', 'authenticated', 'kinds@example.invalid', '',
  now(), now(), now(), '{}', '{}', false, false
);

-- Runs a statement that must be refused, and checks it was refused in words
-- containing `want`.
create function pg_temp.refuses(label text, statement text, want text) returns void
language plpgsql as $$
begin
  begin
    execute statement;
  exception when others then
    if position(want in sqlerrm) = 0 then
      raise exception '% — refused, but with "%" rather than "%"', label, sqlerrm, want;
    end if;
    raise notice 'ok  %: %', label, sqlerrm;
    return;
  end;
  raise exception '% — should have been refused', label;
end;
$$;

create function pg_temp.q(
  p uuid, sup text, amt numeric, kind text default 'invoice', st text default 'tbc',
  against uuid default null, through uuid default null
) returns uuid language sql as $$
  select (home.create_quote(
    p_item_id => null, p_element_id => null, p_project_id => p,
    p_supplier => sup, p_detail => null, p_amount => amt, p_amount_incl_gst => true,
    p_kind => kind::home.project_quote_kind, p_status => st::home.project_quote_status,
    p_basis => 'fixed', p_dated => null, p_notes => null,
    p_supersedes_line_id => null, p_photo_paths => null, p_document_paths => null,
    p_due_on => case when kind = 'invoice' then date '2026-10-20' end,
    p_billed_through_id => through, p_settles_milestone_id => null,
    p_against_quote_id => against
  )).id
$$;

grant execute on function pg_temp.refuses(text, text, text) to authenticated;
grant execute on function pg_temp.q(uuid, text, numeric, text, text, uuid, uuid) to authenticated;

set local role authenticated;
set local request.jwt.claims = '{"sub":"5ce9a410-0000-4000-8000-0000000000d7","role":"authenticated"}';

do $$
declare
  prop uuid;
  p uuid;
  roof uuid;
  bill uuid; contract uuid; claim uuid; host uuid; inner_bill uuid; pay uuid; other uuid;
  row home.project_quotes;
  invoiced numeric;
begin
  perform home.upsert_profile('Kinds');
  perform home.create_household('Kinds house', 'Home');
  select id into prop from home.properties limit 1;

  -- ── dates ──────────────────────────────────────────────────────────────
  perform pg_temp.refuses(
    'a project cannot be created finishing before it started',
    format($s$select home.create_project(p_property_id => %L, p_name => 'Roof', p_status => 'done',
      p_started_on => '2026-09-26', p_finished_on => '2024-06-25')$s$, prop),
    'can''t finish before it started');

  roof := (home.create_project(p_property_id => prop, p_name => 'Roof', p_status => 'done',
    p_started_on => '2024-05-25', p_finished_on => '2024-06-25')).id;

  perform pg_temp.refuses(
    'a start cannot be moved past the finish',
    format($s$select home.update_project(p_project_id => %L, p_started_on => '2026-09-26')$s$, roof),
    'can''t finish before it started');

  perform pg_temp.refuses(
    'a finish cannot be moved before the start',
    format($s$select home.update_project(p_project_id => %L, p_finished_on => '2024-01-01')$s$, roof),
    'can''t finish before it started');

  -- The same day is in order, and the client's move-to-meet writes exactly that.
  perform home.update_project(p_project_id => roof, p_started_on => '2024-06-25');
  if (select started_on from home.projects where id = roof) <> date '2024-06-25' then
    raise exception 'a start on the finish day should be kept';
  end if;
  raise notice 'ok  a start on the finish day is in order';

  -- Only one date set is never out of order.
  perform home.update_project(p_project_id => roof, p_clear => array['started_on']);
  raise notice 'ok  a finish with no start is in order';

  perform pg_temp.refuses(
    'a name past 80 characters is refused in words',
    format($s$select home.update_project(p_project_id => %L, p_name => %L)$s$, roof, repeat('r', 81)),
    '80 characters');

  perform home.update_project(p_project_id => roof, p_name => '  Roof and gutters  ');
  if (select name from home.projects where id = roof) <> 'Roof and gutters' then
    raise exception 'a rename should be trimmed and kept';
  end if;
  raise notice 'ok  a project can be renamed';

  -- ── kinds ──────────────────────────────────────────────────────────────
  p := (home.create_project(p_property_id => prop, p_name => 'Deck', p_status => 'underway')).id;

  -- A bill with a payment cannot become a quote: the payment would stop
  -- counting as Paid with nothing saying so.
  bill := pg_temp.q(p, 'Timber Co', 1150);
  pay := (home.add_payment(p_quote_id => bill, p_amount => 500)).id;
  perform pg_temp.refuses(
    'a paid bill cannot become a quote',
    format('select home.set_quote_kind(%L, %L)', bill, 'quote'),
    'A payment is recorded against it');

  perform home.delete_payment(pay);
  select invoiced_total into invoiced from home.projects_with_totals where id = p;
  if invoiced <> 1150 then raise exception 'the bill should be invoiced before, got %', invoiced; end if;

  row := home.set_quote_kind(bill, 'quote');
  if row.kind <> 'quote' or row.status <> 'tbc' or row.due_on is not null then
    raise exception 'a bill that becomes a quote should be tbc with no due date, got % % %', row.kind, row.status, row.due_on;
  end if;
  select coalesce(invoiced_total, 0) into invoiced from home.projects_with_totals where id = p;
  if invoiced <> 0 then raise exception 'a quote should not be invoiced, got %', invoiced; end if;
  raise notice 'ok  a bill becomes a quote nobody has agreed, and leaves Invoiced';

  -- Pressing the kind it already is changes nothing.
  row := home.set_quote_kind(bill, 'quote');
  if row.kind <> 'quote' then raise exception 'the same kind should be a no-op'; end if;
  raise notice 'ok  the same kind is a no-op';

  -- A turned-down quote that turns out to be a bill counts again.
  perform home.set_quote_status(bill, 'declined');
  row := home.set_quote_kind(bill, 'invoice');
  if row.kind <> 'invoice' or row.status <> 'tbc' then
    raise exception 'a declined quote that becomes a bill should count, got % %', row.kind, row.status;
  end if;
  select invoiced_total into invoiced from home.projects_with_totals where id = p;
  if invoiced <> 1150 then raise exception 'it should be invoiced again, got %', invoiced; end if;
  raise notice 'ok  a declined quote that becomes a bill counts again';

  perform pg_temp.refuses(
    'a receipt is not offered',
    format('select home.set_quote_kind(%L, %L)', bill, 'receipt'),
    'quote or an invoice');

  -- A contract with a claim against it cannot become a bill, and the claim
  -- cannot become a quote.
  contract := pg_temp.q(p, 'Deck Builders', 20000, 'quote', 'accepted');
  claim := pg_temp.q(p, 'Deck Builders', 5000, against => contract);
  perform pg_temp.refuses(
    'a contract with claims cannot become a bill',
    format('select home.set_quote_kind(%L, %L)', contract, 'invoice'),
    'progress bill is billed against it');
  perform pg_temp.refuses(
    'a claim cannot become a quote',
    format('select home.set_quote_kind(%L, %L)', claim, 'quote'),
    'progress bill against an agreed price');

  -- A quote broken into lines, or with a schedule, stays a quote.
  other := pg_temp.q(p, 'Stairs Ltd', 3000, 'quote');
  perform home.add_quote_line(p_quote_id => other, p_name => 'Treads', p_amount => 1000);
  perform pg_temp.refuses(
    'a quote broken into lines cannot become a bill',
    format('select home.set_quote_kind(%L, %L)', other, 'invoice'),
    'broken down into lines');

  other := pg_temp.q(p, 'Rails Ltd', 4000, 'quote', 'accepted');
  perform home.add_milestone(p_quote_id => other, p_name => 'Deposit', p_percent => 25);
  perform pg_temp.refuses(
    'a quote with a payment schedule cannot become a bill',
    format('select home.set_quote_kind(%L, %L)', other, 'invoice'),
    'payment schedule');

  -- A bill inside another bill, and the bill holding it, both stay bills.
  host := pg_temp.q(p, 'Main Contractor', 9000);
  inner_bill := pg_temp.q(p, 'Sparky', 900);
  perform home.update_quote(p_quote_id => inner_bill, p_billed_through_id => host);
  perform pg_temp.refuses(
    'a bill inside another cannot become a quote',
    format('select home.set_quote_kind(%L, %L)', inner_bill, 'quote'),
    'inside another bill');
  perform pg_temp.refuses(
    'a bill holding another cannot become a quote',
    format('select home.set_quote_kind(%L, %L)', host, 'quote'),
    'A bill is inside it');

  -- The general update no longer changes the kind — only its own function does
  -- — but a caller naming the kind it already is is not refused.
  perform pg_temp.refuses(
    'update_quote cannot change the kind',
    format('select home.update_quote(p_quote_id => %L, p_kind => %L)', host, 'quote'),
    'from its own pill');
  perform home.update_quote(p_quote_id => host, p_kind => 'invoice', p_supplier => 'Main Contractor Ltd');
  raise notice 'ok  update_quote naming the same kind still saves';

  raise notice 'kinds_and_dates: every check passed';
end;
$$;

rollback;
