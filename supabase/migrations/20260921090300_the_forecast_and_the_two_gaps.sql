-- The forecast, and the two gaps that are not the same gap.
--
-- Four figures became five, and two subtractions that had been living as one
-- came apart.
--
-- ---------------------------------------------------------------- forecast
--
-- Committed answers *what have we agreed to*. On a job three months in with
-- five items unpriced and two ballparks outstanding, it is not the answer to
-- *are we over*, and it fails in the direction that costs money: everything
-- nobody has priced counts as nought, so the budget always looks comfortable
-- until the week it does not.
--
--   forecast = committed
--            + ballparks outside a contract that nobody has priced
--            + expected costs nobody has quoted
--            + what each part's budget still has to cover its unpriced items
--
-- The last term is the only one that invents anything, and it is fenced hard.
-- It exists **only where a part has a budget and still has unpriced items**, it
-- is the remainder of that budget and never more, it is floored at zero, and a
-- part whose items are all priced contributes nothing — the leftover there is a
-- saving, not a forecast. A project with no part budgets gets no term at all and
-- its forecast is committed plus the named guesses, which is the honest answer
-- when nobody has said what the unpriced work is worth.
--
-- **And the forecast always says how much of itself is a guess.** `forecast_guess`
-- rides beside it exactly as `item_count`/`priced_count` ride beside every sum,
-- and for the same reason: no screen can render the figure without being handed
-- what it is made of. It keeps §3.4's distinction intact — an allowance inside a
-- signed contract is soft but committed; a ballpark outside one is not committed
-- at all; an expected cost is not even quoted. All three are guesses and only
-- one of them is in Committed.
--
-- ---------------------------------------------------------------- the two gaps
--
--   still_to_bill = committed - invoiced   "ReliaBuilder have $88,780 left to claim"
--   due_to_pay    = invoiced  - paid       "$43,987.50, due 20 October"
--
-- The strip carried one figure called Outstanding (committed less paid) which
-- answered neither question. The second is the only figure in this feature that
-- is about **today** rather than about a position, which is why it is the one
-- with a date on it and the one that gets to sit at the top of the page.
--
-- `still_to_bill` is deliberately **signed**. Negative means somebody has billed
-- more than was ever committed, which is the over-billing signal and the last
-- thing that should be floored away into a tidy zero.

drop view if exists home.projects_with_totals;
drop view if exists home.project_elements_with_totals;
drop view if exists home.project_items_with_totals;
drop view if exists home.project_supplier_totals;
drop view if exists home.project_scope_money;
drop view if exists home.project_quotes_with_totals;

-- ---------------------------------------------------------------- the build-up

create view home.project_quotes_with_totals
with (security_invoker = true)
as
select
  q.id,
  q.item_id,
  q.element_id,
  q.project_id,
  q.supersedes_line_id,
  q.billed_through_id,
  q.settles_milestone_id,
  q.supplier,
  q.detail,
  q.amount,
  q.amount_incl_gst,
  q.kind,
  q.status,
  q.basis,
  q.dated,
  q.due_on,
  q.notes,
  q.photo_paths,
  q.document_paths,
  q.created_by,
  q.created_at,
  q.updated_at,
  home.incl_gst(q.amount, q.amount_incl_gst) as amount_incl,
  lt.line_count,
  lt.lines_total,
  lt.build_up,
  -- Still an allowance: inside a signed contract, nobody has priced it. Counted
  -- in committed and named as soft. Never worded "not priced".
  lt.allowance_open,
  -- A ballpark sitting *outside* the contract that nobody has priced. NOT
  -- committed — it is forecast's, and the rollups take it from here.
  lt.additional_open,
  -- What this quote contributes, with all four allowance cases resolved. See
  -- `20260921090200` for the four and why the fourth cannot also count on the
  -- sub's own account.
  case
    when q.basis = 'fixed' or lt.build_up is null
      then home.incl_gst(q.amount, q.amount_incl_gst)
    else lt.build_up
  end
  - coalesce(lt.allowance_left, 0)
  + coalesce(lt.attendance_total, 0)
  + coalesce(lt.additional_in, 0)                             as effective_amount,
  pay.paid_total,
  -- What is still to go out on this bill. Floored: a payment larger than the
  -- bill is somebody settling two things at once, not a negative debt.
  case when q.kind = 'invoice' and q.status <> 'declined'
       then greatest(
              coalesce(home.incl_gst(q.amount, q.amount_incl_gst), 0)
                - coalesce(pay.paid_total, 0), 0)
  end                                                         as unpaid,
  -- Which job this price is under, so "every price on this renovation" is one
  -- round trip rather than three `in` lists — `getProjectContents` reads it.
  -- Added by `20260918090600` and kept here, because a rebuild that drops it
  -- takes the project page's whole money load down with it.
  home.quote_reach(q.id)                                      as reach_project_id
from home.project_quotes q
cross join lateral (
  select
    count(*)                                                   as line_count,
    sum(home.incl_gst(l.amount, l.amount_incl_gst))             as lines_total,
    -- The quote's own number, resolved. Lines inside the total only: an
    -- additional line was never part of what the quote said.
    sum(
      case when l.additional then null
           else coalesce(sup.amt, home.incl_gst(l.amount, l.amount_incl_gst)) end
    )                                                          as build_up,
    coalesce(sum(
      case when l.is_allowance and not l.additional and sup.amt is null
           then home.incl_gst(l.amount, l.amount_incl_gst) end
    ), 0)                                                      as allowance_open,
    coalesce(sum(
      case when l.is_allowance and l.additional and sup.amt is null
           then home.incl_gst(l.amount, l.amount_incl_gst) end
    ), 0)                                                      as additional_open,
    -- Inside, superseded, and the sub bills the household direct: the allowance
    -- comes out of the contract sum. What leaves has to be exactly what was
    -- added, or the subtraction moves the total by the variance: for an estimate
    -- `build_up` carried the *actual*, for a fixed price the stated amount
    -- carried the *allowed*. `allowed_in_build_up` is null for a fixed price so
    -- the coalesce below picks the line's own figure.
    coalesce(sum(
      case when l.is_allowance and not l.additional
                and sup.amt is not null and sup.direct
           then coalesce(sup.allowed_in_build_up,
                         home.incl_gst(l.amount, l.amount_incl_gst)) end
    ), 0)                                                      as allowance_left,
    -- What the head contractor keeps on those. A percentage of the actual, not
    -- of the allowance — their cut moves with the real price, which is the whole
    -- reason they ask for it.
    coalesce(sum(
      case when l.is_allowance and sup.amt is not null and sup.direct
                and l.attendance_pct is not null
           then round(sup.amt * l.attendance_pct / 100, 2) end
    ), 0)                                                      as attendance_total,
    -- Additional lines being bought *through* this contract: outside the quoted
    -- number, so they add to it.
    coalesce(sum(
      case when l.additional and sup.amt is not null and not sup.direct
           then sup.amt end
    ), 0)                                                      as additional_in
  from home.project_quote_lines l
  left join lateral (
    select
      sum(home.incl_gst(s.amount, s.amount_incl_gst)) as amt,
      bool_and(s.billed_through_id is distinct from q.id) as direct,
      case when q.basis = 'fixed' then null
           else sum(home.incl_gst(s.amount, s.amount_incl_gst)) end
                                                      as allowed_in_build_up
    from home.project_quotes s
    where s.supersedes_line_id = l.id and s.status = 'accepted'
  ) sup on true
  where l.quote_id = q.id
) lt
cross join lateral (
  select sum(home.incl_gst(pm.amount, pm.amount_incl_gst)) as paid_total
  from home.project_payments pm where pm.quote_id = q.id
) pay;

grant select on home.project_quotes_with_totals to authenticated;

-- ---------------------------------------------------------------- by scope

create view home.project_scope_money
with (security_invoker = true)
as
select
  case
    when q.item_id is not null then 'item'
    when q.element_id is not null then 'element'
    else 'project'
  end                                                       as level,
  coalesce(q.item_id, q.element_id, q.project_id)            as owner_id,
  sum(q.effective_amount) filter (
    where q.kind = 'quote' and q.status = 'accepted' and q.supersedes_line_id is null
  )                                                          as accepted_total,
  sum(q.effective_amount) filter (
    where q.kind = 'invoice' and q.status <> 'declined'
  )                                                          as invoiced_total,
  sum(q.paid_total) filter (where q.kind = 'invoice')        as paid_total,
  sum(q.allowance_open) filter (
    where q.kind = 'quote' and q.status = 'accepted' and q.supersedes_line_id is null
  )                                                          as allowance_open,
  sum(q.additional_open) filter (
    where q.kind = 'quote' and q.status = 'accepted' and q.supersedes_line_id is null
  )                                                          as additional_open,
  count(*) filter (where q.kind = 'quote' and q.status = 'tbc')      as tbc_count,
  count(*) filter (where q.kind = 'quote' and q.status = 'accepted') as accepted_count,
  count(*)                                                   as quote_count
from home.project_quotes_with_totals q
group by 1, 2;

grant select on home.project_scope_money to authenticated;

-- ---------------------------------------------------------------- the bills
--
-- Every bill on a job, with what is still to go out on it and when. One row per
-- invoice, so the page can list what is due rather than deriving it from a
-- rollup that has already summed the dates away.
--
-- It is a read and nothing else. There is no notification anywhere in this
-- product and there is not going to be one for money either — a due date is a
-- fact on a row that a page can sort by, and the Schedule tab can draw as a
-- mark, exactly as it already draws a project's own dates.

create view home.project_bills
with (security_invoker = true)
as
select
  home.quote_reach(q.id)  as project_id,
  q.id,
  q.supplier,
  q.detail,
  q.dated,
  q.due_on,
  q.billed_through_id,
  q.settles_milestone_id,
  q.amount_incl,
  q.paid_total,
  q.unpaid,
  q.unpaid > 0 and q.due_on is not null and q.due_on < current_date as overdue
from home.project_quotes_with_totals q
where q.kind = 'invoice' and q.status <> 'declined';

grant select on home.project_bills to authenticated;

-- ---------------------------------------------------------------- who is owed
--
-- One change, and the live job needed it: money is owed to **whoever is billing
-- you**. A sub whose price is passed through the head contract is owed nothing
-- by the household — the builder is, and the builder's contract already carries
-- it. Grouping on the sub's own name showed a cabinetmaker owed $12,000 that
-- will never be paid to them directly.

create view home.project_supplier_totals
with (security_invoker = true)
as
select
  reach                                             as project_id,
  supplier_key,
  (array_agg(supplier order by created_at desc))[1] as supplier,
  sum(effective_amount) filter (
    where kind = 'quote' and status = 'accepted' and supersedes_line_id is null
  )                                                 as committed,
  sum(effective_amount) filter (where kind = 'invoice' and status <> 'declined')
                                                    as invoiced,
  sum(paid_total)      filter (where kind = 'invoice') as paid,
  sum(unpaid)                                       as unpaid,
  min(due_on) filter (where coalesce(unpaid, 0) > 0) as next_due_on,
  count(*) filter (where kind = 'quote' and status = 'tbc') as tbc_count
from (
  select
    home.quote_reach(q.id)                    as reach,
    lower(btrim(coalesce(q.supplier, '')))    as supplier_key,
    q.supplier,
    q.created_at,
    q.kind,
    q.status,
    q.supersedes_line_id,
    q.effective_amount,
    q.paid_total,
    q.unpaid,
    q.due_on
  from home.project_quotes_with_totals q
  where q.billed_through_id is null
) s
group by reach, supplier_key;

grant select on home.project_supplier_totals to authenticated;

-- ---------------------------------------------------------------- items

create view home.project_items_with_totals
with (security_invoker = true)
as
select
  i.id,
  i.element_id,
  i.name,
  i.status,
  i.sort_order,
  i.notes,
  i.photo_paths,
  i.document_paths,
  i.created_by,
  i.created_at,
  i.updated_at,
  coalesce(m.quote_count, 0)    as quote_count,
  coalesce(m.tbc_count, 0)      as tbc_count,
  coalesce(m.accepted_total, m.invoiced_total) as committed,
  m.invoiced_total              as invoiced,
  m.paid_total                  as paid,
  coalesce(m.allowance_open, 0) as allowance_open,
  coalesce(m.additional_open, 0) as additional_open
from home.project_items i
left join home.project_scope_money m
  on m.level = 'item' and m.owner_id = i.id;

grant select on home.project_items_with_totals to authenticated;

-- ---------------------------------------------------------------- parts

create view home.project_elements_with_totals
with (security_invoker = true)
as
select
  e.id,
  e.project_id,
  e.name,
  e.room,
  e.implicit,
  e.sort_order,
  e.notes,
  e.budget,
  e.budget_incl_gst,
  e.photo_paths,
  e.document_paths,
  e.created_by,
  e.created_at,
  e.updated_at,
  t.item_count,
  t.priced_count,
  t.quoted_count,
  home.nsum(t.items_committed, m.accepted_total_or_invoiced) as committed_total,
  home.nsum(t.items_invoiced,  m.invoiced_total)             as invoiced_total,
  home.nsum(t.items_paid,      m.paid_total)                 as paid_total,
  coalesce(t.items_allowance, 0) + coalesce(m.allowance_open, 0)  as allowance_open,
  coalesce(t.items_additional, 0) + coalesce(m.additional_open, 0) as additional_open,
  coalesce(x.expected_open, 0)                               as expected_open,
  coalesce(x.expected_count, 0)                              as expected_count,
  -- What this part's budget still has to cover, and the only term in the
  -- forecast that invents anything. Fenced: a budget must exist, there must be
  -- unpriced items for it to be covering, and it is the remainder or nothing.
  -- A part whose items are all priced contributes zero, because the money left
  -- over there is a saving rather than a cost still to come.
  case
    when e.budget is not null and t.item_count > t.priced_count
      then greatest(
             coalesce(home.incl_gst(e.budget, e.budget_incl_gst), 0)
               - coalesce(home.nsum(t.items_committed, m.accepted_total_or_invoiced), 0),
             0)
    else 0
  end                                                        as budget_gap
from home.project_elements e
cross join lateral (
  select
    count(*)                                            as item_count,
    count(*) filter (where i.committed is not null)     as priced_count,
    count(*) filter (where i.committed is null and i.quote_count > 0) as quoted_count,
    sum(i.committed)                                    as items_committed,
    sum(i.invoiced)                                     as items_invoiced,
    sum(i.paid)                                         as items_paid,
    sum(i.allowance_open)                               as items_allowance,
    sum(i.additional_open)                              as items_additional
  from home.project_items_with_totals i
  where i.element_id = e.id
) t
left join lateral (
  select
    coalesce(sm.accepted_total, sm.invoiced_total) as accepted_total_or_invoiced,
    sm.invoiced_total,
    sm.paid_total,
    sm.allowance_open,
    sm.additional_open
  from home.project_scope_money sm
  where sm.level = 'element' and sm.owner_id = e.id
) m on true
cross join lateral (
  select
    sum(home.incl_gst(x.amount, x.amount_incl_gst)) as expected_open,
    count(*)                                        as expected_count
  from home.project_expected_costs x
  where x.element_id = e.id and x.settled_by is null
) x;

grant select on home.project_elements_with_totals to authenticated;

-- ---------------------------------------------------------------- projects

create view home.projects_with_totals
with (security_invoker = true)
as
select
  p.id,
  p.household_id,
  p.property_id,
  p.name,
  p.summary,
  p.status,
  p.started_on,
  p.target_on,
  p.finished_on,
  p.budget,
  p.budget_incl_gst,
  p.photo_paths,
  p.document_paths,
  p.created_by,
  p.created_at,
  p.updated_at,
  p.updated_by,
  pr.name                as property_name,
  creator.display_name   as created_by_name,
  t.element_count,
  t.shown_element_count,
  t.item_count,
  t.priced_count,
  t.quoted_count,
  home.nsum(t.parts_committed, m.accepted_total_or_invoiced) as committed_total,
  home.nsum(t.parts_invoiced,  m.invoiced_total)             as invoiced_total,
  home.nsum(t.parts_paid,      m.paid_total)                 as paid_total,
  coalesce(t.parts_allowance, 0) + coalesce(m.allowance_open, 0)   as allowance_open,
  coalesce(t.parts_additional, 0) + coalesce(m.additional_open, 0) as additional_open,
  -- Expected costs against a part, plus the ones against the job itself.
  coalesce(t.parts_expected, 0) + coalesce(x.expected_open, 0)     as expected_open,
  coalesce(t.parts_expected_count, 0) + coalesce(x.expected_count, 0) as expected_count,
  coalesce(t.parts_budget_gap, 0)                            as budget_gap,
  -- Forecast: committed, plus every guess that is not already inside it.
  home.nsum(
    home.nsum(t.parts_committed, m.accepted_total_or_invoiced),
    coalesce(t.parts_additional, 0) + coalesce(m.additional_open, 0)
      + coalesce(t.parts_expected, 0) + coalesce(x.expected_open, 0)
      + coalesce(t.parts_budget_gap, 0)
  )                                                          as forecast_total,
  -- How much of the forecast is somebody's estimate rather than an agreed
  -- price. `allowance_open` is already inside committed and is soft; the other
  -- three are additions. No screen renders the forecast without this.
  coalesce(t.parts_allowance, 0) + coalesce(m.allowance_open, 0)
    + coalesce(t.parts_additional, 0) + coalesce(m.additional_open, 0)
    + coalesce(t.parts_expected, 0) + coalesce(x.expected_open, 0)
    + coalesce(t.parts_budget_gap, 0)                        as forecast_guess,
  t.parts_budget_total,
  t.parts_budgeted_count,
  f.file_count,
  -- The two gaps. `still_to_bill` stays signed: negative is somebody claiming
  -- more than was ever committed, which is the one thing not to tidy away.
  home.nsum(
    home.nsum(t.parts_committed, m.accepted_total_or_invoiced),
    - home.nsum(t.parts_invoiced, m.invoiced_total)
  )                                                          as still_to_bill,
  coalesce(b.due_to_pay, 0)                                  as due_to_pay,
  coalesce(b.overdue_total, 0)                               as overdue_total,
  b.next_due_on,
  coalesce(b.due_count, 0)                                   as due_count,
  (select count(*) from home.snags s where s.project_id = p.id)           as snag_count,
  (select count(*) from home.snags s where s.project_id = p.id and s.status <> 'done')
                                                                          as open_snag_count,
  (select count(*) from home.things th where th.project_id = p.id)        as thing_count,
  (select count(*)
     from home.project_items i
     join home.project_elements e on e.id = i.element_id
    where e.project_id = p.id
      and i.status = 'installed')                                         as installed_count
from home.projects p
join home.properties pr      on pr.id = p.property_id
join home.profiles creator   on creator.id = p.created_by
cross join lateral (
  select
    count(*)                                        as element_count,
    count(*) filter (where not e.implicit)          as shown_element_count,
    coalesce(sum(e.item_count), 0)                  as item_count,
    coalesce(sum(e.priced_count), 0)                as priced_count,
    coalesce(sum(e.quoted_count), 0)                as quoted_count,
    sum(e.committed_total)                          as parts_committed,
    sum(e.invoiced_total)                           as parts_invoiced,
    sum(e.paid_total)                               as parts_paid,
    sum(e.allowance_open)                           as parts_allowance,
    sum(e.additional_open)                          as parts_additional,
    sum(e.expected_open)                            as parts_expected,
    sum(e.expected_count)                           as parts_expected_count,
    sum(e.budget_gap)                               as parts_budget_gap,
    sum(home.incl_gst(e.budget, e.budget_incl_gst)) as parts_budget_total,
    count(*) filter (where e.budget is not null)    as parts_budgeted_count
  from home.project_elements_with_totals e
  where e.project_id = p.id
) t
left join lateral (
  select
    coalesce(sm.accepted_total, sm.invoiced_total) as accepted_total_or_invoiced,
    sm.invoiced_total,
    sm.paid_total,
    sm.allowance_open,
    sm.additional_open
  from home.project_scope_money sm
  where sm.level = 'project' and sm.owner_id = p.id
) m on true
cross join lateral (
  -- Expected costs against the job rather than a part — council fees, the
  -- engineer the architect warned about.
  select
    sum(home.incl_gst(x.amount, x.amount_incl_gst)) as expected_open,
    count(*)                                        as expected_count
  from home.project_expected_costs x
  where x.project_id = p.id and x.element_id is null and x.settled_by is null
) x
cross join lateral (
  select
    sum(bl.unpaid)                                   as due_to_pay,
    sum(bl.unpaid) filter (where bl.overdue)         as overdue_total,
    count(*) filter (where coalesce(bl.unpaid, 0) > 0) as due_count,
    min(bl.due_on) filter (where coalesce(bl.unpaid, 0) > 0) as next_due_on
  from home.project_bills bl
  where bl.project_id = p.id
) b
cross join lateral (
  select count(*) as file_count
  from home.project_files pf
  where pf.project_id = p.id
) f;

grant select on home.projects_with_totals to authenticated;

notify pgrst, 'reload schema';
