-- An invoice arrives before anybody has decided what it is.
--
-- Every money row in this schema is something a person typed while looking at a
-- piece of paper. That is the rule the whole feature rests on — *nothing reads a
-- figure out of an attachment* — and it is why `project_quotes` has no "draft"
-- and no "unconfirmed". A row in that table counts.
--
-- What it has never had is somewhere to put a bill that has **arrived but not
-- been understood**. A bill turns up by email, and between it landing and it
-- being recorded there is a judgement nobody has made yet: is this ours, which
-- job is it against, has it already been paid, is the figure what we agreed.
-- Today that judgement happens in somebody's head at a desk and the only record
-- of the ones they decided against is that they never typed them in — so the
-- same invoice gets looked at, dismissed, and looked at again next month.
--
-- `home.invoice_reviews` is that waiting room. One row per bill somebody has
-- seen but not yet ruled on, carrying whatever could be read off the email and
-- saying, field by field, which parts were **read** and which were **guessed**.
--
-- ------------------------------------------------- a pending row is not money
--
-- **It is its own table, and that is the load-bearing decision.** The cheap
-- shape is a `state` column on `project_quotes` — and it is wrong for exactly
-- the reason `needs_parts` stopped being a column: every rollup expression in
-- this schema would then have to remember to exclude it. There are eleven of
-- them, they are the most dangerous arithmetic in the app, and one that forgot
-- would put a bill nobody has approved inside Committed with nothing on screen
-- able to say so. A separate table makes that **unrepresentable** rather than
-- merely avoided: not one view below changes, because there is nothing for them
-- to see.
--
-- So a pending invoice reaches no figure. Not Quoted, not Committed, not
-- Invoiced, not Forecast. It is a question, and a question is not a commitment.
--
-- -------------------------------------------------------- approving is a door
--
-- `approve_invoice_review` does not insert into `project_quotes`. It calls
-- **`home.create_quote`**, the one door every other price in this app comes
-- through, so an approved bill is indistinguishable from one typed by hand and
-- every refusal that function already makes still applies — the scope check,
-- the claim rule, the level count. A second insert path would be a second way
-- for a bill to reach a total, which is the failure this schema keeps naming.
--
-- The review row is kept afterwards rather than deleted, pointing at what it
-- became. "Where did this figure come from" is answerable for as long as the
-- job exists, which is the same argument `project_overrides` makes for keeping
-- the derived figure beside the typed one.
--
-- --------------------------------------------- declining is not deleting, yet
--
-- Swiping a card away is a judgement made in a second, and a judgement made in
-- a second is the one most likely to be wrong. `declined` is a **state**, so
-- the row stays and can be put back by `restore_invoice_review`. Nothing is
-- lost by the gesture that is easiest to make by accident.
--
-- `delete_invoice_review` is the hard one and it is deliberately separate, for
-- the reason `set_part_bought` and `clear_figure` are separate: the act that
-- destroys something must not be reachable from the form somebody happened to
-- swipe.
--
-- ------------------------------------------- the paid flag carries its reason
--
-- `paid` is an **inference** — read off a thread where somebody replied "this
-- is now paid" — and an inference presented as a fact is how a record stops
-- being believed. So it never travels alone: `paid_evidence` holds the sentence
-- it was drawn from, and the card prints it under the answer. A reader who
-- disagrees can see exactly what was read and say no.
--
-- Approving a paid one records `add_payment` for what the row says, and **only
-- when there is an amount**. An unpriced bill contributes nothing rather than
-- nought — `sum` over nothing is null here, never 0, which is the one lie this
-- feature cannot tell.
--
-- `inferred` names the columns that were guessed rather than read, so the card
-- can mark them without a second table saying the same thing a second way.

create type home.invoice_review_state as enum ('pending', 'approved', 'declined');

create table home.invoice_reviews (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references home.projects(id) on delete cascade,

  -- Where it will land if approved. Null is the whole job, which is the right
  -- default and the rule the project page already states: a bill maps to
  -- something that exists or it is against the job. It never invents a part.
  element_id uuid references home.project_elements(id) on delete set null,

  supplier text,
  detail text,
  amount numeric,
  amount_incl_gst boolean not null default true,
  invoice_number text,
  dated date,
  due_on date,

  -- The inference and the sentence behind it. Never one without the other.
  paid boolean not null default false,
  paid_on date,
  paid_evidence text,

  -- What the email suggests this is. Free text on purpose: a fixed vocabulary
  -- would need administering before a single bill could be filed, and this app
  -- does not do setup.
  category text,

  -- Where it came from, so the card can say so and a duplicate can be spotted.
  source_ref text,
  source_subject text,
  source_from text,
  source_at timestamptz,

  -- The columns whose values were guessed rather than read off the email.
  inferred text[] not null default '{}',

  state home.invoice_review_state not null default 'pending',
  quote_id uuid references home.project_quotes(id) on delete set null,
  decided_at timestamptz,
  decided_by uuid references home.profiles(id),

  created_at timestamptz not null default now(),
  created_by uuid references home.profiles(id),
  updated_at timestamptz not null default now()
);

create index on home.invoice_reviews (project_id, state);
create index on home.invoice_reviews (quote_id);

-- One card per bill per job. A second sweep of the same mailbox must not put
-- the same invoice in front of somebody twice — and a partial index means only
-- rows that actually name a source are held to it.
create unique index invoice_reviews_one_per_source
  on home.invoice_reviews (project_id, source_ref, invoice_number)
  where source_ref is not null;

alter table home.invoice_reviews enable row level security;

-- Read by project membership, the same walk `project_elements` makes. No
-- insert/update/delete policy, as everywhere else in this schema: the functions
-- below are the only writers.
create policy "members read their invoice reviews"
  on home.invoice_reviews for select using (
    exists (
      select 1 from home.projects p
      where p.id = home.invoice_reviews.project_id
        and home.is_property_member(p.property_id)
    )
  );

grant select on home.invoice_reviews to authenticated;

-- ------------------------------------------------------------------ the writes

create function home.create_invoice_review(
  p_project_id uuid,
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
  p_category text default null,
  p_element_id uuid default null,
  p_source_ref text default null,
  p_source_subject text default null,
  p_source_from text default null,
  p_source_at timestamptz default null,
  p_inferred text[] default '{}'
)
returns home.invoice_reviews
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_review home.invoice_reviews;
begin
  perform home.require_project_member(p_project_id);

  if p_element_id is not null
     and home.element_project(p_element_id) is distinct from p_project_id then
    raise exception 'That part belongs to another job';
  end if;

  insert into home.invoice_reviews (
    project_id, element_id, supplier, detail, amount, amount_incl_gst,
    invoice_number, dated, due_on, paid, paid_on, paid_evidence, category,
    source_ref, source_subject, source_from, source_at, inferred, created_by
  )
  values (
    p_project_id, p_element_id,
    nullif(btrim(coalesce(p_supplier, '')), ''),
    nullif(btrim(coalesce(p_detail, '')), ''),
    p_amount, coalesce(p_amount_incl_gst, true),
    nullif(btrim(coalesce(p_invoice_number, '')), ''),
    p_dated, p_due_on,
    coalesce(p_paid, false), p_paid_on,
    nullif(btrim(coalesce(p_paid_evidence, '')), ''),
    nullif(btrim(coalesce(p_category, '')), ''),
    nullif(btrim(coalesce(p_source_ref, '')), ''),
    nullif(btrim(coalesce(p_source_subject, '')), ''),
    nullif(btrim(coalesce(p_source_from, '')), ''),
    p_source_at, coalesce(p_inferred, '{}'), auth.uid()
  )
  returning * into v_review;

  return v_review;
end;
$$;

revoke execute on function home.create_invoice_review(uuid, text, text, numeric,
  boolean, text, date, date, boolean, date, text, text, uuid, text, text, text,
  timestamptz, text[]) from public, anon;
grant execute on function home.create_invoice_review(uuid, text, text, numeric,
  boolean, text, date, date, boolean, date, text, text, uuid, text, text, text,
  timestamptz, text[]) to authenticated;

-- Correcting a card before ruling on it. `p_clear` is this schema's convention
-- for *set it to nothing* as against *leave it alone*, because an emptied box
-- is somebody saying they no longer know rather than declining to answer.
--
-- It deliberately does not take `state`. Approving and declining are what
-- change what the page claims, so they are their own functions — the argument
-- `set_part_bought` and `set_quote_status` are separate for — and a caller
-- cannot smuggle an approval in beside a corrected supplier name.
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
  p_clear text[] default '{}'
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

  -- A field somebody has just answered is no longer a guess, and neither is one
  -- they deliberately emptied. This is the only place `inferred` shrinks, and it
  -- has to shrink here or the card goes on flagging an answer its reader has
  -- already given.
  v_answered := v_clear
    || case when p_supplier is not null then array['supplier'] else '{}' end
    || case when p_amount is not null then array['amount'] else '{}' end
    || case when p_invoice_number is not null then array['invoice_number'] else '{}' end
    || case when p_dated is not null then array['dated'] else '{}' end
    || case when p_due_on is not null then array['due_on'] else '{}' end
    || case when p_paid is not null then array['paid'] else '{}' end
    || case when p_category is not null then array['category'] else '{}' end;

  select coalesce(array_agg(f), '{}'::text[]) into v_inferred
  from unnest(v_review.inferred) as f
  where not (f = any(v_answered));

  update home.invoice_reviews set
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
    paid = coalesce(p_paid, paid),
    paid_on = case when 'paid_on' = any(v_clear) then null else coalesce(p_paid_on, paid_on) end,
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
  boolean, text, date, date, boolean, date, text, uuid, text[]) from public, anon;
grant execute on function home.update_invoice_review(uuid, text, text, numeric,
  boolean, text, date, date, boolean, date, text, uuid, text[]) to authenticated;

-- Yes. It becomes a real bill, through the one door.
--
-- Note what is *not* here: no insert into `project_quotes`, no figure computed
-- on the way past, and no second opinion about GST. `create_quote` takes the
-- amount exactly as it was typed along with what that number meant, and the
-- views normalise, as they do for every other price in this app.
create function home.approve_invoice_review(
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

  -- Exactly one of the two is passed, which is what `create_quote` insists on.
  -- A part when one was chosen, the whole job when none was.
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
    p_notes => v_review.invoice_number
  );

  -- The paid inference, made real — and only where there is a figure for it to
  -- be about. A payment of nothing is not a record of anything.
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

-- No. It leaves the deck and nothing else happens to it.
create function home.decline_invoice_review(p_review_id uuid)
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

  if v_review.state = 'approved' then
    raise exception 'That one is already on the job — remove the bill instead';
  end if;

  update home.invoice_reviews set
    state = 'declined', decided_at = now(), decided_by = auth.uid(), updated_at = now()
  where id = p_review_id
  returning * into v_review;

  return v_review;
end;
$$;

revoke execute on function home.decline_invoice_review(uuid) from public, anon;
grant execute on function home.decline_invoice_review(uuid) to authenticated;

-- The undo. A declined card goes back into the deck exactly as it was — the
-- whole reason declining is a state rather than a delete.
--
-- An approved one is deliberately not restorable here: it has a bill hanging
-- off it now, and putting the card back while the money stayed would be two
-- records of one invoice. Removing the bill is how that is undone.
create function home.restore_invoice_review(p_review_id uuid)
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

  if v_review.state <> 'declined' then
    raise exception 'That one has not been removed';
  end if;

  update home.invoice_reviews set
    state = 'pending', decided_at = null, decided_by = null, updated_at = now()
  where id = p_review_id
  returning * into v_review;

  return v_review;
end;
$$;

revoke execute on function home.restore_invoice_review(uuid) from public, anon;
grant execute on function home.restore_invoice_review(uuid) to authenticated;

-- For good. Its own function, so the gesture that removes a card and the one
-- that destroys it can never be the same press.
create function home.delete_invoice_review(p_review_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project uuid;
begin
  select project_id into v_project from home.invoice_reviews where id = p_review_id;

  if v_project is null then
    raise exception 'No such invoice';
  end if;

  perform home.require_project_member(v_project);
  delete from home.invoice_reviews where id = p_review_id;
end;
$$;

revoke execute on function home.delete_invoice_review(uuid) from public, anon;
grant execute on function home.delete_invoice_review(uuid) to authenticated;

-- ------------------------------------------------------- one walk, still
--
-- `project_page` gains `invoiceReviews` rather than the screen gaining a
-- fifteenth request. The whole argument of `20260921100200` is that this pool
-- is ten connections and a page that asks separately is a page that queues, and
-- a bell whose count arrives on its own round trip is exactly the request that
-- would be in flight while somebody presses something else.
--
-- Pending first, then the bin, newest first inside each: the deck is what the
-- screen is for and the removed ones are what it keeps in case somebody was
-- wrong. Approved rows come too — they are how a figure on the page answers
-- "where did this come from", and there are never many.
--
-- Replaced rather than rebuilt, keeping every other key exactly as it was, so
-- no figure on this page can arrive a second way.
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
