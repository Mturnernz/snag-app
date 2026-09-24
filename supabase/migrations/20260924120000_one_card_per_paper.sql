-- One email, one card per paper in it.
--
-- `20260924090000` made a forwarded email into **one** card. The first real
-- email to test it carried four PDFs and a photograph — a plumber's variation,
-- an electrician's variation, the builder's variation invoice, a certificate of
-- compliance, and a photo of the deck — and all five landed on one card, read
-- (had the model been answering) as one supplier and one figure. There was no
-- way to allocate the builder's invoice and file the certificate, and two of the
-- three bills were not even addressed to the household: they were the
-- subcontractors billing the builder, whose own invoice already includes them.
-- Recording them as bills would count that money twice.
--
-- So each attachment is read on its own and becomes its own card, and a card
-- says what kind of paper it is:
--
-- - **invoice** — a bill to pay. Allocating it is what it always was.
-- - **quote** — a price offered. Allocating it records a quote, not agreed
--   (`tbc`), which is what an emailed quote is. It used to become an invoice,
--   which put an unsigned $49,482.20 deck quote straight into *To pay*.
-- - **paperwork** — a certificate, a producer statement, a warranty, site
--   photos, or a bill addressed to somebody else. It is **filed**, never
--   allocated: its files go onto the job, a part of it, or a bill already on
--   it, and no figure anywhere moves. `approve_invoice_review` refuses one.
--
-- A bill addressed to somebody else becomes paperwork **with the name it is
-- addressed to** kept on `addressed_to`, so the card can say why: "Addressed to
-- ReliaBuilder, not you". The figure on it stays readable for reference and
-- reaches nothing.
--
-- ------------------------------------------------ one card per part
--
-- `source_part` is which paper of the email a card came from. The one-per-email
-- index becomes one per part, so a retried webhook still files nothing twice,
-- and `invoice_reviews_one_per_source` goes: it keyed on the invoice number,
-- and two papers in one email may honestly carry the same one (the builder's
-- invoice as a PDF and a photo of it) — the duplicate check on the card is
-- where that is said, as a warning rather than a refusal.
--
-- ------------------------------------------------ reading again
--
-- A reading that fails still files the card, and on the day this was first
-- used every model answered 503 for three minutes and three of four cards came
-- in blank, with no way to try again. `refile_review` is the other half of the
-- *Read again* button (`supabase/functions/reread-bill`): it takes a card
-- **nobody has read or typed on**, and replaces it with the cards a fresh
-- reading makes of its files — one or several. It runs as the caller, requires
-- them to be on the job, and only moves files the card already held, so it
-- grants nothing `update_invoice_review` did not.

create type home.invoice_review_kind as enum ('invoice', 'quote', 'paperwork');

alter table home.invoice_reviews
  add column kind home.invoice_review_kind not null default 'invoice',
  add column source_part integer not null default 0,
  add column addressed_to text;

drop index home.invoice_reviews_one_per_email;
drop index home.invoice_reviews_one_per_source;

create unique index invoice_reviews_one_per_part
  on home.invoice_reviews (project_id, source_ref, source_part)
  where source_ref is not null;

-- ------------------------------------------------------------------ filing

-- The function writes with the service role. Three new arguments, all with
-- defaults, so the function deployed before this migration goes on filing
-- exactly what it did: one invoice card, part nought.
drop function home.file_emailed_bill(uuid, uuid, text, text, text, timestamptz,
  text, text, numeric, boolean, text, date, date, boolean, date, text, text[], text[], text[]);

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
  p_addressed_to text default null
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
  -- many; a mail loop does. Counted in cards rather than emails, so an email
  -- carrying ten papers spends ten — the model read each of them.
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
    dated, due_on, paid, paid_on, paid_evidence, addressed_to,
    source_ref, source_part, source_subject, source_from, source_at, inferred,
    photo_paths, document_paths, created_by
  )
  values (
    p_project_id,
    v_kind,
    nullif(btrim(coalesce(p_supplier, '')), ''),
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
  integer, home.invoice_review_kind, text)
  from public, anon, authenticated;
grant execute on function home.file_emailed_bill(uuid, uuid, text, text, text, timestamptz,
  text, text, numeric, boolean, text, date, date, boolean, date, text, text[], text[], text[],
  integer, home.invoice_review_kind, text)
  to service_role;

-- ------------------------------------------------------------ reading again

-- Whether anybody has read or typed anything on a card. Only such a card can
-- be replaced by a fresh reading: one somebody has corrected holds answers a
-- reading must not throw away.
create function home.review_is_unread(r home.invoice_reviews)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select r.supplier is null and r.detail is null and r.amount is null
     and r.invoice_number is null and r.dated is null and r.due_on is null;
$$;

grant execute on function home.review_is_unread(home.invoice_reviews) to authenticated, service_role;

-- `p_cards` is a JSON array, one object per card, in the shape
-- `supabase/functions/inbound-bill/bill.ts` builds (`cardsFromReadings`): kind,
-- supplier, detail, amount, amountInclGst, invoiceNumber, dated, dueOn, paid,
-- paidOn, paidEvidence, addressedTo, inferred, photoPaths, documentPaths.
--
-- The first card is written over the one being read again, keeping its id,
-- its email and where it lands; the rest are new rows from the same email, at
-- the parts after the last one it already has. The paths must be exactly the
-- ones the card held: a reading moves paperwork between cards, it never brings
-- any, and it never drops one — a file no card points at is a file nobody can
-- open or delete.
create function home.refile_review(p_review_id uuid, p_cards jsonb)
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

    if v_index = 0 then
      update home.invoice_reviews set
        kind = v_kind,
        supplier = nullif(btrim(coalesce(v_card ->> 'supplier', '')), ''),
        detail = nullif(btrim(coalesce(v_card ->> 'detail', '')), ''),
        amount = (v_card ->> 'amount')::numeric,
        amount_incl_gst = coalesce((v_card ->> 'amountInclGst')::boolean, true),
        invoice_number = nullif(btrim(coalesce(v_card ->> 'invoiceNumber', '')), ''),
        dated = (v_card ->> 'dated')::date,
        due_on = (v_card ->> 'dueOn')::date,
        paid = v_paid,
        paid_on = case when v_paid then (v_card ->> 'paidOn')::date end,
        paid_evidence = case when v_paid then btrim(v_card ->> 'paidEvidence') end,
        addressed_to = nullif(btrim(coalesce(v_card ->> 'addressedTo', '')), ''),
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
        addressed_to, source_ref, source_part, source_subject, source_from, source_at,
        inferred, photo_paths, document_paths, created_by
      )
      values (
        v_review.project_id, v_review.element_id, v_review.room_ids, v_review.room_amounts,
        v_kind,
        nullif(btrim(coalesce(v_card ->> 'supplier', '')), ''),
        nullif(btrim(coalesce(v_card ->> 'detail', '')), ''),
        (v_card ->> 'amount')::numeric,
        coalesce((v_card ->> 'amountInclGst')::boolean, true),
        nullif(btrim(coalesce(v_card ->> 'invoiceNumber', '')), ''),
        (v_card ->> 'dated')::date,
        (v_card ->> 'dueOn')::date,
        v_paid,
        case when v_paid then (v_card ->> 'paidOn')::date end,
        case when v_paid then btrim(v_card ->> 'paidEvidence') end,
        nullif(btrim(coalesce(v_card ->> 'addressedTo', '')), ''),
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

revoke execute on function home.refile_review(uuid, jsonb) from public, anon;
grant execute on function home.refile_review(uuid, jsonb) to authenticated;

-- ------------------------------------------------------------ correcting one

-- Unchanged but for `p_kind`: the reader of the card is the one who knows a
-- quote from a bill, and answering it clears the *guessed* mark. Turning a
-- card into paperwork drops any paid inference, since only a bill is paid.
drop function home.update_invoice_review(uuid, text, text, numeric,
  boolean, text, date, date, boolean, date, text, uuid, text[]);

create function home.update_invoice_review(
  p_review_id uuid,
  p_supplier text default null,
  p_detail text default null,
  p_amount numeric default null,
  p_amount_incl_gst boolean default null,
  p_invoice_number text default null,
  p_dated date default null,
  p_due_on date default null,
  p_paid boolean default null,
  p_paid_on date default null,
  p_category text default null,
  p_element_id uuid default null,
  p_clear text[] default '{}',
  p_kind home.invoice_review_kind default null
)
returns home.invoice_reviews
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_review home.invoice_reviews;
  v_clear text[] := coalesce(p_clear, '{}');
  v_answered text[];
  v_inferred text[];
  v_kind home.invoice_review_kind;
begin
  select * into v_review from home.invoice_reviews where id = p_review_id;

  if v_review.id is null then
    raise exception 'No such invoice';
  end if;

  perform home.require_project_member(v_review.project_id);

  if v_review.state <> 'pending' then
    raise exception 'That one has already been ruled on';
  end if;

  if p_element_id is not null
     and home.element_project(p_element_id) is distinct from v_review.project_id then
    raise exception 'That part belongs to another job';
  end if;

  v_kind := coalesce(p_kind, v_review.kind);

  v_answered := v_clear
    || case when p_supplier is not null then array['supplier'] else '{}' end
    || case when p_detail is not null then array['detail'] else '{}' end
    || case when p_amount is not null then array['amount'] else '{}' end
    || case when p_amount_incl_gst is not null then array['amount_incl_gst'] else '{}' end
    || case when p_invoice_number is not null then array['invoice_number'] else '{}' end
    || case when p_dated is not null then array['dated'] else '{}' end
    || case when p_due_on is not null then array['due_on'] else '{}' end
    || case when p_paid is not null then array['paid'] else '{}' end
    || case when p_category is not null then array['category'] else '{}' end
    || case when p_kind is not null then array['kind'] else '{}' end;

  select coalesce(array_agg(f), '{}'::text[]) into v_inferred
  from unnest(v_review.inferred) as f
  where not (f = any(v_answered));

  update home.invoice_reviews set
    kind = v_kind,
    supplier = case when 'supplier' = any(v_clear) then null
                    else coalesce(nullif(btrim(coalesce(p_supplier, '')), ''), supplier) end,
    detail = case when 'detail' = any(v_clear) then null
                  else coalesce(nullif(btrim(coalesce(p_detail, '')), ''), detail) end,
    amount = case when 'amount' = any(v_clear) then null
                  else coalesce(p_amount, amount) end,
    amount_incl_gst = coalesce(p_amount_incl_gst, amount_incl_gst),
    invoice_number = case when 'invoice_number' = any(v_clear) then null
                          else coalesce(nullif(btrim(coalesce(p_invoice_number, '')), ''), invoice_number) end,
    dated = case when 'dated' = any(v_clear) then null else coalesce(p_dated, dated) end,
    due_on = case when 'due_on' = any(v_clear) then null else coalesce(p_due_on, due_on) end,
    paid = v_kind = 'invoice' and coalesce(p_paid, paid),
    paid_on = case when v_kind <> 'invoice' or 'paid_on' = any(v_clear) then null
                   else coalesce(p_paid_on, paid_on) end,
    paid_evidence = case when v_kind <> 'invoice' then null else paid_evidence end,
    category = case when 'category' = any(v_clear) then null
                    else coalesce(nullif(btrim(coalesce(p_category, '')), ''), category) end,
    element_id = case when 'element_id' = any(v_clear) then null
                      else coalesce(p_element_id, element_id) end,
    inferred = v_inferred,
    updated_at = now()
  where id = p_review_id
  returning * into v_review;

  return v_review;
end;
$$;

revoke execute on function home.update_invoice_review(uuid, text, text, numeric,
  boolean, text, date, date, boolean, date, text, uuid, text[], home.invoice_review_kind) from public, anon;
grant execute on function home.update_invoice_review(uuid, text, text, numeric,
  boolean, text, date, date, boolean, date, text, uuid, text[], home.invoice_review_kind) to authenticated;

-- ------------------------------------------------------------ allocating

-- As `20260924110000` left it, with the card's kind carried through: a quote
-- is recorded as a quote nobody has agreed yet, and only an invoice can carry
-- a payment. Paperwork is refused in words — it is filed, and filing moves no
-- figure.
create or replace function home.approve_invoice_review(
  p_review_id uuid,
  p_element_id uuid default null
)
returns home.project_quotes
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_review home.invoice_reviews;
  v_quote home.project_quotes;
  v_element uuid;
  v_room_ids uuid[];
  v_room_amounts numeric[];
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

  v_element := coalesce(p_element_id, v_review.element_id);

  if v_element is not null
     and home.element_project(v_element) is distinct from v_review.project_id then
    raise exception 'That part belongs to another job';
  end if;

  if p_element_id is null and cardinality(v_review.room_ids) > 0 then
    select array_agg(r.id order by r.ord),
           case when v_review.room_amounts is null then null
                else array_agg(v_review.room_amounts[r.ord] order by r.ord) end
      into v_room_ids, v_room_amounts
    from unnest(v_review.room_ids) with ordinality as r(id, ord)
    where home.element_project(r.id) = v_review.project_id;
  end if;

  v_quote := home.create_quote(
    p_element_id => v_element,
    p_project_id => case when v_element is null then v_review.project_id end,
    p_supplier => v_review.supplier,
    p_detail => coalesce(v_review.detail, v_review.category),
    p_amount => v_review.amount,
    p_amount_incl_gst => v_review.amount_incl_gst,
    p_kind => case when v_review.kind = 'quote' then 'quote' else 'invoice' end::home.project_quote_kind,
    p_dated => v_review.dated,
    p_due_on => case when v_review.kind = 'invoice' then v_review.due_on end,
    p_invoice_number => v_review.invoice_number,
    p_photo_paths => v_review.photo_paths,
    p_document_paths => v_review.document_paths
  );

  if v_element is null and cardinality(coalesce(v_room_ids, '{}')) > 0 then
    perform home.set_quote_rooms(v_quote.id, v_room_ids, v_room_amounts);
  end if;

  if v_review.kind = 'invoice' and v_review.paid and v_review.amount is not null then
    perform home.add_payment(
      p_quote_id => v_quote.id,
      p_amount => v_review.amount,
      p_amount_incl_gst => v_review.amount_incl_gst,
      p_paid_on => v_review.paid_on,
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

revoke execute on function home.approve_invoice_review(uuid, uuid) from public, anon;
grant execute on function home.approve_invoice_review(uuid, uuid) to authenticated;

-- ------------------------------------------------------------ filing paperwork

-- Where a certificate goes: onto a bill already on the job (the electrician's
-- invoice, for their certificate), onto a part, or onto the job itself. Its
-- files are appended to that row's own, so they roll up through
-- `home.project_files` exactly as a file attached by hand does, and no figure
-- anywhere changes. A bill and a part together is refused — a file lives at
-- one level, the rule `project_files` is built on.
create function home.file_review_paperwork(
  p_review_id uuid,
  p_quote_id uuid default null,
  p_element_id uuid default null
)
returns home.invoice_reviews
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_review home.invoice_reviews;
begin
  select * into v_review from home.invoice_reviews where id = p_review_id;

  if v_review.id is null then
    raise exception 'No such invoice';
  end if;

  perform home.require_project_member(v_review.project_id);

  if v_review.state <> 'pending' then
    raise exception 'That one has already been ruled on';
  end if;

  if v_review.kind <> 'paperwork' then
    raise exception 'Only paperwork is filed — a bill or a quote is added as a price';
  end if;

  if p_quote_id is not null and p_element_id is not null then
    raise exception 'Paperwork goes on a bill or a part, not both';
  end if;

  if p_quote_id is not null then
    if home.quote_project(p_quote_id) is distinct from v_review.project_id then
      raise exception 'That bill belongs to another job';
    end if;
    update home.project_quotes set
      photo_paths = photo_paths || v_review.photo_paths,
      document_paths = document_paths || v_review.document_paths,
      updated_at = now()
    where id = p_quote_id;
  elsif p_element_id is not null then
    if home.element_project(p_element_id) is distinct from v_review.project_id then
      raise exception 'That part belongs to another job';
    end if;
    update home.project_elements set
      photo_paths = photo_paths || v_review.photo_paths,
      document_paths = document_paths || v_review.document_paths
    where id = p_element_id;
  else
    update home.projects set
      photo_paths = photo_paths || v_review.photo_paths,
      document_paths = document_paths || v_review.document_paths
    where id = v_review.project_id;
  end if;

  update home.invoice_reviews set
    state = 'approved',
    quote_id = p_quote_id,
    element_id = p_element_id,
    decided_at = now(),
    decided_by = auth.uid(),
    updated_at = now()
  where id = p_review_id
  returning * into v_review;

  return v_review;
end;
$$;

revoke execute on function home.file_review_paperwork(uuid, uuid, uuid) from public, anon;
grant execute on function home.file_review_paperwork(uuid, uuid, uuid) to authenticated;

-- ------------------------------------------------------------ who "you" is

-- The names of the people on the job's place, so a reading can tell a bill
-- addressed to the household from a subcontractor's bill addressed to the
-- builder. The invoice says "for Mike Turner"; the model has to know that is
-- the person forwarding it. The function (service role, no user) and the
-- *Read again* path (a member) both ask; anyone else is refused.
create function home.project_people(p_project_id uuid)
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null then
    perform home.require_project_member(p_project_id);
  end if;

  return coalesce((
    select array_agg(pr.display_name order by pr.display_name)
    from home.projects p
    join home.property_members pm on pm.property_id = p.property_id
    join home.profiles pr on pr.id = pm.profile_id
    where p.id = p_project_id
      and pr.deleted_at is null
  ), '{}');
end;
$$;

revoke execute on function home.project_people(uuid) from public, anon;
grant execute on function home.project_people(uuid) to authenticated, service_role;
