-- Quoted, who each figure is made of, and the fallback that went missing.
--
-- ---------------------------------------------------------------- the line
--
-- *Quoted* was taken out once and that was right at the time: it was a
-- low-to-high **band** across undecided prices, answering a question nobody
-- asks after the first fortnight. What comes back here is not that band. It is
-- a single figure — **what the suppliers have actually said** — sitting
-- directly above Committed, which is what has been agreed out of it.
--
-- The pair is the point. Committed on its own cannot tell a job where nobody
-- has priced anything from a job where three contractors have quoted and
-- nobody has signed: both read as nothing agreed. Quoted above it says which,
-- and the gap between the two is what is still to decide.
--
-- It counts every price of kind `quote` that has not been declined — accepted
-- ones included, because an accepted quote was still quoted. A declined price
-- counts for nothing here exactly as it counts for nothing in every other
-- total; it stays on the record and stays dimmed.
--
-- ---------------------------------------------------------------- the subrows
--
-- Every money line on the project page now opens to show who it is made of,
-- and that is only honest if the parts add up to the whole. So the rows come
-- from this view and the project's Quoted figure is their **sum** —
-- `projectQuoted` in the query package, and the only thing that writes it.
-- One expression, so the line and the rows under it cannot disagree; the
-- alternative is a second expression in `projects_with_totals` that would then
-- have to be kept in step with this one, which is the drift the whole money
-- model is built against.
--
-- ------------------------------------------------- and the one that was lost
--
-- Opening the figures is what found it. On the live job the rows added to
-- **$7,773.47** under a Committed line reading **$103,574.22** — so the
-- invariant this file has claimed since `20260918090500` ("the supplier rows
-- sum to the project's committed total") has been false for three days, with
-- nothing on screen able to show it.
--
-- `20260918090500` is the migration that fixed it the first time: the fallback
-- from an accepted quote to invoices belongs to the **scope**, never to the
-- supplier. Ask it per supplier and a consultant who has only ever invoiced
-- comes out owed nothing while their bills sit in `invoiced`. That is exactly
-- what MSC Consulting Group and Gibson Architects were doing — $6,986.25
-- between them, invoiced, committed nowhere.
--
-- `20260921090400` rewrote this view for the direct-buy rule and restated it
-- as a flat `filter (where kind = 'quote' and status = 'accepted')`, which
-- dropped the scope fallback on the way past. It is restored here on top of
-- 090400's direct-buy handling and 093000's stored `reach_project_id`, and
-- measured rather than asserted: committed, invoiced and paid each now sum to
-- the project's own figure to the cent.
--
-- ---------------------------------------------------------------- mechanics
--
-- `create or replace` can only **append** a column, so `quoted` goes after
-- `tbc_count` and every existing column keeps its place and its type. It
-- restates `with (security_invoker = true)`: a replace with no clause
-- **resets** the option rather than keeping it, which is what `20260917090000`
-- and `20260920100000` did to `snags_with_details` and handed every row in the
-- table to anybody holding a token. A replace keeps the grants, so nothing is
-- re-issued, and `home.project_page` returns `to_jsonb(s)`, so the new column
-- reaches the client with nothing else changed server-side.

create or replace view home.project_supplier_totals
with (security_invoker = true)
as
with scoped as (
  select
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
    q.due_on
  from home.project_quotes_with_totals q
  -- A bill passed through a contract is not money the household owes its
  -- sender, and an excluded item's price is not owed to anybody.
  where q.billed_through_id is null and not q.item_excluded
),
-- Which scopes have somebody's accepted price on them. The fallback belongs to
-- the **scope**, never to the supplier.
settled as (
  select distinct scope_id
  from scoped
  where kind = 'quote' and status = 'accepted' and supersedes_line_id is null
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
      -- Nothing was ever quoted at this scope, so the invoices are the
      -- commitment. A consultant billing time by the month has no quote and
      -- never will.
      when s.kind = 'invoice' and s.status <> 'declined'
           and not exists (select 1 from settled t where t.scope_id = s.scope_id)
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
)
select
  project_id,
  supplier_key,
  -- Displayed with the spelling used most recently. Grouping is on the
  -- trimmed, lower-cased name, and `home.rename_supplier` is how a typo gets
  -- corrected across a job rather than quote by quote.
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

notify pgrst, 'reload schema';
