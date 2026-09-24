-- One email, one card per paper — replayed through the functions the edge
-- functions and the app call, and checked.
--
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/emailed_papers.sql
--
-- Run it against a local stack, never the live project: it inserts an auth
-- user. One transaction, rolled back at the end.
--
-- The email it replays is the one that found the problem: a builder's variation
-- invoice, two subcontractors' variations addressed to the builder, a
-- certificate of compliance and a photo, forwarded as one. What must hold:
--
--   * each paper is its own card, and a retried webhook files none twice;
--   * the function deployed before `20260924120000` still files what it did;
--   * paperwork is filed and never allocated, and filing moves no figure;
--   * a quote is recorded as a quote nobody has agreed, not as a bill;
--   * reading again replaces only a blank card, and only with its own files.

begin;

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
  is_sso_user, is_anonymous
) values (
  '00000000-0000-0000-0000-000000000000', '5ce9a410-0000-4000-8000-000000000002',
  'authenticated', 'authenticated', 'papers@example.invalid', '',
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

-- ── the household, as its person ────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"5ce9a410-0000-4000-8000-000000000002","role":"authenticated"}';

do $$
declare
  prop uuid;
  p uuid;
begin
  perform home.upsert_profile('Papers');
  perform home.create_household('Papers house', 'Home');
  select id into prop from home.properties limit 1;
  p := (home.create_project(p_property_id => prop, p_name => 'Main roof and deck', p_status => 'underway',
        p_summary => null, p_rooms => array['Deck', 'Roof'], p_started_on => null, p_target_on => null,
        p_finished_on => null, p_budget => 100000, p_budget_incl_gst => true,
        p_photo_paths => null, p_document_paths => null)).id;
  insert into ids values ('project', p);
  insert into ids select 'household', household_id from home.projects where id = p;
end;
$$;

-- ── the function files the email, as the service role ──────────────────────
-- It can execute the filing function and read nothing, as on the live project,
-- so what it filed is checked from the household's side below.
reset role;
set local role service_role;

do $$
declare
  p uuid := (select id from ids where name = 'project');
  me uuid := '5ce9a410-0000-4000-8000-000000000002';
  first_id uuid;
  again uuid;
begin
  first_id := (home.file_emailed_bill(
    p_project_id => p, p_sender_id => me, p_source_ref => 'email-variations',
    p_source_subject => 'Fwd: Variations', p_supplier => 'ReliaBuilder', p_detail => 'Variations',
    p_amount => 6325.00, p_invoice_number => 'INV-0184',
    p_paid => true, p_paid_evidence => 'Paid — thank you',
    p_document_paths => array['h/docs/1-0-Variations - INV 0184.pdf'],
    p_source_part => 0, p_kind => 'invoice')).id;
  insert into ids values ('inv0184', first_id);

  insert into ids values ('plumber', (home.file_emailed_bill(
    p_project_id => p, p_sender_id => me, p_source_ref => 'email-variations',
    p_supplier => 'Force Plumbing', p_detail => 'Variation', p_amount => 1200,
    p_document_paths => array['h/docs/1-1-Variation - Force Plumbing.pdf'],
    p_source_part => 1, p_kind => 'paperwork', p_addressed_to => 'ReliaBuilder',
    p_paid => true, p_paid_evidence => 'PAID')).id);

  insert into ids values ('coc', (home.file_emailed_bill(
    p_project_id => p, p_sender_id => me, p_source_ref => 'email-variations',
    p_supplier => 'Good Connection', p_detail => 'Certificate of compliance',
    p_document_paths => array['h/docs/1-2-Electrical - Certificate of Compliance.pdf'],
    p_source_part => 2, p_kind => 'paperwork')).id);

  -- The same paper again — a retried webhook — is the same card.
  again := (home.file_emailed_bill(
    p_project_id => p, p_sender_id => me, p_source_ref => 'email-variations',
    p_supplier => 'Force Plumbing', p_source_part => 1, p_kind => 'paperwork')).id;
  perform pg_temp.expect(again = (select id from ids where name = 'plumber'), 'a retried part is the same card');

  -- Two papers in one email may carry one invoice number; neither is refused.
  perform home.file_emailed_bill(
    p_project_id => p, p_sender_id => me, p_source_ref => 'email-variations',
    p_supplier => 'ReliaBuilder', p_invoice_number => 'INV-0184',
    p_photo_paths => array['h/photo-of-0184.jpg'], p_source_part => 3, p_kind => 'invoice');

  -- The call the deployed function makes today: no part, no kind.
  insert into ids values ('legacy', (home.file_emailed_bill(
    p_project_id => p, p_sender_id => me, p_source_ref => 'email-legacy',
    p_supplier => 'ReliaBuilder', p_amount => 500, p_paid => true, p_paid_evidence => 'Paid in full',
    p_inferred => array['kind'])).id);

  -- A deck quote, and a blank card from an email nobody could read.
  insert into ids values ('deckquote', (home.file_emailed_bill(
    p_project_id => p, p_sender_id => me, p_source_ref => 'email-deck',
    p_supplier => 'ReliaBuilder', p_detail => 'Deck and sub structure', p_amount => 49482.20,
    p_invoice_number => 'QU-0111', p_kind => 'quote')).id);

  insert into ids values ('blank', (home.file_emailed_bill(
    p_project_id => p, p_sender_id => me, p_source_ref => 'email-blank',
    p_source_subject => 'Fwd: Variations again',
    p_photo_paths => array['h/deck.jpg'],
    p_document_paths => array['h/docs/a.pdf', 'h/docs/b.pdf', 'h/docs/c.pdf'])).id);
end;
$$;

-- ── the person answers them ─────────────────────────────────────────────────
reset role;
set local role authenticated;

do $$
declare
  p uuid := (select id from ids where name = 'project');
  inv uuid := (select id from ids where name = 'inv0184');
  plumber uuid := (select id from ids where name = 'plumber');
  coc uuid := (select id from ids where name = 'coc');
  deck uuid := (select id from ids where name = 'deckquote');
  blank uuid := (select id from ids where name = 'blank');
  bill home.project_quotes;
  quoted home.project_quotes;
  committed_before numeric;
  cards home.invoice_reviews[];
begin
  perform pg_temp.expect(
    (select count(*) from home.invoice_reviews where source_ref = 'email-variations') = 4,
    'four papers, four cards — a retried one filed nothing');
  perform pg_temp.expect(
    not (select paid from home.invoice_reviews where id = plumber), 'paperwork is never paid');
  perform pg_temp.expect(
    (select paid from home.invoice_reviews where id = inv), 'a bill with its sentence is');
  perform pg_temp.expect(
    (select kind = 'invoice' and source_part = 0 from home.invoice_reviews
      where id = (select id from ids where name = 'legacy')),
    'the old call still files an invoice at part nought');

  perform pg_temp.refuses(
    format('select home.approve_invoice_review(%L)', plumber),
    'Paperwork is filed', 'paperwork cannot be allocated');

  bill := home.approve_invoice_review(inv);
  perform pg_temp.expect(bill.kind = 'invoice' and bill.invoice_number = 'INV-0184', 'the bill becomes a bill');
  perform pg_temp.expect(
    (select count(*) from home.project_payments where quote_id = bill.id) = 1, 'and its payment with it');

  select committed_total into committed_before from home.projects_with_totals where id = p;

  quoted := home.approve_invoice_review(deck);
  perform pg_temp.expect(quoted.kind = 'quote' and quoted.status = 'tbc', 'an emailed quote is a quote nobody has agreed');
  perform pg_temp.expect(
    (select committed_total from home.projects_with_totals where id = p) is not distinct from committed_before,
    'and it commits nothing');
  perform pg_temp.expect(
    not exists (select 1 from home.project_bills where id = quoted.id), 'and nobody is asked to pay it');

  -- Filing: the subcontractor's variation onto the builder's bill, the certificate onto the job.
  perform pg_temp.refuses(
    format('select home.file_review_paperwork(%L)', (select id from ids where name = 'legacy')),
    'Only paperwork is filed', 'a bill cannot be filed as paperwork');
  perform pg_temp.refuses(
    format('select home.file_review_paperwork(%L, %L, %L)', plumber, bill.id,
      (select id from home.project_elements where project_id = p limit 1)),
    'not both', 'a paper lives at one level');

  perform home.file_review_paperwork(plumber, p_quote_id => bill.id);
  perform pg_temp.expect(
    (select 'h/docs/1-1-Variation - Force Plumbing.pdf' = any(document_paths) from home.project_quotes where id = bill.id),
    'the variation rides on the builder''s bill');
  perform pg_temp.expect(
    (select state = 'approved' and quote_id = bill.id from home.invoice_reviews where id = plumber),
    'and the card says where it went');

  perform home.file_review_paperwork(coc);
  perform pg_temp.expect(
    (select 'h/docs/1-2-Electrical - Certificate of Compliance.pdf' = any(document_paths) from home.projects where id = p),
    'the certificate is on the job');
  perform pg_temp.expect(
    exists (select 1 from home.project_files where project_id = p
             and path = 'h/docs/1-2-Electrical - Certificate of Compliance.pdf'),
    'and in the job''s files');
  perform pg_temp.expect(
    (select committed_total from home.projects_with_totals where id = p) is not distinct from committed_before,
    'filing moved no figure');

  -- Correcting the kind drops a paid guess and answers the guess about kind.
  perform home.update_invoice_review((select id from ids where name = 'legacy'), p_kind => 'paperwork');
  perform pg_temp.expect(
    (select kind = 'paperwork' and not paid and inferred = '{}' from home.invoice_reviews
      where id = (select id from ids where name = 'legacy')),
    'a card turned into paperwork loses its paid flag and its guess');

  perform pg_temp.expect(home.project_people(p) = array['Papers'], 'a reading is told who "you" are');

  -- Reading again.
  perform pg_temp.refuses(
    format('select home.refile_review(%L, %L::jsonb)', blank,
      '[{"kind":"invoice","documentPaths":["h/docs/somebody-else.pdf"]}]'),
    'only move the files', 'a reading brings no files the card did not have');
  perform pg_temp.refuses(
    format('select home.refile_review(%L, %L::jsonb)', blank,
      '[{"kind":"invoice","documentPaths":["h/docs/a.pdf"]}]'),
    'keep every file', 'a reading drops no file the card had');
  perform pg_temp.refuses(
    format('select home.refile_review(%L, %L::jsonb)', deck, '[{"kind":"invoice"}]'),
    'already been ruled on', 'a decided card is not read again');

  select array_agg(r) into cards from home.refile_review(blank, jsonb_build_array(
    jsonb_build_object('kind', 'invoice', 'supplier', 'ReliaBuilder', 'amount', 6325.00,
      'invoiceNumber', 'INV-0184', 'documentPaths', jsonb_build_array('h/docs/a.pdf')),
    jsonb_build_object('kind', 'paperwork', 'supplier', 'Force Plumbing', 'addressedTo', 'ReliaBuilder',
      'amount', 1200, 'paid', true, 'paidEvidence', 'PAID',
      'documentPaths', jsonb_build_array('h/docs/b.pdf')),
    jsonb_build_object('kind', 'paperwork', 'detail', 'Certificate of compliance',
      'documentPaths', jsonb_build_array('h/docs/c.pdf')),
    jsonb_build_object('kind', 'paperwork', 'detail', 'Photos',
      'photoPaths', jsonb_build_array('h/deck.jpg'), 'inferred', jsonb_build_array('kind'))
  )) r;

  perform pg_temp.expect(cardinality(cards) = 4, 'a blank card read again becomes four');
  perform pg_temp.expect(cards[1].id = blank and cards[1].supplier = 'ReliaBuilder', 'the first keeps its place');
  perform pg_temp.expect(cards[2].source_part = 1 and cards[4].source_part = 3, 'the rest take the next parts');
  perform pg_temp.expect(
    cards[2].source_subject = 'Fwd: Variations again' and cards[2].addressed_to = 'ReliaBuilder'
      and not cards[2].paid,
    'each new card keeps the email, and paperwork is not paid');
  perform pg_temp.expect(cards[4].inferred = array['kind'], 'a guessed kind says so');
  perform pg_temp.expect(
    (select document_paths from home.invoice_reviews where id = blank) = array['h/docs/a.pdf'],
    'the first card keeps only its own paper');

  perform pg_temp.refuses(
    format('select home.refile_review(%L, %L::jsonb)', blank, '[{"kind":"invoice"}]'),
    'already filled', 'a card somebody can read is not replaced');
end;
$$;

rollback;
