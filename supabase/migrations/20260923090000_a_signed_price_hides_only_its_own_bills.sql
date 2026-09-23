-- A signed price hides only its own supplier's bills, and an item can say
-- which set-aside amount it is being chosen against.
--
-- ------------------------------------------------------------- the rollup
--
-- Committed at a scope was `coalesce(accepted, invoiced)`: the moment anybody
-- signed a price at a level, every invoice at that level stopped counting. That
-- was meant to stop a contract and its progress claims both reaching Committed,
-- and it did — but it also dropped every *other* supplier's bills at the same
-- level. Five scenarios replayed through the app put numbers on it: an ensuite
-- read $1,450 committed against $3,929 invoiced (one signed plumber's quote hid
-- the vanity, the tiles and the paint), and a renovation lost its architect,
-- engineer and council invoices entirely because the builder's contract sat on
-- "the whole job" beside them.
--
-- The fallback now belongs to the **pair**: this supplier, at this scope. At a
-- scope where somebody has signed, an invoice counts unless
--
--   * the same supplier has a signed price there (it is a draw against it), or
--   * it says outright that it claims against a quote (`against_quote_id`).
--
-- At a scope nobody has signed, every invoice counts, exactly as before.
--
-- **Not one consumer changes.** `accepted_total` is redefined so that
-- `coalesce(accepted_total, invoiced_total)` — the expression eleven views use —
-- now gives the right answer: it is null where nothing is signed (so the
-- invoices win, as before) and otherwise carries the signed prices *plus* the
-- other suppliers' bills. The column list is unchanged, so both views are
-- replaced in place and nothing above them is rebuilt.
--
-- `project_supplier_totals` applies the same pair rule, because the check that
-- keeps this feature honest is that **the supplier rows sum to Committed**.
--
-- ------------------------------------------------------------- set-aside
--
-- A builder's quote sets money aside for things the household will choose —
-- $8,000 for laundry fittings, $12,000 for bathroom hardware. Those are
-- allowance lines (`project_quote_lines.is_allowance`), and every rule about
-- them has been in the schema since `20260918090400`. What was missing was the
-- link from the *thing being chosen* to the line it is being chosen against, so
-- the app could never ask "is this toilet part of the bathroom hardware?" and
-- the allowance could never be settled from a screen.
--
-- `project_items.set_aside_line_id` is that link. Several items may share one
-- line (a toilet, a vanity and a mixer are all "bathroom hardware"). Choosing an
-- option for such an item writes `supersedes_line_id` on the chosen quote — the
-- existing mechanism — so no rollup expression changes for this either.

-- -------------------------------------------------------------- the column

alter table home.project_items
  add column set_aside_line_id uuid
    references home.project_quote_lines (id) on delete set null;

create index project_items_set_aside_line_id_idx
  on home.project_items (set_aside_line_id);

create function home.set_item_set_aside(p_item_id uuid, p_line_id uuid)
returns home.project_items
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item home.project_items;
  v_project uuid := home.item_project(p_item_id);
  v_line_project uuid;
  v_allowance boolean;
begin
  perform home.require_project_member(v_project);

  if p_line_id is not null then
    select q.reach_project_id, l.is_allowance
      into v_line_project, v_allowance
    from home.project_quote_lines l
    join home.project_quotes q on q.id = l.quote_id
    where l.id = p_line_id;

    if v_line_project is distinct from v_project then
      raise exception 'That amount isn''t set aside in a quote on this job';
    end if;
    if not coalesce(v_allowance, false) then
      raise exception 'That line isn''t a set-aside amount';
    end if;
  end if;

  update home.project_items set
    set_aside_line_id = p_line_id,
    updated_at        = now()
  where id = p_item_id
  returning * into v_item;

  if v_item.id is null then
    raise exception 'No such item';
  end if;

  return v_item;
end;
$$;
revoke execute on function home.set_item_set_aside(uuid, uuid) from public, anon;
grant execute on function home.set_item_set_aside(uuid, uuid) to authenticated;

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
    lower(btrim(coalesce(q.supplier, '')))           as supplier_key,
    q.kind = 'quote' and q.status = 'accepted'
      and (q.supersedes_line_id is null or q.billed_through_id is null)
                                                     as signed
  from home.project_quotes_with_totals q
),
pair as (
  select distinct scope_id, supplier_key from q where signed
),
flagged as (
  select
    q.*,
    (p.scope_id is not null or q.against_quote_id is not null) as draws_on_signed
  from q
  left join pair p on p.scope_id = q.scope_id and p.supplier_key = q.supplier_key
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

-- --------------------------------------------------------- items, appended

create or replace view home.project_items_with_totals
with (security_invoker = true)
as
select
  i.id,
  i.element_id,
  i.name,
  i.status,
  i.excluded,
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
  coalesce(m.additional_open, 0) as additional_open,
  i.set_aside_line_id
from home.project_items i
left join home.project_scope_money m
  on m.level = 'item' and m.owner_id = i.id;

-- --------------------------------------------------------- who is owed

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
    q.due_on,
    q.against_quote_id
  from home.project_quotes_with_totals q
  -- A bill passed through a contract is not money the household owes its
  -- sender, and an excluded item's price is not owed to anybody.
  where q.billed_through_id is null and not q.item_excluded
),
-- Which suppliers have an accepted price at each scope. The fallback belongs to
-- the **pair** — this supplier, at this scope — and that is the fix
-- `20260923090000` makes: a signed contract hides its own supplier's bills,
-- which are draws against it, and never another supplier's.
settled as (
  select distinct scope_id, lower(btrim(coalesce(supplier, ''))) as supplier_key
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
           and not exists (
             select 1 from settled t
             where t.scope_id = s.scope_id
               and t.supplier_key = lower(btrim(coalesce(s.supplier, ''))))
           and (s.against_quote_id is null
                or not exists (select 1 from settled t where t.scope_id = s.scope_id))
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
