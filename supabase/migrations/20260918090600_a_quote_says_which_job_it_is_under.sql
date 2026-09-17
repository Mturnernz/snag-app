-- A quote says which job it is under.
--
-- A quote now hangs off an item, a part or the project, so "every price on this
-- renovation" was three round trips with three `in` lists — and the item one
-- carries every item id in the URL, which is the shape that quietly stops
-- working at forty items.
--
-- `home.quote_reach` already walks it; this appends the answer as a column so a
-- screen can ask for the project's prices in one go.
--
-- Appended rather than rebuilt: `create or replace view` can only add columns to
-- the end of the list, which is exactly what is wanted here — and it leaves
-- `project_scope_money` and `project_supplier_totals`, both of which read this
-- view, standing rather than needing to be dropped and re-granted.

create or replace view home.project_quotes_with_totals
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
  lt.allowance_open,
  case
    when q.basis = 'fixed' then home.incl_gst(q.amount, q.amount_incl_gst)
    else coalesce(lt.build_up, home.incl_gst(q.amount, q.amount_incl_gst))
  end as effective_amount,
  pay.paid_total,
  home.quote_reach(q.id) as reach_project_id
from home.project_quotes q
cross join lateral (
  select
    count(*)                                                    as line_count,
    sum(home.incl_gst(l.amount, l.amount_incl_gst))              as lines_total,
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

notify pgrst, 'reload schema';
