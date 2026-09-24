-- A bill can say which rooms it is for, and how it splits between them.
--
-- A tile order goes on the bathroom floor and the laundry splashback. Until now
-- a bill could sit on **one** part of the job or on the whole job, so that order
-- was either filed under one room it only half belonged to, or under *Whole
-- job*, where nothing said which rooms it was for at all. Eight months on,
-- "which tile went in the laundry" had no answer on the record.
--
-- ----------------------------------------------- the money is still in one place
--
-- **A shared price stays on the whole job, and this table only says how the
-- room breakdown reads it.** A quote attaches to exactly one level, and every
-- rollup view sums it from that one place. Moving it would mean a quote at two
-- scopes, which is the one shape this schema is built to make impossible, so
-- nothing here reaches a view: Committed, Invoiced, Paid, the supplier rows,
-- the bills — not one expression changes.
--
-- What moves is the **room breakdown** on the project page, which is already
-- the rooms plus a *Whole job* row holding whatever belongs to no room. A share
-- takes its slice out of *Whole job* and puts it on the room, so the rows still
-- add up to the total by construction: a split can say the wrong room, but it
-- cannot make the total say the wrong number.
--
-- --------------------------------------------------------- three answers, not two
--
-- - **No rooms** — the whole job, as before.
-- - **Rooms with no amounts** — *which rooms*, without saying *how much each*.
--   That is often the true answer: the builder's contract covers the bathroom
--   and the laundry and nobody itemised it. The rooms are on record, and the
--   money stays on *Whole job*, where a guess would otherwise have put it.
-- - **Rooms with amounts** — a split. Evenly is arithmetic the app does and
--   stores as amounts, so a split reads back as the dollars it moved. What the
--   amounts do not cover stays on *Whole job*; they can never add up to more
--   than the bill.
--
-- Amounts are in the bill's own GST basis — the figure as it was typed, like
-- every other amount here — and are grossed with the bill's own flag.
--
-- --------------------------------------------------------- what can be shared
--
-- Only a price on the **whole job**. One on a part of the job already says which
-- room; one on a thing is in its thing's room. And never a **claim**: it sits
-- where its contract sits and counts through it, so the contract is what gets
-- shared.
--
-- `set_quote_rooms` replaces the whole set in one call, for the reason
-- `set_snag_things` does: a picker with a Done button is answering one question,
-- and two calls would let a half-finished answer reach the row. It touches
-- nothing on the quote itself, so it cannot move a status or a total.
--
-- ---------------------------------------------------------- a bill still waiting
--
-- A card in *Bills waiting* is answered the same way before it counts.
-- `set_invoice_review_rooms` is the one writer of where a card will land:
-- one room puts the bill **on** that room, exactly as before; two or more keep
-- it on the whole job and carry the rooms and the split into
-- `set_quote_rooms` when the card is allocated.

create table home.project_quote_rooms (
  quote_id uuid not null references home.project_quotes(id) on delete cascade,
  -- Cascade: taking a room off the job hands its share back to *Whole job*,
  -- which is where money that belongs to no room already lives.
  element_id uuid not null references home.project_elements(id) on delete cascade,
  -- Null is "for this room, share not said". Never zero: a room with nothing of
  -- the bill is a room it is not for.
  amount numeric check (amount is null or amount > 0),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (quote_id, element_id)
);

create index on home.project_quote_rooms (element_id);

alter table home.project_quote_rooms enable row level security;

-- Whoever can read the price can read which rooms it is for — the same walk
-- `project_quote_lines` makes. No write policies: `set_quote_rooms` is the one
-- writer.
create policy "members read which rooms a price is for"
  on home.project_quote_rooms for select using (
    exists (select 1 from home.project_quotes q where q.id = home.project_quote_rooms.quote_id)
  );

grant select on home.project_quote_rooms to authenticated;

alter table home.invoice_reviews
  add column room_ids uuid[] not null default '{}',
  add column room_amounts numeric[];

-- ------------------------------------------------------------------ the writers

-- The checks a set of rooms has to pass wherever it is written. Raises in words;
-- returns nothing. Only ever called from inside the two functions below.
create function home.check_room_split(
  p_project_id uuid,
  p_element_ids uuid[],
  p_amounts numeric[],
  p_total numeric
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_n integer := cardinality(coalesce(p_element_ids, '{}'));
begin
  if (select count(distinct x) from unnest(coalesce(p_element_ids, '{}')) x) <> v_n then
    raise exception 'The same room is in there twice';
  end if;

  if exists (
    select 1 from unnest(coalesce(p_element_ids, '{}')) x
    where home.element_project(x) is distinct from p_project_id
  ) then
    raise exception 'That room belongs to another job';
  end if;

  if p_amounts is null then
    return;
  end if;

  if cardinality(p_amounts) <> v_n then
    raise exception 'Every room needs its share, or none of them does';
  end if;

  if exists (select 1 from unnest(p_amounts) a where a is null or a <= 0) then
    raise exception 'Each room''s share has to be more than nothing';
  end if;

  if p_total is null then
    raise exception 'Put a figure on it before splitting it';
  end if;

  if (select sum(a) from unnest(p_amounts) a) > p_total + 0.005 then
    raise exception 'The rooms add up to more than the bill';
  end if;
end;
$$;

revoke execute on function home.check_room_split(uuid, uuid[], numeric[], numeric)
  from public, anon, authenticated;

create function home.set_quote_rooms(
  p_quote_id uuid,
  p_element_ids uuid[],
  p_amounts numeric[] default null
)
returns setof home.project_quote_rooms
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_quote home.project_quotes;
begin
  select * into v_quote from home.project_quotes where id = p_quote_id;

  if v_quote.id is null then
    raise exception 'No such price';
  end if;

  perform home.require_project_member(v_quote.reach_project_id);

  if v_quote.project_id is null then
    raise exception 'This one already belongs to one room. Only a price on the whole job can be shared between rooms.';
  end if;

  if v_quote.against_quote_id is not null then
    raise exception 'A claim follows its contract — share the contract between rooms instead.';
  end if;

  perform home.check_room_split(v_quote.project_id, p_element_ids, p_amounts, v_quote.amount);

  delete from home.project_quote_rooms where quote_id = p_quote_id;

  insert into home.project_quote_rooms (quote_id, element_id, amount, sort_order)
  select p_quote_id, r.id,
         case when p_amounts is null then null else round(p_amounts[r.ord], 2) end,
         r.ord - 1
  from unnest(coalesce(p_element_ids, '{}')) with ordinality as r(id, ord);

  return query
    select * from home.project_quote_rooms where quote_id = p_quote_id order by sort_order;
end;
$$;

revoke execute on function home.set_quote_rooms(uuid, uuid[], numeric[]) from public, anon;
grant execute on function home.set_quote_rooms(uuid, uuid[], numeric[]) to authenticated;

-- Where a waiting bill will land. None: the whole job. One: on that room, as
-- `element_id` always meant. Two or more: on the whole job, shared.
create function home.set_invoice_review_rooms(
  p_review_id uuid,
  p_element_ids uuid[],
  p_amounts numeric[] default null
)
returns home.invoice_reviews
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_review home.invoice_reviews;
  v_ids uuid[] := coalesce(p_element_ids, '{}');
begin
  select * into v_review from home.invoice_reviews where id = p_review_id;

  if v_review.id is null then
    raise exception 'No such invoice';
  end if;

  perform home.require_project_member(v_review.project_id);

  if v_review.state <> 'pending' then
    raise exception 'That one has already been ruled on';
  end if;

  perform home.check_room_split(
    v_review.project_id, v_ids,
    case when cardinality(v_ids) > 1 then p_amounts end,
    v_review.amount
  );

  update home.invoice_reviews set
    element_id = case when cardinality(v_ids) = 1 then v_ids[1] end,
    room_ids = case when cardinality(v_ids) > 1 then v_ids else '{}' end,
    room_amounts = case when cardinality(v_ids) > 1 then p_amounts end,
    updated_at = now()
  where id = p_review_id
  returning * into v_review;

  return v_review;
end;
$$;

revoke execute on function home.set_invoice_review_rooms(uuid, uuid[], numeric[]) from public, anon;
grant execute on function home.set_invoice_review_rooms(uuid, uuid[], numeric[]) to authenticated;

-- ------------------------------------------ allocating carries the rooms across

-- As `20260924090000`, plus: a card shared between rooms becomes a bill on the
-- whole job with its rooms, through `set_quote_rooms` — the same writer a price
-- edited on the page goes through. A room taken off the job while the card
-- waited is dropped rather than refusing the card; its share stays on the whole
-- job, which is where it would have gone anyway.
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
    p_kind => 'invoice',
    p_dated => v_review.dated,
    p_due_on => v_review.due_on,
    p_notes => v_review.invoice_number,
    p_photo_paths => v_review.photo_paths,
    p_document_paths => v_review.document_paths
  );

  if v_element is null and cardinality(coalesce(v_room_ids, '{}')) > 0 then
    perform home.set_quote_rooms(v_quote.id, v_room_ids, v_room_amounts);
  end if;

  if v_review.paid and v_review.amount is not null then
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

-- ------------------------------------------------------- the page reads them

-- As `20260922100000`, plus `quoteRooms`. SECURITY INVOKER, so the read policy
-- above filters it exactly as it filters the prices it belongs to.
create or replace function home.project_page(p_project_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_project jsonb;
begin
  select to_jsonb(p) into v_project
  from home.projects_with_totals p
  where p.id = p_project_id;

  if v_project is null then
    raise exception 'Couldn''t load that project';
  end if;

  return jsonb_build_object(
    'project', v_project,

    'elements', coalesce((select jsonb_agg(to_jsonb(e) order by e.sort_order)
      from home.project_elements_with_totals e
      where e.project_id = p_project_id), '[]'::jsonb),

    'items', coalesce((select jsonb_agg(to_jsonb(i) order by i.sort_order)
      from home.project_items_with_totals i
      join home.project_elements pe on pe.id = i.element_id
      where pe.project_id = p_project_id), '[]'::jsonb),

    'quotes', coalesce((select jsonb_agg(to_jsonb(q) order by q.created_at)
      from home.project_quotes_with_totals q
      where q.reach_project_id = p_project_id), '[]'::jsonb),

    'quoteRooms', coalesce((select jsonb_agg(to_jsonb(qr) order by qr.quote_id, qr.sort_order)
      from home.project_quote_rooms qr
      join home.project_quotes qrq on qrq.id = qr.quote_id
      where qrq.reach_project_id = p_project_id), '[]'::jsonb),

    'lines', coalesce((select jsonb_agg(to_jsonb(l) order by l.sort_order)
      from home.project_quote_lines l
      join home.project_quotes lq on lq.id = l.quote_id
      where lq.reach_project_id = p_project_id), '[]'::jsonb),

    'payments', coalesce((select jsonb_agg(to_jsonb(pay) order by pay.paid_on)
      from home.project_payments pay
      join home.project_quotes payq on payq.id = pay.quote_id
      where payq.reach_project_id = p_project_id), '[]'::jsonb),

    'milestones', coalesce((select jsonb_agg(to_jsonb(ms) order by ms.sort_order)
      from home.project_milestones ms
      join home.project_quotes msq on msq.id = ms.quote_id
      where msq.reach_project_id = p_project_id), '[]'::jsonb),

    'expected', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at)
      from home.project_expected_costs x
      where x.project_id = p_project_id), '[]'::jsonb),

    'expectedCostLines', coalesce((select jsonb_agg(to_jsonb(xl) order by xl.created_at)
      from home.project_expected_cost_lines xl
      join home.project_expected_costs xp on xp.id = xl.expected_cost_id
      where xp.project_id = p_project_id), '[]'::jsonb),

    'bills', coalesce((select jsonb_agg(to_jsonb(b) order by b.due_on asc nulls last)
      from home.project_bills b
      where b.project_id = p_project_id), '[]'::jsonb),

    'suppliers', coalesce((select jsonb_agg(to_jsonb(s))
      from home.project_supplier_totals s
      where s.project_id = p_project_id), '[]'::jsonb),

    'files', coalesce((select jsonb_agg(to_jsonb(f))
      from home.project_files f
      where f.project_id = p_project_id), '[]'::jsonb),

    'things', coalesce((select jsonb_agg(to_jsonb(t))
      from home.things_with_details t
      where t.project_id = p_project_id), '[]'::jsonb),

    'snags', coalesce((select jsonb_agg(to_jsonb(sn) order by sn.created_at desc)
      from home.snags_with_details sn
      where sn.project_id = p_project_id), '[]'::jsonb),

    'invoiceReviews', coalesce((select jsonb_agg(to_jsonb(ir)
        order by (ir.state <> 'pending'), ir.source_at desc nulls last, ir.created_at desc)
      from home.invoice_reviews ir
      where ir.project_id = p_project_id), '[]'::jsonb)
  );
end;
$$;

revoke execute on function home.project_page(uuid) from public, anon;
grant execute on function home.project_page(uuid) to authenticated;
