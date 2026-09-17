-- One walk to the project.
--
-- A quote no longer hangs off an item, so every policy and helper that walked
-- `quote -> item -> element -> project` is wrong for two of the three shapes it
-- can now have. Split from `20260918090000` so the reach is established, and can
-- be checked, before anything reads through it.

-- ---------------------------------------------------------------- reach
--
-- A quote no longer hangs off an item, so every policy and helper that walked
-- `quote -> item -> element -> project` is now wrong for two of the three shapes.
-- This is the one walk, written once: outer joins down whichever leg exists, and
-- `coalesce` picks it up.

drop policy if exists "members read their project quotes" on home.project_quotes;

create policy "members read their project quotes"
  on home.project_quotes for select using (
    exists (
      select 1
      from home.project_items i2
      where i2.id = home.project_quotes.item_id
        and exists (
          select 1 from home.project_elements e2
          join home.projects p2 on p2.id = e2.project_id
          where e2.id = i2.element_id and home.is_property_member(p2.property_id)
        )
    )
    or exists (
      select 1 from home.project_elements e3
      join home.projects p3 on p3.id = e3.project_id
      where e3.id = home.project_quotes.element_id
        and home.is_property_member(p3.property_id)
    )
    or exists (
      select 1 from home.projects p4
      where p4.id = home.project_quotes.project_id
        and home.is_property_member(p4.property_id)
    )
  );

drop policy if exists "members read their quote lines" on home.project_quote_lines;

create policy "members read their quote lines"
  on home.project_quote_lines for select using (
    exists (
      select 1 from home.project_quotes q
      where q.id = home.project_quote_lines.quote_id
    )
  );

drop policy if exists "members read their payments" on home.project_payments;

create policy "members read their payments"
  on home.project_payments for select using (
    exists (
      select 1 from home.project_quotes q
      where q.id = home.project_payments.quote_id
    )
  );

-- The child policies lean on the parent's, deliberately: RLS applies to a table
-- wherever it is referenced, policy expressions included, so "a line of a quote
-- you can read" is exactly what that `exists` means. Repeating the three-legged
-- walk in each of them would be three more places to get the property check
-- wrong, which is the failure `20260803120200` is remembered for.

-- `quote_project` walked through the item and returned null for the other two
-- shapes, which would have made every write on a contract raise "No such
-- project".
create or replace function home.quote_project(p_quote_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    q.project_id,
    e.project_id,
    ie.project_id
  )
  from home.project_quotes q
  left join home.project_elements e on e.id = q.element_id
  left join home.project_items i    on i.id = q.item_id
  left join home.project_elements ie on ie.id = i.element_id
  where q.id = p_quote_id;
$$;

revoke execute on function home.quote_project(uuid) from public, anon, authenticated;

create function home.line_project(p_line_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select home.quote_project(l.quote_id)
  from home.project_quote_lines l where l.id = p_line_id;
$$;

revoke execute on function home.line_project(uuid) from public, anon, authenticated;

create function home.payment_project(p_payment_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select home.quote_project(pm.quote_id)
  from home.project_payments pm where pm.id = p_payment_id;
$$;

revoke execute on function home.payment_project(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- the build-up
--
-- One row per quote, carrying what it says and what it now reads. See rules 1–4
-- at the top.

create view home.project_quotes_with_totals
with (security_invoker = true)
as
select
  q.id,
  q.item_id,
  q.element_id,
  q.project_id,
  q.supersedes_line_id,
  q.supplier,
  q.detail,
  q.amount,
  q.amount_incl_gst,
  q.kind,
  q.status,
  q.basis,
  q.dated,
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
  -- How much of the build-up is still somebody's guess. Rule 3.
  lt.allowance_open,
  -- What this quote contributes. A fixed price does not move; an estimate is its
  -- build-up once it has one. Rule 2.
  case
    when q.basis = 'fixed' then home.incl_gst(q.amount, q.amount_incl_gst)
    else coalesce(lt.build_up, home.incl_gst(q.amount, q.amount_incl_gst))
  end as effective_amount,
  pay.paid_total
from home.project_quotes q
cross join lateral (
  select
    count(*)                                                    as line_count,
    sum(home.incl_gst(l.amount, l.amount_incl_gst))              as lines_total,
    -- An allowance answered by accepted quotes contributes what they came to;
    -- everything else contributes what it says.
    sum(coalesce(sup.amt, home.incl_gst(l.amount, l.amount_incl_gst))) as build_up,
    coalesce(sum(
      case when l.is_allowance and sup.amt is null
           then home.incl_gst(l.amount, l.amount_incl_gst) end
    ), 0)                                                        as allowance_open
  from home.project_quote_lines l
  left join lateral (
    select sum(home.incl_gst(s.amount, s.amount_incl_gst)) as amt
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
--
-- Every level's money, computed once. Item, element and project totals all read
-- this rather than each writing the rule out again — three copies of "an invoice
-- is the commitment when nothing was quoted" is three places for it to drift.

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
  -- Rule 1: a quote that supersedes a line counts through that line and never
  -- also here.
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
  count(*) filter (where q.kind = 'quote' and q.status = 'tbc')      as tbc_count,
  count(*) filter (where q.kind = 'quote' and q.status = 'accepted') as accepted_count,
  count(*)                                                   as quote_count
from home.project_quotes_with_totals q
group by 1, 2;

grant select on home.project_scope_money to authenticated;

notify pgrst, 'reload schema';
