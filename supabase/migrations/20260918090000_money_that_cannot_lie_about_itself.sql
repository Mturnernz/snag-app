-- Money that cannot lie about itself — the second pass.
--
-- The first pass gave a project three figures: Quoted, Chosen and Spent. Lived
-- with, all three were wrong in a way that only shows up against a real
-- renovation:
--
--   * **`spent` summed invoices and receipts together.** Record an invoice and
--     then the payment settling it and the project reads twice what it cost.
--     Nobody had hit it yet only because `receipt` was being used to mean "paid
--     in full, no invoice" — the bug was latent, not absent, and the first
--     deposit-then-balance would have sprung it.
--   * **An invoice with nothing quoted behind it counted as spent and not as
--     committed.** A consultant billing time by the month — three invoices, no
--     quote, ever — left the item reading "not priced" while money went out of
--     the door. `committed - paid` on that shape is negative.
--   * **`Quoted` answered a question nobody asks after the first fortnight**:
--     the low-to-high band across undecided quotes. It is dropped here, and the
--     early warning it was standing in for is now per line and far better
--     (below).
--
-- This migration replaces the money model with one that cannot express those.
--
-- ---------------------------------------------------------------------------
-- **A builder's number is not one number.**
--
-- ReliaBuilder's $176,755 is a list: demolition, labour, waterproofing — and,
-- against the fittings and the tiles, an *allowance*. A figure the builder wrote
-- down for something they are not themselves supplying, or have not yet priced.
-- In a New Zealand building contract these are provisional and PC sums, and they
-- are the lines that move. They are the reason a renovation goes over.
--
-- So a quote carries **lines**, a line may be an **allowance**, and a later quote
-- **supersedes** the line it was got for. When the plumbing merchant quotes $890
-- for the toilet, that quote points at the *Bathroom fittings* line; once it is
-- accepted, the line contributes what was actually quoted instead of what was
-- allowed. The price build gets more granular as real numbers arrive.
--
-- Four rules make that honest, and each prevents one failure:
--
--   1. **Money is summed from exactly one place.** A quote that supersedes a line
--      contributes only through that line, never also on its own account. That is
--      the whole answer to "is the toilet inside the contract" — linking is the
--      answer, and linking is the same act that produces the breakdown. A quote
--      pointing at nothing is a separate purchase and sums normally. The failure
--      this prevents is the one the element layer already names: a rollup with two
--      paths to sum through is how a total starts disagreeing with itself.
--   2. **A quote says whether its number can move.** `basis` is `fixed` or
--      `estimate`. A fixed-price contract stays what it says whatever the fittings
--      cost — the variance is the builder's, and a real change costs a variation,
--      which is a new quote. An estimate moves. The app cannot infer which it is
--      holding and guessing would be a lie about somebody's contract, so it asks,
--      once, and defaults to `fixed` — the answer that does not silently move.
--   3. **A recomputed total says how much of itself is still a guess.**
--      `allowance_open` rides beside every build-up for the same reason
--      `item_count` rides beside every sum: a figure two thirds of which the
--      builder made up is exactly as misleading as a total assembled from half
--      the items.
--   4. **An allowance is not an unpriced item.** An unpriced item contributes
--      nothing and is counted in the denominator. An allowance is somebody's
--      written number and it counts. The two are never worded the same — "not
--      priced" against "still an allowance" — or the denominator stops meaning
--      anything.
--
-- ---------------------------------------------------------------------------
-- **A payment is not a bill.**
--
-- `home.project_payments` hangs off the invoice it settles, so a deposit and a
-- balance are two payments against one invoice, which is what actually happens
-- and what sibling rows could not say. The double-count is not fixed so much as
-- made unrepresentable: a payment is no longer the sort of row that can be summed
-- alongside a bill.
--
-- `receipt` leaves the vocabulary. A receipt is a payment's evidence, not a third
-- kind of paper: existing rows become an invoice plus a payment settling it in
-- full on the same date, so both figures survive. The enum value stays, unused
-- and unoffered, because Postgres cannot drop one — the same shape as
-- `household_members.role` sitting in the schema with nothing reading it.
--
-- ---------------------------------------------------------------------------
-- **Four figures, and the fourth is a fact about each amount.**
--
--   Committed — what has been agreed. The accepted quote at a level, or, when
--               nothing was ever quoted there, the invoices themselves: a bill
--               for work nobody priced is still a commitment, and this is the
--               shape a consultant billing by the month actually has.
--   Invoiced  — what has been charged.
--   Paid      — what has gone out.
--   Outstanding — committed less paid.
--
-- All four are derived in the views and none is stored, which is the `needs_parts`
-- argument applied to a far more dangerous number: a maintained total and the
-- quotes it describes will disagree the first time somebody edits an amount from
-- the other phone.

-- ---------------------------------------------------------------- enums

-- Three states, where there was a boolean. `chosen` could only ever mean "not
-- chosen", which conflated "we have not decided" with "we turned this down" —
-- and the second is worth keeping, because what you were quoted and by whom is
-- what makes the next renovation's numbers credible.
create type home.project_quote_status as enum ('tbc', 'accepted', 'declined');

-- Whether this number can move. See rule 2 above.
create type home.project_quote_basis as enum ('fixed', 'estimate');

-- ------------------------------------------------------- out of the way first
--
-- Every rollup reads `chosen`, so none of them can be standing when it goes.
-- They are recreated whole in `20260918090200` — between these two files the
-- project screens have nothing to read, which is why the two are applied
-- together and why neither is merged on its own.

drop view if exists home.projects_with_totals;
drop view if exists home.project_files;
drop view if exists home.project_elements_with_totals;
drop view if exists home.project_items_with_totals;

-- ---------------------------------------------------------------- quotes

alter table home.project_quotes
  add column status home.project_quote_status not null default 'tbc',
  add column basis  home.project_quote_basis  not null default 'fixed',
  -- A quote attaches to exactly one level. ReliaBuilder's contract covers the
  -- whole downstairs, so it belongs to neither the toilet nor one room.
  add column element_id uuid references home.project_elements(id) on delete cascade,
  add column project_id uuid references home.projects(id) on delete cascade,
  -- The line this quote was got for. `set null`, never cascade: deleting the
  -- contract must not delete the plumber's quote — it comes unlinked and starts
  -- summing on its own account, which is what the contract going away means.
  add column supersedes_line_id uuid;

alter table home.project_quotes alter column item_id drop not null;

update home.project_quotes
   set status = case
     when chosen then 'accepted'
     -- An invoice is not a thing you choose between. It is a bill, and it is
     -- agreed by having arrived.
     when kind in ('invoice', 'receipt') then 'accepted'
     else 'tbc'
   -- Cast explicitly: a `case` over string literals is `text`, and Postgres will
   -- not coerce that to an enum on assignment.
   end::home.project_quote_status;

alter table home.project_quotes
  add constraint project_quotes_one_owner check (
    (item_id is not null)::int + (element_id is not null)::int + (project_id is not null)::int = 1
  );

drop index if exists home.project_quotes_one_chosen;
alter table home.project_quotes drop column chosen;

-- At most one accepted *quote* per item — still enforced rather than hoped for,
-- because two would make the item's contribution depend on row order. It is
-- deliberately narrowed to `kind = 'quote'`: the main contract item already
-- carries an accepted quote and two accepted progress claims, and those are not
-- competing answers to the same question.
--
-- No such index at element or project level: a renovation can hold two contracts
-- at once (a builder and an electrician), and they sum.
create unique index project_quotes_one_accepted
  on home.project_quotes (item_id)
  where item_id is not null and kind = 'quote' and status = 'accepted';

create index on home.project_quotes (element_id);
create index on home.project_quotes (project_id);
create index on home.project_quotes (supersedes_line_id);

-- ---------------------------------------------------------------- lines

create table home.project_quote_lines (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references home.project_quotes(id) on delete cascade,

  name text not null check (length(btrim(name)) between 1 and 80),
  -- "Caroma Luna Cleanflush". This is where "the toilet model and its cost"
  -- lands, and it is the field the house record reads a model number out of.
  detail text check (detail is null or length(btrim(detail)) <= 200),

  amount numeric(12, 2) check (amount is null or amount between 0 and 99999999),
  amount_incl_gst boolean not null default true,

  -- A placeholder with a number on it, rather than a price.
  is_allowance boolean not null default false,

  sort_order integer not null default 0,
  created_by uuid not null references home.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index on home.project_quote_lines (quote_id, sort_order);

alter table home.project_quote_lines enable row level security;

create policy "members read their quote lines"
  on home.project_quote_lines for select using (
    exists (
      select 1 from home.project_quotes q
      where q.id = home.project_quote_lines.quote_id
    )
  );

grant select on home.project_quote_lines to authenticated;

-- Added after the table exists, because it points at it.
alter table home.project_quotes
  add constraint project_quotes_supersedes_fkey
  foreign key (supersedes_line_id) references home.project_quote_lines(id) on delete set null;

-- Only a quote supersedes a line. An invoice is what was charged, never a
-- competing answer to what something might cost, and letting one supersede would
-- give `invoiced` two paths to travel.
alter table home.project_quotes
  add constraint project_quotes_only_a_quote_supersedes check (
    supersedes_line_id is null or kind = 'quote'
  );

-- ---------------------------------------------------------------- payments

create table home.project_payments (
  id uuid primary key default gen_random_uuid(),
  -- The invoice it settles. Not an item, not a project: a payment with no bill
  -- behind it is the sibling-row shape this table exists to end.
  quote_id uuid not null references home.project_quotes(id) on delete cascade,

  amount numeric(12, 2) not null check (amount between 0 and 99999999),
  amount_incl_gst boolean not null default true,

  paid_on date,
  -- "Deposit", "Progress claim 2". What the bank statement will call it.
  reference text check (reference is null or length(btrim(reference)) <= 80),
  notes text check (notes is null or length(btrim(notes)) <= 2000),

  created_by uuid not null references home.profiles(id),
  created_at timestamptz not null default now()
);

create index on home.project_payments (quote_id);

alter table home.project_payments enable row level security;

create policy "members read their payments"
  on home.project_payments for select using (
    exists (
      select 1 from home.project_quotes q
      where q.id = home.project_payments.quote_id
    )
  );

grant select on home.project_payments to authenticated;

-- ------------------------------------------------- receipts become payments
--
-- A receipt said two things at once: a bill existed, and it was settled. Both
-- survive, as the two rows they always were.
do $$
declare
  r record;
begin
  for r in select * from home.project_quotes where kind = 'receipt' loop
    insert into home.project_payments (quote_id, amount, amount_incl_gst, paid_on, reference, created_by)
    values (r.id, coalesce(r.amount, 0), r.amount_incl_gst, r.dated, 'Paid in full', r.created_by);

    update home.project_quotes set kind = 'invoice', updated_at = now() where id = r.id;
  end loop;
end;
$$;

notify pgrst, 'reload schema';
