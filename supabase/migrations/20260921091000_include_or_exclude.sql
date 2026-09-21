-- Include or exclude, on each item of the job.
--
-- Pricing a renovation is provisional right up until it isn't: the vanity
-- gets swapped for a cheaper one, an item turns out to be supplied by the
-- builder already and shouldn't be priced twice, or a line was added to
-- price something out and was never meant to be bought. Until now the only
-- way to stop an item counting was to delete it, which throws away its
-- quotes and its history along with the decision not to buy it.
--
-- `excluded` is the other option: the item and everything quoted against it
-- stays on the record, but stops counting. Its own price still reads on its
-- own row — `project_items_with_totals` and `project_scope_money` at the
-- item level are untouched, deliberately, so tapping into an excluded item
-- still shows what it would have cost. What changes is everything it rolls
-- into: an excluded item's committed/invoiced/paid drop out of its
-- element's total, and its quotes drop out of who's-owed and the bills due,
-- so "the supplier rows sum to committed" stays true rather than counting
-- money for work that was decided against.

alter table home.project_items add column excluded boolean not null default false;

create function home.set_item_excluded(p_item_id uuid, p_excluded boolean)
returns home.project_items
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item home.project_items;
begin
  perform home.require_project_member(home.item_project(p_item_id));

  update home.project_items set
    excluded   = coalesce(p_excluded, false),
    updated_at = now()
  where id = p_item_id
  returning * into v_item;

  if v_item.id is null then
    raise exception 'No such item';
  end if;

  return v_item;
end;
$$;

grant execute on function home.set_item_excluded(uuid, boolean) to authenticated;

-- ------------------------------------------------------- the view stack

drop view if exists home.projects_with_totals;
drop view if exists home.project_elements_with_totals;
drop view if exists home.project_items_with_totals;
drop view if exists home.project_supplier_totals;
drop view if exists home.project_bills;
drop view if exists home.project_scope_money;
drop view if exists home.project_quotes_with_totals;

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
  lt.allowance_open,
  lt.additional_open,
  case
    when q.basis = 'fixed' or lt.build_up is null
      then home.incl_gst(q.amount, q.amount_incl_gst)
    else lt.build_up
  end
  - coalesce(lt.allowance_left, 0)
  + coalesce(lt.allowance_absorbed, 0)
  + coalesce(lt.attendance_total, 0)
  + coalesce(lt.additional_in, 0)                             as effective_amount,
  pay.paid_total,
  case when q.kind = 'invoice' and q.status <> 'declined'
       then greatest(
              coalesce(home.incl_gst(q.amount, q.amount_incl_gst), 0)
                - coalesce(pay.paid_total, 0), 0)
  end                                                         as unpaid,
  home.quote_reach(q.id)                                      as reach_project_id,
  -- Whether the item this price belongs to has been excluded from the price
  -- build. False for anything not attached to an item.
  coalesce(pi.excluded, false)                                as item_excluded
from home.project_quotes q
left join home.project_items pi on pi.id = q.item_id
cross join lateral (
  select
    count(*)                                                   as line_count,
    sum(home.incl_gst(l.amount, l.amount_incl_gst))             as lines_total,
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
    -- Bought direct: the allowance leaves the contract sum. What leaves has to
    -- be exactly what was added, or the subtraction moves the total by the
    -- variance — a fixed price stated the *allowed* figure, an estimate's
    -- build-up carried the *actual*.
    coalesce(sum(
      case when l.is_allowance and not l.additional
                and sup.amt is not null and sup.direct
           then coalesce(sup.allowed_in_build_up,
                         home.incl_gst(l.amount, l.amount_incl_gst)) end
    ), 0)                                                      as allowance_left,
    -- Supplied by the contract holder, and priced: the contract sum adjusts to
    -- the real number. That is what a PC sum is *for*, and without this term a
    -- fixed price went on carrying what it allowed while the actual landed
    -- nowhere. An estimate needs no term — its build-up already carries it.
    coalesce(sum(
      case when l.is_allowance and not l.additional
                and sup.amt is not null and not sup.direct and q.basis = 'fixed'
           then sup.amt - home.incl_gst(l.amount, l.amount_incl_gst) end
    ), 0)                                                      as allowance_absorbed,
    coalesce(sum(
      case when l.is_allowance and sup.amt is not null and sup.direct
                and l.attendance_pct is not null
           then round(sup.amt * l.attendance_pct / 100, 2) end
    ), 0)                                                      as attendance_total,
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
    where q.kind = 'quote' and q.status = 'accepted'
      and (q.supersedes_line_id is null or q.billed_through_id is null)
  )                                                          as accepted_total,
  sum(q.effective_amount) filter (
    where q.kind = 'invoice' and q.status <> 'declined'
      and q.billed_through_id is null
  )                                                          as invoiced_total,
  sum(q.paid_total) filter (
    where q.kind = 'invoice' and q.billed_through_id is null
  )                                                          as paid_total,
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
where q.kind = 'invoice' and q.status <> 'declined'
  -- A bill passed through a contract is not a bill the household pays.
  and q.billed_through_id is null
  -- Nor is a bill against an item the household has decided against.
  and not q.item_excluded;

grant select on home.project_bills to authenticated;

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
    -- A direct buy answering an allowance is money owed to *this* supplier, so
    -- it is not a superseding row as far as "who is owed what" is concerned.
    -- Reported as its own commitment, which is the whole point of asking who is
    -- billing whom.
    case when q.billed_through_id is null then null else q.supersedes_line_id end
                                              as supersedes_line_id,
    q.effective_amount,
    q.paid_total,
    q.unpaid,
    q.due_on
  from home.project_quotes_with_totals q
  -- An excluded item's price does not count as owed to anybody.
  where q.billed_through_id is null and not q.item_excluded
) s
group by reach, supplier_key;

grant select on home.project_supplier_totals to authenticated;

create view home.project_items_with_totals
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
  coalesce(m.additional_open, 0) as additional_open
from home.project_items i
left join home.project_scope_money m
  on m.level = 'item' and m.owner_id = i.id;

grant select on home.project_items_with_totals to authenticated;

create view home.project_elements_with_totals
with (security_invoker = true)
as
select
  e.id, e.project_id, e.name, e.room, e.implicit, e.sort_order, e.notes,
  e.budget, e.budget_incl_gst, e.photo_paths, e.document_paths,
  e.created_by, e.created_at, e.updated_at,
  t.item_count, t.priced_count, t.quoted_count,
  -- What the prices say.
  home.nsum(t.items_committed, m.accepted_total_or_invoiced) as committed_derived,
  home.nsum(t.items_invoiced,  m.invoiced_total)             as invoiced_derived,
  home.nsum(t.items_paid,      m.paid_total)                 as paid_derived,
  -- What somebody typed.
  ov.committed_override,
  ov.invoiced_override,
  ov.paid_override,
  ov.committed_note,
  ov.invoiced_note,
  ov.paid_note,
  -- What the page shows.
  coalesce(ov.committed_override,
           home.nsum(t.items_committed, m.accepted_total_or_invoiced)) as committed_total,
  coalesce(ov.invoiced_override,
           home.nsum(t.items_invoiced, m.invoiced_total))              as invoiced_total,
  coalesce(ov.paid_override,
           home.nsum(t.items_paid, m.paid_total))                      as paid_total,
  coalesce(t.items_allowance, 0) + coalesce(m.allowance_open, 0)  as allowance_open,
  coalesce(t.items_additional, 0) + coalesce(m.additional_open, 0) as additional_open,
  coalesce(x.expected_open, 0)                               as expected_open,
  coalesce(x.expected_count, 0)                              as expected_count,
  case
    when e.budget is not null and t.item_count > t.priced_count
      then greatest(
             coalesce(home.incl_gst(e.budget, e.budget_incl_gst), 0)
               - coalesce(coalesce(ov.committed_override,
                   home.nsum(t.items_committed, m.accepted_total_or_invoiced)), 0),
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
  -- An excluded item stays on the record and keeps its own price, but stops
  -- counting towards the part it belongs to.
  where i.element_id = e.id and not i.excluded
) t
left join lateral (
  select
    coalesce(sm.accepted_total, sm.invoiced_total) as accepted_total_or_invoiced,
    sm.invoiced_total, sm.paid_total, sm.allowance_open, sm.additional_open
  from home.project_scope_money sm
  where sm.level = 'element' and sm.owner_id = e.id
) m on true
cross join lateral (
  select
    sum(home.incl_gst(o.amount, o.amount_incl_gst))
      filter (where o.field = 'committed') as committed_override,
    sum(home.incl_gst(o.amount, o.amount_incl_gst))
      filter (where o.field = 'invoiced')  as invoiced_override,
    sum(home.incl_gst(o.amount, o.amount_incl_gst))
      filter (where o.field = 'paid')      as paid_override,
    max(o.note) filter (where o.field = 'committed') as committed_note,
    max(o.note) filter (where o.field = 'invoiced')  as invoiced_note,
    max(o.note) filter (where o.field = 'paid')      as paid_note
  from home.project_overrides o
  where o.element_id = e.id
) ov
cross join lateral (
  select
    sum(home.incl_gst(x.amount, x.amount_incl_gst)) as expected_open,
    count(*)                                        as expected_count
  from home.project_expected_costs x
  where x.element_id = e.id and x.settled_by is null
) x;

grant select on home.project_elements_with_totals to authenticated;

create view home.projects_with_totals
with (security_invoker = true)
as
select
  p.id, p.household_id, p.property_id, p.name, p.summary, p.status,
  p.started_on, p.target_on, p.finished_on, p.budget, p.budget_incl_gst,
  p.photo_paths, p.document_paths, p.created_by, p.created_at, p.updated_at, p.updated_by,
  pr.name                as property_name,
  creator.display_name   as created_by_name,
  t.element_count, t.shown_element_count, t.item_count, t.priced_count, t.quoted_count,
  -- Derived: the parts' *shown* totals plus this level's own prices. A part's
  -- override rolls up, or the figure contradicts the rows beneath it.
  d.committed_derived,
  d.invoiced_derived,
  d.paid_derived,
  ov.committed_override,
  ov.invoiced_override,
  ov.paid_override,
  ov.forecast_override,
  ov.committed_note,
  ov.invoiced_note,
  ov.paid_note,
  ov.forecast_note,
  coalesce(ov.committed_override, d.committed_derived) as committed_total,
  coalesce(ov.invoiced_override,  d.invoiced_derived)  as invoiced_total,
  coalesce(ov.paid_override,      d.paid_derived)      as paid_total,
  coalesce(t.parts_allowance, 0) + coalesce(m.allowance_open, 0)   as allowance_open,
  coalesce(t.parts_additional, 0) + coalesce(m.additional_open, 0) as additional_open,
  coalesce(t.parts_expected, 0) + coalesce(x.expected_open, 0)     as expected_open,
  coalesce(t.parts_expected_count, 0) + coalesce(x.expected_count, 0) as expected_count,
  coalesce(t.parts_budget_gap, 0)                            as budget_gap,
  -- Forecast builds on the *shown* committed, so overriding committed moves the
  -- forecast with it rather than leaving the two disagreeing on one screen.
  home.nsum(
    coalesce(ov.committed_override, d.committed_derived),
    coalesce(t.parts_additional, 0) + coalesce(m.additional_open, 0)
      + coalesce(t.parts_expected, 0) + coalesce(x.expected_open, 0)
      + coalesce(t.parts_budget_gap, 0)
  )                                                          as forecast_derived,
  coalesce(
    ov.forecast_override,
    home.nsum(
      coalesce(ov.committed_override, d.committed_derived),
      coalesce(t.parts_additional, 0) + coalesce(m.additional_open, 0)
        + coalesce(t.parts_expected, 0) + coalesce(x.expected_open, 0)
        + coalesce(t.parts_budget_gap, 0)
    )
  )                                                          as forecast_total,
  coalesce(t.parts_allowance, 0) + coalesce(m.allowance_open, 0)
    + coalesce(t.parts_additional, 0) + coalesce(m.additional_open, 0)
    + coalesce(t.parts_expected, 0) + coalesce(x.expected_open, 0)
    + coalesce(t.parts_budget_gap, 0)                        as forecast_guess,
  t.parts_budget_total, t.parts_budgeted_count, f.file_count,
  -- How many parts carry an edited figure, so the job can say so without the
  -- reader having to open each one.
  t.parts_edited_count,
  -- Both gaps read the shown figures, for the same reason.
  home.nsum(
    coalesce(ov.committed_override, d.committed_derived),
    - coalesce(ov.invoiced_override, d.invoiced_derived)
  )                                                          as still_to_bill,
  -- `due_to_pay` follows an override the moment one exists, and otherwise stays
  -- the per-bill sum — which carries the dates, and which no total can.
  case
    when ov.invoiced_override is not null or ov.paid_override is not null
      then greatest(
             coalesce(coalesce(ov.invoiced_override, d.invoiced_derived), 0)
               - coalesce(coalesce(ov.paid_override, d.paid_derived), 0), 0)
    else coalesce(b.due_to_pay, 0)
  end                                                        as due_to_pay,
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
    where e.project_id = p.id and i.status = 'installed')                 as installed_count
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
    count(*) filter (where e.budget is not null)    as parts_budgeted_count,
    count(*) filter (
      where e.committed_override is not null
         or e.invoiced_override is not null
         or e.paid_override is not null
    )                                               as parts_edited_count
  from home.project_elements_with_totals e
  where e.project_id = p.id
) t
left join lateral (
  select
    coalesce(sm.accepted_total, sm.invoiced_total) as accepted_total_or_invoiced,
    sm.invoiced_total, sm.paid_total, sm.allowance_open, sm.additional_open
  from home.project_scope_money sm
  where sm.level = 'project' and sm.owner_id = p.id
) m on true
cross join lateral (
  select
    home.nsum(t.parts_committed, m.accepted_total_or_invoiced) as committed_derived,
    home.nsum(t.parts_invoiced,  m.invoiced_total)             as invoiced_derived,
    home.nsum(t.parts_paid,      m.paid_total)                 as paid_derived
) d
cross join lateral (
  select
    sum(home.incl_gst(o.amount, o.amount_incl_gst))
      filter (where o.field = 'committed') as committed_override,
    sum(home.incl_gst(o.amount, o.amount_incl_gst))
      filter (where o.field = 'invoiced')  as invoiced_override,
    sum(home.incl_gst(o.amount, o.amount_incl_gst))
      filter (where o.field = 'paid')      as paid_override,
    sum(home.incl_gst(o.amount, o.amount_incl_gst))
      filter (where o.field = 'forecast')  as forecast_override,
    max(o.note) filter (where o.field = 'committed') as committed_note,
    max(o.note) filter (where o.field = 'invoiced')  as invoiced_note,
    max(o.note) filter (where o.field = 'paid')      as paid_note,
    max(o.note) filter (where o.field = 'forecast')  as forecast_note
  from home.project_overrides o
  where o.project_id = p.id and o.element_id is null
) ov
cross join lateral (
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
  select count(*) as file_count from home.project_files pf where pf.project_id = p.id
) f;

grant select on home.projects_with_totals to authenticated;

notify pgrst, 'reload schema';
