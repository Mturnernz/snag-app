-- What an emailed bill says beyond its total — replayed through the functions
-- the edge function and the app call, and checked.
--
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/emailed_bills_say_more.sql
--
-- Run it against a local stack, never the live project: it inserts an auth
-- user. One transaction, rolled back at the end. The papers are the live job's
-- (`20261030090100`):
--
--   * a card takes the spelling the household's prices already use;
--   * Kitchen Mania's "less deposit paid" is kept, and allocating records it,
--     and the balance it says was paid is dated by the paper, not the press;
--   * a progress claim allocated against the deck quote lands where the quote
--     sits, linked — and Committed counts the quote once;
--   * the quote chosen on a card is kept and is what Allocate links, and
--     choosing no quote is kept too;
--   * a card moves to another job in the same home, and to nowhere else.

begin;

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
  is_sso_user, is_anonymous
) values (
  '00000000-0000-0000-0000-000000000000', '5ce9a410-0000-4000-8000-000000000003',
  'authenticated', 'authenticated', 'more@example.invalid', '',
  now(), now(), now(), '{}', '{}', false, false
), (
  '00000000-0000-0000-0000-000000000000', '5ce9a410-0000-4000-8000-000000000004',
  'authenticated', 'authenticated', 'neighbour@example.invalid', '',
  now(), now(), now(), '{}', '{}', false, false
);

create temp table ids (name text primary key, id uuid);
grant all on ids to authenticated, service_role;

create function pg_temp.expect(ok boolean, label text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then
    raise exception 'FAILED: %', label;
  end if;
  raise notice 'ok  %', label;
end;
$$;

create function pg_temp.refuses(statement text, words text, label text) returns void language plpgsql as $$
begin
  execute statement;
  raise exception 'FAILED: % — it was allowed', label;
exception when others then
  if sqlerrm like 'FAILED:%' then raise; end if;
  if position(words in sqlerrm) = 0 then
    raise exception 'FAILED: % — refused with "%"', label, sqlerrm;
  end if;
  raise notice 'ok  %', label;
end;
$$;

grant execute on function pg_temp.expect(boolean, text) to authenticated, service_role;
grant execute on function pg_temp.refuses(text, text, text) to authenticated, service_role;

-- ── a neighbour's home, with a job of its own ──────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"5ce9a410-0000-4000-8000-000000000004","role":"authenticated"}';

do $$
declare
  prop uuid;
begin
  perform home.upsert_profile('Neighbour');
  perform home.create_household('Next door', 'Next door');
  select id into prop from home.properties limit 1;
  insert into ids values ('elsewhere', (home.create_project(p_property_id => prop, p_name => 'Their fence')).id);
end;
$$;

-- ── the household: two jobs, the builder's deck quote agreed ───────────────
set local request.jwt.claims = '{"sub":"5ce9a410-0000-4000-8000-000000000003","role":"authenticated"}';

do $$
declare
  prop uuid;
  roof uuid;
  kitchen uuid;
begin
  perform home.upsert_profile('More');
  perform home.create_household('More house', 'More house');
  select id into prop from home.properties
   where household_id = (select household_id from home.household_members
                          where profile_id = '5ce9a410-0000-4000-8000-000000000003');
  roof := (home.create_project(p_property_id => prop, p_name => 'Main roof and deck')).id;
  kitchen := (home.create_project(p_property_id => prop, p_name => 'Kitchen')).id;
  insert into ids values ('roof', roof), ('kitchen', kitchen);

  insert into ids values ('deck', (home.create_quote(
    p_project_id => roof, p_supplier => 'ReliaBuilder', p_detail => 'Deck and sub structure replacement',
    p_amount => 49482.20, p_kind => 'quote', p_status => 'accepted', p_invoice_number => 'QU-0111')).id);

  insert into ids values ('v3', (home.create_quote(
    p_project_id => kitchen, p_supplier => 'Kitchen Mania', p_detail => 'Deposit',
    p_amount => 8244.11, p_kind => 'invoice', p_invoice_number => 'V3')).id);
end;
$$;

-- ── the cards arrive, as the service role ──────────────────────────────────
reset role;
set local role service_role;

do $$
declare
  roof uuid := (select id from ids where name = 'roof');
  kitchen uuid := (select id from ids where name = 'kitchen');
  me uuid := '5ce9a410-0000-4000-8000-000000000003';
begin
  insert into ids values ('claim', (home.file_emailed_bill(
    p_project_id => roof, p_sender_id => me, p_source_ref => 'email-claim',
    p_supplier => 'RELIABUILDER LIMITED', p_detail => 'Deck — progress payment 45%',
    p_amount => 22266.99, p_invoice_number => 'INV-0182', p_dated => '2026-08-15',
    p_document_paths => array['h/docs/1-0-INV-0182.pdf'])).id);

  insert into ids values ('final', (home.file_emailed_bill(
    p_project_id => kitchen, p_sender_id => me, p_source_ref => 'email-final',
    p_supplier => 'Kitchen Mania Limited', p_detail => 'KITCHEN, Supply and install',
    p_amount => 27480.37, p_already_paid => 8244.11, p_invoice_number => 'INV-15879',
    p_dated => '2026-06-30', p_paid => true, p_paid_evidence => 'PAID — thank you',
    p_document_paths => array['h/docs/1-0-Invoice INV-15879.pdf'])).id);

  -- Two more of the builder's bills, for choosing on the card.
  insert into ids values ('chosen', (home.file_emailed_bill(
    p_project_id => roof, p_sender_id => me, p_source_ref => 'email-chosen',
    p_supplier => 'RELIABUILDER LIMITED', p_detail => 'Progress payment - 30%',
    p_amount => 14844.66, p_invoice_number => 'INV-0178')).id);
  insert into ids values ('variations', (home.file_emailed_bill(
    p_project_id => roof, p_sender_id => me, p_source_ref => 'email-variations',
    p_supplier => 'RELIABUILDER LIMITED', p_detail => 'Variations',
    p_amount => 5587.85, p_invoice_number => 'INV-0184')).id);

  -- Wrongly addressed: the roof job's address, a kitchen paper.
  insert into ids values ('stray', (home.file_emailed_bill(
    p_project_id => roof, p_sender_id => me, p_source_ref => 'email-stray',
    p_supplier => 'Kitchen Mania', p_detail => 'Handles', p_amount => 312.50,
    p_document_paths => array['h/docs/1-0-Handles.pdf'])).id);

  -- A deduction that is the whole bill, or a quote's, is not kept.
  insert into ids values ('odd', (home.file_emailed_bill(
    p_project_id => kitchen, p_sender_id => me, p_source_ref => 'email-odd',
    p_supplier => 'Somebody', p_amount => 100, p_already_paid => 100)).id);
end;
$$;

-- ── what landed, as the household ──────────────────────────────────────────
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"5ce9a410-0000-4000-8000-000000000003","role":"authenticated"}';

do $$
declare
  r home.invoice_reviews;
  q home.project_quotes;
  committed numeric;
begin
  select * into r from home.invoice_reviews where id = (select id from ids where name = 'claim');
  perform pg_temp.expect(r.supplier = 'ReliaBuilder', 'a card takes the spelling already on the job');

  select * into r from home.invoice_reviews where id = (select id from ids where name = 'final');
  perform pg_temp.expect(r.supplier = 'Kitchen Mania', 'and the household’s spelling from another job');
  perform pg_temp.expect(r.already_paid = 8244.11, 'what the paper says was paid before is kept');

  select * into r from home.invoice_reviews where id = (select id from ids where name = 'odd');
  perform pg_temp.expect(r.already_paid is null, 'a deduction that is the whole bill is not');

  -- The pencil corrects it: a deduction is a reading, and the card's figure is the answer.
  r := home.update_invoice_review(p_review_id => (select id from ids where name = 'odd'), p_already_paid => 40);
  perform pg_temp.expect(r.already_paid = 40, 'the pencil can say what was paid before');
  perform pg_temp.refuses(format('select home.update_invoice_review(p_review_id => %L, p_already_paid => 100)',
    (select id from ids where name = 'odd')), 'less than the bill', 'but not the whole bill');
  r := home.update_invoice_review(p_review_id => (select id from ids where name = 'odd'), p_clear => array['already_paid']);
  perform pg_temp.expect(r.already_paid is null, 'and an emptied box clears it');
  r := home.update_invoice_review(p_review_id => (select id from ids where name = 'odd'), p_already_paid => 40);
  r := home.update_invoice_review(p_review_id => (select id from ids where name = 'odd'), p_kind => 'quote');
  perform pg_temp.expect(r.already_paid is null, 'a quote deducts nothing');

  -- The claim: allocated against the deck quote.
  q := home.approve_invoice_review(
    p_review_id => (select id from ids where name = 'claim'),
    p_against_quote_id => (select id from ids where name = 'deck'));
  perform pg_temp.expect(q.against_quote_id = (select id from ids where name = 'deck'), 'a claim is allocated linked');
  perform pg_temp.expect(q.project_id = (select id from ids where name = 'roof') and q.element_id is null,
    'and lands where its contract sits');
  select committed_total into committed from home.projects_with_totals where id = (select id from ids where name = 'roof');
  perform pg_temp.expect(committed = 49482.20, 'Committed counts the contract once');

  -- The quote chosen on a card is kept, and Allocate links it with nothing passed.
  r := home.set_invoice_review_claim((select id from ids where name = 'chosen'), (select id from ids where name = 'deck'));
  perform pg_temp.expect(r.claim_decided and r.against_quote_id = (select id from ids where name = 'deck'),
    'the quote chosen on a card is kept on it');
  q := home.approve_invoice_review(p_review_id => (select id from ids where name = 'chosen'));
  perform pg_temp.expect(q.against_quote_id = (select id from ids where name = 'deck'), 'and Allocate links it');

  -- Choosing no quote is kept too, and the bill counts on its own.
  r := home.set_invoice_review_claim((select id from ids where name = 'variations'), null);
  perform pg_temp.expect(r.claim_decided and r.against_quote_id is null, 'choosing no quote is an answer');
  q := home.approve_invoice_review(p_review_id => (select id from ids where name = 'variations'));
  perform pg_temp.expect(q.against_quote_id is null, 'and the bill lands unlinked');
  select committed_total into committed from home.projects_with_totals where id = (select id from ids where name = 'roof');
  perform pg_temp.expect(committed = 55070.05, 'counted on its own beside the contract');

  -- A card cannot choose a bill, a quote on another job, or be a quote's stage when it is not a bill.
  perform pg_temp.refuses(format('select home.set_invoice_review_claim(%L, %L)',
    (select id from ids where name = 'stray'), (select id from ids where name = 'v3')),
    'not of another bill', 'a card cannot be part of a bill');
  perform pg_temp.refuses(format('select home.set_invoice_review_claim(%L, %L)',
    (select id from ids where name = 'final'), (select id from ids where name = 'deck')),
    'belongs to a different job', 'a card cannot be part of another job''s quote');

  -- The final invoice: the deposit recorded, the balance dated by the paper.
  q := home.approve_invoice_review(
    p_review_id => (select id from ids where name = 'final'), p_record_already_paid => true);
  perform pg_temp.expect(
    (select count(*) from home.project_payments where quote_id = q.id) = 2, 'two payments: the deposit and the balance');
  perform pg_temp.expect(exists (
    select 1 from home.project_payments
    where quote_id = q.id and amount = 8244.11 and paid_on is null and reference = 'Paid before this invoice'),
    'the deposit is undated, because the paper does not say when');
  perform pg_temp.expect(exists (
    select 1 from home.project_payments
    where quote_id = q.id and amount = 19236.26 and paid_on = '2026-06-30'),
    'the balance is dated by the paper, not by the press');
  perform pg_temp.expect(
    (select unpaid from home.project_quotes_with_totals where id = q.id) = 0, 'and nothing is left owing');

  -- A claim against a bill, or a contract on another job, is refused.
  perform pg_temp.refuses(format('select home.approve_invoice_review(p_review_id => %L, p_against_quote_id => %L)',
    (select id from ids where name = 'stray'), (select id from ids where name = 'v3')),
    'not another bill', 'a claim on a bill rather than a quote');

  -- The stray card moves to the kitchen, and nowhere outside this home. What
  -- was chosen on the roof job means nothing in the kitchen, so it goes.
  perform home.set_invoice_review_claim((select id from ids where name = 'stray'), (select id from ids where name = 'deck'));
  perform pg_temp.refuses(format('select home.move_invoice_review(%L, %L)',
    (select id from ids where name = 'stray'), (select id from ids where name = 'elsewhere')),
    'not linked to that property', 'a card cannot move to a job in somebody else’s home');
  r := home.move_invoice_review((select id from ids where name = 'stray'), (select id from ids where name = 'kitchen'));
  perform pg_temp.expect(r.project_id = (select id from ids where name = 'kitchen'), 'a card moves to another job in the home');
  perform pg_temp.expect(r.against_quote_id is null and not r.claim_decided, 'and leaves its quote behind');
  perform pg_temp.refuses(format('select home.move_invoice_review(%L, %L)',
    (select id from ids where name = 'claim'), (select id from ids where name = 'kitchen')),
    'already been ruled on', 'an allocated card stays where it was allocated');
end;
$$;

-- ── the spelling rule, as the functions that call it ───────────────────────
-- Only SECURITY DEFINER functions call it, so nobody else is granted it.
reset role;

do $$
begin
  -- The twin of `businessKey`: the same answers `checks.test.ts` pins.
  perform pg_temp.expect(home.business_key('RELIABUILDER LIMITED') = 'reliabuilder', 'Limited is not part of the name');
  perform pg_temp.expect(home.business_key('Kitchen Mania Ltd.') = home.business_key('kitchenmania'), 'nor Ltd., nor spaces');
  perform pg_temp.expect(home.business_key('Fisher & Paykel NZ') = 'fisherpaykel', 'nor NZ, nor punctuation');
  perform pg_temp.expect(home.business_key('Co-op Builders') = 'opbuilders', 'and Co goes wherever it is a word, as in papers.ts');
  perform pg_temp.expect(home.business_key('  ') is null, 'a blank name is no business');
end;
$$;

rollback;
