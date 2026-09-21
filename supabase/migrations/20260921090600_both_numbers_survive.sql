-- Both numbers survive, and the page shows which one it is showing.
--
-- The element and project rollups now carry three columns where they carried
-- one:
--
--   `*_derived`   what the prices add up to. Computed exactly as before.
--   `*_override`  what somebody typed over it, or null.
--   `*_total`     coalesce(override, derived) — what the page shows.
--
-- Nothing about the derivation changed. That is the point: an override sits
-- **beside** the truth rather than replacing it, so the discrepancy is a fact
-- the schema holds and can go on stating for as long as the edit lasts.
--
-- Two rules are enforced here rather than left to the client:
--
--   1. **The page cannot contradict itself.** `still_to_bill`, `due_to_pay` and
--      `forecast_derived` are all computed from the **shown** figures. Override
--      Committed and let the gap read off the derived figure and two numbers one
--      line apart stop adding up — which is exactly the incoherence an override
--      is supposed to be honest about rather than cause.
--   2. **A part's override rolls up.** `parts_committed` sums each element's
--      *shown* total, so a project figure never contradicts the sum of the parts
--      listed directly underneath it. A project-level override then sits on top
--      of that, and the page says so.

drop view if exists home.projects_with_totals;
drop view if exists home.project_elements_with_totals;

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
  where i.element_id = e.id
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
