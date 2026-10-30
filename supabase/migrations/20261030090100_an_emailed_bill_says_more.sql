-- What the live job's emailed bills said that their cards did not.
--
-- The October 2026 review read every paper forwarded to the three live jobs
-- against what landed on them. Four things the cards could not carry:
--
--   * **What was already paid.** Kitchen Mania's INV-15879 prints a total of
--     $27,480.37, "less deposit paid $8,244.11", balance $19,236.26. The card
--     held one figure, so the deposit — already on the job as its own invoice,
--     V3 — was paid a second time inside the total. `already_paid` keeps the
--     paper's own deduction, and allocating can record it as a payment.
--   * **Whose contract a claim is a stage of.** Every emailed progress claim
--     landed as a bill on its own (see `20261030090000`). Allocating now takes
--     the contract, and the bill lands where the contract sits, linked.
--   * **When it was paid.** A card read as paid with no date on the paper was
--     paid "today", the day somebody pressed Allocate. It is the paper's date
--     now, which is the nearer of the two to the bank.
--   * **Which spelling of a supplier this household already uses.** "RELIABUILDER
--     LIMITED" from the paper and "ReliaBuilder" on the job are two rows in
--     every rollup that groups by name. A card takes the spelling already on
--     the household's prices when the business is the same (`business_key`,
--     the twin of `businessKey` in `papers.ts`).
--
-- And one move: a card forwarded to the wrong job's address can be moved to
-- another job in the same home, rather than declined and forwarded again.

-- ------------------------------------------------------------ already paid

alter table home.invoice_reviews
  add column already_paid numeric check (already_paid is null or already_paid > 0);

comment on column home.invoice_reviews.already_paid is
  'What the paper says was paid before it and taken off its total ("less deposit paid"), in the amount''s GST basis.';

-- ---------------------------------------------------------- the spelling

-- A business name as compared: lower case, letters and digits, without the
-- "Limited" an invoice prints and an email leaves off. Twin of `businessKey`
-- in packages/supabase-queries/src/papers.ts; `emailed_bills_say_more.sql`
-- holds it to the answers `checks.test.ts` pins for the twin.
create function home.business_key(p_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(
    regexp_replace(
      regexp_replace(lower(coalesce(p_name, '')), '\m(limited|ltd|nz|new zealand|group|co)\M\.?', '', 'g'),
      '[^a-z0-9]', '', 'g'),
    '');
$$;
revoke execute on function home.business_key(text) from public, anon;

-- The spelling this household's prices already use for the business a paper
-- names, newest first, or the paper's own when it is new. Called only from
-- inside the SECURITY DEFINER functions below.
create function home.known_supplier(p_project_id uuid, p_name text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select q.supplier
       from home.project_quotes q
       join home.projects p on p.id = q.reach_project_id
      where p.household_id = (select household_id from home.projects where id = p_project_id)
        and home.business_key(q.supplier) = home.business_key(p_name)
      order by q.created_at desc
      limit 1),
    nullif(btrim(coalesce(p_name, '')), ''));
$$;
revoke execute on function home.known_supplier(uuid, text) from public, anon, authenticated;

-- ------------------------------------------------------- filing a card

drop function home.file_emailed_bill(uuid, uuid, text, text, text, timestamptz,
  text, text, numeric, boolean, text, date, date, boolean, date, text, text[], text[], text[],
  integer, home.invoice_review_kind, text);

create function home.file_emailed_bill(
  p_project_id uuid,
  p_sender_id uuid,
  p_source_ref text,
  p_source_subject text default null,
  p_source_from text default null,
  p_source_at timestamptz default null,
  p_supplier text default null,
  p_detail text default null,
  p_amount numeric default null,
  p_amount_incl_gst boolean default true,
  p_invoice_number text default null,
  p_dated date default null,
  p_due_on date default null,
  p_paid boolean default false,
  p_paid_on date default null,
  p_paid_evidence text default null,
  p_inferred text[] default '{}',
  p_photo_paths text[] default '{}',
  p_document_paths text[] default '{}',
  p_source_part integer default 0,
  p_kind home.invoice_review_kind default 'invoice',
  p_addressed_to text default null,
  p_already_paid numeric default null
)
returns home.invoice_reviews
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_review home.invoice_reviews;
  v_household uuid;
  v_today integer;
  v_kind home.invoice_review_kind := coalesce(p_kind, 'invoice');
begin
  if p_source_ref is null or btrim(p_source_ref) = '' then
    raise exception 'An emailed bill needs the email it came from';
  end if;

  select household_id into v_household from home.projects where id = p_project_id;
  if v_household is null then
    raise exception 'No such project';
  end if;

  -- The same paper of the same email twice is the same card.
  select * into v_review from home.invoice_reviews
  where project_id = p_project_id
    and source_ref = btrim(p_source_ref)
    and source_part = coalesce(p_source_part, 0);
  if v_review.id is not null then
    return v_review;
  end if;

  -- Fifty emailed cards a household a day. A renovation does not produce that
  -- many; a mail loop does.
  select count(*) into v_today
  from home.invoice_reviews r
  join home.projects p on p.id = r.project_id
  where p.household_id = v_household
    and r.source_ref is not null
    and r.created_at >= current_date;
  if v_today >= 50 then
    raise exception 'Too many emailed bills today';
  end if;

  insert into home.invoice_reviews (
    project_id, kind, supplier, detail, amount, amount_incl_gst, invoice_number,
    dated, due_on, paid, paid_on, paid_evidence, addressed_to, already_paid,
    source_ref, source_part, source_subject, source_from, source_at, inferred,
    photo_paths, document_paths, created_by
  )
  values (
    p_project_id,
    v_kind,
    -- Paperwork keeps the name it was issued under: it is filed, never summed.
    case when v_kind = 'paperwork' then nullif(btrim(coalesce(p_supplier, '')), '')
         else home.known_supplier(p_project_id, p_supplier) end,
    nullif(btrim(coalesce(p_detail, '')), ''),
    p_amount,
    coalesce(p_amount_incl_gst, true),
    nullif(btrim(coalesce(p_invoice_number, '')), ''),
    p_dated, p_due_on,
    -- Only a bill is paid, and never without the sentence it was read from.
    v_kind = 'invoice' and coalesce(p_paid, false)
      and nullif(btrim(coalesce(p_paid_evidence, '')), '') is not null,
    case when v_kind = 'invoice' and coalesce(p_paid, false) then p_paid_on end,
    case when v_kind = 'invoice' then nullif(btrim(coalesce(p_paid_evidence, '')), '') end,
    nullif(btrim(coalesce(p_addressed_to, '')), ''),
    -- Only a bill has something taken off it, and never all of it.
    case when v_kind = 'invoice' and p_already_paid > 0
              and (p_amount is null or p_already_paid < p_amount) then p_already_paid end,
    btrim(p_source_ref),
    coalesce(p_source_part, 0),
    nullif(btrim(coalesce(p_source_subject, '')), ''),
    nullif(btrim(coalesce(p_source_from, '')), ''),
    coalesce(p_source_at, now()),
    coalesce(p_inferred, '{}'),
    coalesce(p_photo_paths, '{}'),
    coalesce(p_document_paths, '{}'),
    p_sender_id
  )
  returning * into v_review;

  return v_review;
end;
$$;
revoke execute on function home.file_emailed_bill(uuid, uuid, text, text, text, timestamptz,
  text, text, numeric, boolean, text, date, date, boolean, date, text, text[], text[], text[],
  integer, home.invoice_review_kind, text, numeric)
  from public, anon, authenticated;
grant execute on function home.file_emailed_bill(uuid, uuid, text, text, text, timestamptz,
  text, text, numeric, boolean, text, date, date, boolean, date, text, text[], text[], text[],
  integer, home.invoice_review_kind, text, numeric)
  to service_role;

-- ------------------------------------------------------- reading again

-- Unchanged but for `alreadyPaid` and the household's spelling, which a
-- reading made with *Read again* takes exactly as one made on arrival.
create or replace function home.refile_review(p_review_id uuid, p_cards jsonb)
returns setof home.invoice_reviews
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_review home.invoice_reviews;
  v_card jsonb;
  v_index integer := 0;
  v_next integer;
  v_held text[];
  v_given text[];
  v_kind home.invoice_review_kind;
  v_paid boolean;
  v_amount numeric;
  v_already numeric;
  v_supplier text;
  v_ids uuid[] := '{}';
  v_id uuid;
begin
  select * into v_review from home.invoice_reviews where id = p_review_id;

  if v_review.id is null then
    raise exception 'No such invoice';
  end if;

  perform home.require_project_member(v_review.project_id);

  if v_review.state <> 'pending' then
    raise exception 'That one has already been ruled on';
  end if;

  if not home.review_is_unread(v_review) then
    raise exception 'Somebody has already filled this one in';
  end if;

  if jsonb_typeof(p_cards) <> 'array' or jsonb_array_length(p_cards) = 0 then
    raise exception 'A reading needs at least one card';
  end if;

  if jsonb_array_length(p_cards) > 12 then
    raise exception 'That is more papers than one email carries';
  end if;

  v_held := v_review.photo_paths || v_review.document_paths;

  select coalesce(array_agg(p), '{}') into v_given
  from jsonb_array_elements(p_cards) c,
       lateral jsonb_array_elements_text(
         coalesce(c -> 'photoPaths', '[]'::jsonb) || coalesce(c -> 'documentPaths', '[]'::jsonb)
       ) p;

  if not (v_given <@ v_held) then
    raise exception 'A reading can only move the files this card already has';
  end if;

  if not (v_held <@ v_given) then
    raise exception 'A reading has to keep every file this card had';
  end if;

  select coalesce(max(source_part), 0) + 1 into v_next
  from home.invoice_reviews
  where project_id = v_review.project_id and source_ref is not distinct from v_review.source_ref;

  for v_card in select value from jsonb_array_elements(p_cards)
  loop
    v_kind := coalesce(nullif(v_card ->> 'kind', ''), 'invoice')::home.invoice_review_kind;
    v_paid := v_kind = 'invoice'
      and coalesce((v_card ->> 'paid')::boolean, false)
      and nullif(btrim(coalesce(v_card ->> 'paidEvidence', '')), '') is not null;
    v_amount := (v_card ->> 'amount')::numeric;
    v_already := (v_card ->> 'alreadyPaid')::numeric;
    v_already := case when v_kind = 'invoice' and v_already > 0
                           and (v_amount is null or v_already < v_amount) then v_already end;
    v_supplier := case when v_kind = 'paperwork' then nullif(btrim(coalesce(v_card ->> 'supplier', '')), '')
                       else home.known_supplier(v_review.project_id, v_card ->> 'supplier') end;

    if v_index = 0 then
      update home.invoice_reviews set
        kind = v_kind,
        supplier = v_supplier,
        detail = nullif(btrim(coalesce(v_card ->> 'detail', '')), ''),
        amount = v_amount,
        amount_incl_gst = coalesce((v_card ->> 'amountInclGst')::boolean, true),
        invoice_number = nullif(btrim(coalesce(v_card ->> 'invoiceNumber', '')), ''),
        dated = (v_card ->> 'dated')::date,
        due_on = (v_card ->> 'dueOn')::date,
        paid = v_paid,
        paid_on = case when v_paid then (v_card ->> 'paidOn')::date end,
        paid_evidence = case when v_paid then btrim(v_card ->> 'paidEvidence') end,
        addressed_to = nullif(btrim(coalesce(v_card ->> 'addressedTo', '')), ''),
        already_paid = v_already,
        inferred = coalesce(array(select jsonb_array_elements_text(v_card -> 'inferred')), '{}'),
        photo_paths = coalesce(array(select jsonb_array_elements_text(v_card -> 'photoPaths')), '{}'),
        document_paths = coalesce(array(select jsonb_array_elements_text(v_card -> 'documentPaths')), '{}'),
        updated_at = now()
      where id = p_review_id
      returning id into v_id;
    else
      insert into home.invoice_reviews (
        project_id, element_id, room_ids, room_amounts, kind, supplier, detail, amount,
        amount_incl_gst, invoice_number, dated, due_on, paid, paid_on, paid_evidence,
        addressed_to, already_paid, source_ref, source_part, source_subject, source_from, source_at,
        inferred, photo_paths, document_paths, created_by
      )
      values (
        v_review.project_id, v_review.element_id, v_review.room_ids, v_review.room_amounts,
        v_kind,
        v_supplier,
        nullif(btrim(coalesce(v_card ->> 'detail', '')), ''),
        v_amount,
        coalesce((v_card ->> 'amountInclGst')::boolean, true),
        nullif(btrim(coalesce(v_card ->> 'invoiceNumber', '')), ''),
        (v_card ->> 'dated')::date,
        (v_card ->> 'dueOn')::date,
        v_paid,
        case when v_paid then (v_card ->> 'paidOn')::date end,
        case when v_paid then btrim(v_card ->> 'paidEvidence') end,
        nullif(btrim(coalesce(v_card ->> 'addressedTo', '')), ''),
        v_already,
        v_review.source_ref,
        v_next + v_index - 1,
        v_review.source_subject, v_review.source_from, v_review.source_at,
        coalesce(array(select jsonb_array_elements_text(v_card -> 'inferred')), '{}'),
        coalesce(array(select jsonb_array_elements_text(v_card -> 'photoPaths')), '{}'),
        coalesce(array(select jsonb_array_elements_text(v_card -> 'documentPaths')), '{}'),
        v_review.created_by
      )
      returning id into v_id;
    end if;

    v_ids := v_ids || v_id;
    v_index := v_index + 1;
  end loop;

  return query
    select r.* from home.invoice_reviews r
    join unnest(v_ids) with ordinality as o(id, ord) on o.id = r.id
    order by o.ord;
end;
$$;

-- ---------------------------------------------------------- allocating

-- `p_against_quote_id`: the bill is a stage of that quote. It lands where the
-- quote sits — its rooms are the quote's to share — and is linked, so a signed
-- contract counts it once. `p_record_already_paid`: what the paper says was
-- paid before it is recorded as a payment against it, undated, because the
-- paper says it was paid and not when.
drop function home.approve_invoice_review(uuid, uuid);

create function home.approve_invoice_review(
  p_review_id uuid,
  p_element_id uuid default null,
  p_against_quote_id uuid default null,
  p_record_already_paid boolean default false
)
returns home.project_quotes
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_review home.invoice_reviews;
  v_quote home.project_quotes;
  v_contract home.project_quotes;
  v_element uuid;
  v_item uuid;
  v_project uuid;
  v_room_ids uuid[];
  v_room_amounts numeric[];
  v_balance numeric;
begin
  select * into v_review from home.invoice_reviews where id = p_review_id;

  if v_review.id is null then
    raise exception 'No such invoice';
  end if;

  perform home.require_project_member(v_review.project_id);

  if v_review.state = 'approved' then
    raise exception 'That one is already on the job';
  end if;

  if v_review.kind = 'paperwork' then
    raise exception 'Paperwork is filed on the job, not added as a price';
  end if;

  if p_against_quote_id is not null then
    if v_review.kind <> 'invoice' then
      raise exception 'Only a bill can be a claim against a contract';
    end if;
    select * into v_contract from home.project_quotes where id = p_against_quote_id;
    if v_contract.id is null then
      raise exception 'No such contract';
    end if;
    if v_contract.kind <> 'quote' then
      raise exception 'A claim has to be against a quote, not another bill';
    end if;
    if home.quote_project(p_against_quote_id) is distinct from v_review.project_id then
      raise exception 'That contract belongs to a different job';
    end if;
    v_item := v_contract.item_id;
    v_element := v_contract.element_id;
    v_project := v_contract.project_id;
  else
    v_element := coalesce(p_element_id, v_review.element_id);

    if v_element is not null
       and home.element_project(v_element) is distinct from v_review.project_id then
      raise exception 'That part belongs to another job';
    end if;

    v_project := case when v_element is null then v_review.project_id end;

    if p_element_id is null and cardinality(v_review.room_ids) > 0 then
      select array_agg(r.id order by r.ord),
             case when v_review.room_amounts is null then null
                  else array_agg(v_review.room_amounts[r.ord] order by r.ord) end
        into v_room_ids, v_room_amounts
      from unnest(v_review.room_ids) with ordinality as r(id, ord)
      where home.element_project(r.id) = v_review.project_id;
    end if;
  end if;

  v_quote := home.create_quote(
    p_item_id => v_item,
    p_element_id => v_element,
    p_project_id => v_project,
    p_supplier => v_review.supplier,
    p_detail => coalesce(v_review.detail, v_review.category),
    p_amount => v_review.amount,
    p_amount_incl_gst => v_review.amount_incl_gst,
    p_kind => case when v_review.kind = 'quote' then 'quote' else 'invoice' end::home.project_quote_kind,
    p_dated => v_review.dated,
    p_due_on => case when v_review.kind = 'invoice' then v_review.due_on end,
    p_invoice_number => v_review.invoice_number,
    p_photo_paths => v_review.photo_paths,
    p_document_paths => v_review.document_paths,
    p_against_quote_id => p_against_quote_id
  );

  if v_project is not null and p_against_quote_id is null
     and cardinality(coalesce(v_room_ids, '{}')) > 0 then
    perform home.set_quote_rooms(v_quote.id, v_room_ids, v_room_amounts);
  end if;

  if v_review.kind = 'invoice' and p_record_already_paid and v_review.already_paid is not null then
    perform home.add_payment(
      p_quote_id => v_quote.id,
      p_amount => v_review.already_paid,
      p_amount_incl_gst => v_review.amount_incl_gst,
      p_paid_on => null,
      p_reference => 'Paid before this invoice'
    );
  end if;

  -- What the paper says was paid is the balance: the total less anything it
  -- says was paid before. Dated as the paper says, or the paper's own date —
  -- never the day somebody pressed Allocate.
  v_balance := v_review.amount - coalesce(v_review.already_paid, 0);
  if v_review.kind = 'invoice' and v_review.paid and v_balance > 0 then
    perform home.add_payment(
      p_quote_id => v_quote.id,
      p_amount => v_balance,
      p_amount_incl_gst => v_review.amount_incl_gst,
      p_paid_on => coalesce(v_review.paid_on, v_review.dated),
      p_reference => v_review.invoice_number
    );
  end if;

  update home.invoice_reviews set
    state = 'approved',
    element_id = v_element,
    quote_id = v_quote.id,
    decided_at = now(),
    decided_by = auth.uid(),
    updated_at = now()
  where id = p_review_id;

  return v_quote;
end;
$$;
revoke execute on function home.approve_invoice_review(uuid, uuid, uuid, boolean) from public, anon;
grant execute on function home.approve_invoice_review(uuid, uuid, uuid, boolean) to authenticated;

-- ------------------------------------------------------------ moving one

-- A card forwarded to the wrong job's address goes to the right one. Only in
-- the same home: the card's files are in this household's folder, and a job
-- in another household could not open them. Where it was going on the old job
-- means nothing on the new one, so the part and the rooms are cleared.
create function home.move_invoice_review(p_review_id uuid, p_project_id uuid)
returns home.invoice_reviews
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_review home.invoice_reviews;
  v_from uuid;
  v_to uuid;
begin
  select * into v_review from home.invoice_reviews where id = p_review_id;

  if v_review.id is null then
    raise exception 'No such invoice';
  end if;

  perform home.require_project_member(v_review.project_id);
  perform home.require_project_member(p_project_id);

  if v_review.state <> 'pending' then
    raise exception 'That one has already been ruled on';
  end if;

  if p_project_id = v_review.project_id then
    return v_review;
  end if;

  select household_id into v_from from home.projects where id = v_review.project_id;
  select household_id into v_to from home.projects where id = p_project_id;
  if v_to is distinct from v_from then
    raise exception 'That job is in another home';
  end if;

  if v_review.source_ref is not null and exists (
    select 1 from home.invoice_reviews r
    where r.project_id = p_project_id
      and r.source_ref = v_review.source_ref
      and r.source_part = v_review.source_part
  ) then
    raise exception 'That job already has this paper';
  end if;

  update home.invoice_reviews set
    project_id = p_project_id,
    element_id = null,
    room_ids = '{}',
    room_amounts = null,
    updated_at = now()
  where id = p_review_id
  returning * into v_review;

  return v_review;
end;
$$;
revoke execute on function home.move_invoice_review(uuid, uuid) from public, anon;
grant execute on function home.move_invoice_review(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
