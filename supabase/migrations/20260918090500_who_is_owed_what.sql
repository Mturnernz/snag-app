-- Who is owed what — and the rule that had to be applied one level down.
--
-- `20260918090300` grouped by supplier and then asked "accepted quotes, or
-- failing that the invoices". Against real data that is wrong at both ends:
--
--   * A consultant who has only ever invoiced — no quote, and there never will
--     be one — came out with `committed` null and therefore nothing outstanding,
--     while $4,335.50 of their bills sat in `invoiced`. The rollup said nobody
--     was owed anything.
--   * A builder with an accepted contract *and* a separate pre-start invoice for
--     work outside it came out committed for the contract only. The $839.50 was
--     swallowed, because the supplier had an accepted quote *somewhere* and the
--     fallback is per supplier.
--
-- The fix is that the fallback belongs to the **scope**, exactly as it does in
-- `project_items_with_totals`: for each item, part or project, either an accepted
-- quote says what is committed there, or — when nothing was ever quoted there —
-- its invoices do. The supplier rollup then attributes each scope's committed
-- money to whoever the money is owed to.
--
-- The check worth keeping: **the supplier rows sum to the project's committed
-- total.** They are two views over one rule, and if they ever disagree one of
-- them is lying about who is owed money.

create or replace view home.project_supplier_totals
with (security_invoker = true)
as
with scoped as (
  select
    home.quote_reach(q.id)                          as project_id,
    coalesce(q.item_id, q.element_id, q.project_id) as scope_id,
    q.supplier,
    q.created_at,
    q.kind,
    q.status,
    q.supersedes_line_id,
    q.effective_amount,
    q.paid_total
  from home.project_quotes_with_totals q
),
-- Which scopes have somebody's accepted price on them. Rule 1 still holds: a
-- quote that supersedes a line is counted through the line and is not an
-- accepted price *here*.
settled as (
  select distinct scope_id
  from scoped
  where kind = 'quote' and status = 'accepted' and supersedes_line_id is null
),
contribution as (
  select
    s.project_id,
    s.supplier,
    s.created_at,
    case
      when s.kind = 'quote' and s.status = 'accepted' and s.supersedes_line_id is null
        then s.effective_amount
      when s.kind = 'invoice' and s.status <> 'declined'
           and not exists (select 1 from settled t where t.scope_id = s.scope_id)
        then s.effective_amount
    end as committed_part,
    case when s.kind = 'invoice' and s.status <> 'declined' then s.effective_amount end
      as invoiced_part,
    case when s.kind = 'invoice' then s.paid_total end as paid_part,
    case when s.kind = 'quote' and s.status = 'tbc' then 1 else 0 end as tbc
  from scoped s
)
select
  project_id,
  lower(btrim(coalesce(supplier, '')))              as supplier_key,
  -- Displayed with the spelling used most recently. Grouping is on the trimmed,
  -- lower-cased name, and `home.rename_supplier` is how a typo gets corrected
  -- across a job rather than quote by quote.
  (array_agg(supplier order by created_at desc))[1] as supplier,
  sum(committed_part)                               as committed,
  sum(invoiced_part)                                as invoiced,
  sum(paid_part)                                    as paid,
  sum(tbc)                                          as tbc_count
from contribution
group by project_id, lower(btrim(coalesce(supplier, '')));

grant select on home.project_supplier_totals to authenticated;

notify pgrst, 'reload schema';
