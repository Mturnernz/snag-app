-- A bill is part of a contract when it says so, never because of who sent it.
--
-- `20260923090000` gave the rollups a guess: at a scope where a supplier has a
-- signed price, every bill from that supplier there is a draw on it. On the
-- live data the guess was wrong in the expensive direction. "Main Roof, Deck and
-- Guest Room" holds the builder's accepted deck quote (QU-0111, $49,482.20) and
-- seven of the same builder's invoices on the whole job — the deck claims, but
-- also the roof's two 50% payments against a different quote (0104) and a
-- variation. All seven were read as draws on the deck quote, so the page said
-- Committed $49,482.20 against Invoiced $111,464.44: still to bill
-- −$61,982.24, and $62,000 of headroom that does not exist.
--
-- The link the guess stood in for has existed since `20260922090000`
-- (`against_quote_id`), and nothing outside the record-money sheet could set
-- it: not one of the 29 prices on the live project held one. So:
--
--   * **A bill counts on its own unless it claims against a signed quote.**
--     The supplier pair is gone from both rollups. A bill claiming against a
--     quote nobody has agreed still counts, because the quote does not.
--   * **`home.set_quote_claim` links a bill that already exists**, with the
--     refusals `create_quote` makes, so the emailed bills and the bills from
--     before a contract was agreed can be put where they belong.
--
-- The failure moves to the safe side: an unlinked claim now counts beside its
-- contract — too much, never too little — and the page offers the link when a
-- bill's own words name the quote or a percentage of it.
--
-- Column lists are unchanged, so both views are replaced in place.

-- ---------------------------------------------------------- scope money

create or replace view home.project_scope_money
with (security_invoker = true)
as
with q as (
  select
    q.*,
    case
      when q.item_id is not null then 'item'
      when q.element_id is not null then 'element'
      else 'project'
    end                                              as lvl,
    coalesce(q.item_id, q.element_id, q.project_id)  as scope_id,
    q.kind = 'quote' and q.status = 'accepted'
      and (q.supersedes_line_id is null or q.billed_through_id is null)
                                                     as signed
  from home.project_quotes_with_totals q
),
flagged as (
  select
    q.*,
    -- A claim on a signed contract is the contract's money, counted once there.
    exists (
      select 1 from q c where c.id = q.against_quote_id and c.signed
    )                                                as draws_on_signed
  from q
)
select
  lvl                                                        as level,
  scope_id                                                   as owner_id,
  case when bool_or(signed) then
    coalesce(sum(effective_amount) filter (where signed), 0)
    + coalesce(sum(effective_amount) filter (
        where kind = 'invoice' and status <> 'declined'
          and billed_through_id is null and not draws_on_signed
      ), 0)
  end                                                        as accepted_total,
  sum(effective_amount) filter (
    where kind = 'invoice' and status <> 'declined'
      and billed_through_id is null
  )                                                          as invoiced_total,
  sum(paid_total) filter (
    where kind = 'invoice' and billed_through_id is null
  )                                                          as paid_total,
  sum(allowance_open) filter (
    where kind = 'quote' and status = 'accepted' and supersedes_line_id is null
  )                                                          as allowance_open,
  sum(additional_open) filter (
    where kind = 'quote' and status = 'accepted' and supersedes_line_id is null
  )                                                          as additional_open,
  count(*) filter (where kind = 'quote' and status = 'tbc')      as tbc_count,
  count(*) filter (where kind = 'quote' and status = 'accepted') as accepted_count,
  count(*)                                                   as quote_count
from flagged
group by lvl, scope_id;

-- --------------------------------------------------------- who is owed

create or replace view home.project_supplier_totals
with (security_invoker = true)
as
with scoped as (
  select
    q.id,
    q.reach_project_id                              as project_id,
    coalesce(q.item_id, q.element_id, q.project_id) as scope_id,
    q.supplier,
    q.created_at,
    q.kind,
    q.status,
    -- A direct buy answering an allowance is money owed to *this* supplier, so
    -- it is not a superseding row as far as "who is owed what" is concerned.
    case when q.billed_through_id is null then null else q.supersedes_line_id end
                                                    as supersedes_line_id,
    q.effective_amount,
    q.paid_total,
    q.unpaid,
    q.due_on,
    q.against_quote_id
  from home.project_quotes_with_totals q
  -- A bill passed through a contract is not money the household owes its
  -- sender, and an excluded item's price is not owed to anybody.
  where q.billed_through_id is null and not q.item_excluded
),
contribution as (
  select
    s.project_id,
    lower(btrim(coalesce(s.supplier, ''))) as supplier_key,
    s.supplier,
    s.created_at,
    case
      when s.kind = 'quote' and s.status = 'accepted' and s.supersedes_line_id is null
        then s.effective_amount
      -- A bill counts on its own unless it claims against a signed contract,
      -- whose figure already holds it. The same rule as the scope money above,
      -- so these rows still sum to Committed.
      when s.kind = 'invoice' and s.status <> 'declined'
           and not exists (
             select 1 from scoped c
             where c.id = s.against_quote_id
               and c.kind = 'quote' and c.status = 'accepted' and c.supersedes_line_id is null)
        then s.effective_amount
    end                                                       as committed_part,
    case when s.kind = 'invoice' and s.status <> 'declined' then s.effective_amount end
                                                              as invoiced_part,
    case when s.kind = 'invoice' then s.paid_total end        as paid_part,
    -- Everything they have said that has not been declined, accepted prices
    -- included: the line above Committed, broken down by who said it.
    case when s.kind = 'quote' and s.status <> 'declined' then s.effective_amount end
                                                              as quoted_part,
    s.unpaid,
    s.due_on,
    case when s.kind = 'quote' and s.status = 'tbc' then 1 else 0 end as tbc
  from scoped s
  union all
  -- A confirmed expectation. Committed only: nobody quoted it, nobody has
  -- billed for it, and no money has moved — so it is owed, and that is all.
  select
    x.project_id,
    lower(btrim(coalesce(x.likely_supplier, ''))) as supplier_key,
    x.likely_supplier                             as supplier,
    x.created_at,
    home.incl_gst(x.amount, x.amount_incl_gst)    as committed_part,
    null::numeric                                 as invoiced_part,
    null::numeric                                 as paid_part,
    null::numeric                                 as quoted_part,
    null::numeric                                 as unpaid,
    null::date                                    as due_on,
    0                                             as tbc
  from home.project_expected_costs x
  where x.settled_by is null and x.confirmed
)
select
  project_id,
  supplier_key,
  (array_agg(supplier order by created_at desc))[1] as supplier,
  sum(committed_part)                               as committed,
  sum(invoiced_part)                                as invoiced,
  sum(paid_part)                                    as paid,
  sum(unpaid)                                       as unpaid,
  min(due_on) filter (where coalesce(unpaid, 0) > 0) as next_due_on,
  sum(tbc)                                          as tbc_count,
  sum(quoted_part)                                  as quoted
from contribution
group by project_id, supplier_key;

-- ------------------------------------------------------ linking a claim

-- Says that a bill already on the job is a claim against a quote, or that it is
-- not (null). The refusals are `create_quote`'s, said the same way, because a
-- claim made afterwards has to be exactly as true as one made at the start: a
-- bill, against a quote, in this job, sitting where its contract sits. It
-- touches nothing else on the bill — not its status, its payments or its date.
create function home.set_quote_claim(p_quote_id uuid, p_against_quote_id uuid)
returns home.project_quotes
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bill home.project_quotes;
  v_contract home.project_quotes;
  v_project uuid := home.quote_project(p_quote_id);
begin
  perform home.require_project_member(v_project);

  select * into v_bill from home.project_quotes where id = p_quote_id;
  if v_bill.id is null then
    raise exception 'No such bill';
  end if;

  if p_against_quote_id is not null then
    if v_bill.kind <> 'invoice' then
      raise exception 'Only a bill can be a claim against a contract';
    end if;
    if v_bill.billed_through_id is not null then
      raise exception 'It''s inside another bill, which is what counts it';
    end if;

    select * into v_contract from home.project_quotes where id = p_against_quote_id;
    if v_contract.id is null then
      raise exception 'No such contract';
    end if;
    if v_contract.kind <> 'quote' then
      raise exception 'A claim has to be against a quote, not another bill';
    end if;
    if home.quote_project(p_against_quote_id) is distinct from v_project then
      raise exception 'That contract belongs to a different job';
    end if;
    if v_contract.item_id is distinct from v_bill.item_id
       or v_contract.element_id is distinct from v_bill.element_id
       or v_contract.project_id is distinct from v_bill.project_id then
      raise exception 'A claim has to sit where its contract sits — move one of them first';
    end if;
  end if;

  update home.project_quotes set
    against_quote_id = p_against_quote_id,
    updated_at       = now()
  where id = p_quote_id
  returning * into v_bill;

  return v_bill;
end;
$$;
revoke execute on function home.set_quote_claim(uuid, uuid) from public, anon;
grant execute on function home.set_quote_claim(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
