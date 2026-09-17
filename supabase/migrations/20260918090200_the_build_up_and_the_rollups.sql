-- The build-up, the budgets, and every figure a screen shows.
--
-- Nothing here is stored. See `20260918090000` for the four rules these views
-- exist to make structural.

-- ---------------------------------------------------------------- budgets
--
-- A budget per part, rolling up — "Downstairs bathroom $60k, Laundry $25k" — so
-- variance is answerable per room rather than only across the whole job.
--
-- `projects.budget` stays and stays typed. The parts' budgets are reported
-- beside it and the gap is named in words; neither overwrites the other. A
-- renovation is budgeted top-down and broken down later, the breakdown rarely
-- adds up to the total on purpose (the contingency lives nowhere), and a derived
-- figure that silently replaced the typed one would be the app insisting somebody
-- did not mean what they typed.

alter table home.project_elements
  add column budget numeric(12, 2) check (budget is null or budget between 0 and 99999999),
  add column budget_incl_gst boolean not null default true;

-- ---------------------------------------------------------------- the rollups
--
-- Recreated rather than replaced: `create or replace view` can only append
-- columns, and `range_low`, `range_high`, `chosen_total` and `spent_total` are
-- going. They were dropped in `20260918090000`, which had to happen before
-- `chosen` could go. Dropping a view takes its grants with it, so each is
-- re-issued below.

-- Null only when nobody has said anything at all. `coalesce(a,0) + coalesce(b,0)`
-- would turn "nothing quoted anywhere" into $0, which is the one lie this whole
-- feature is built to avoid.
create function home.nsum(a numeric, b numeric)
returns numeric
language sql
immutable
as $$
  select case when a is null and b is null then null
              else coalesce(a, 0) + coalesce(b, 0) end;
$$;

grant execute on function home.nsum(numeric, numeric) to authenticated;

-- Which project a quote is under, for a caller that is subject to RLS.
--
-- Deliberately NOT `home.quote_project`, which is SECURITY DEFINER and stays
-- revoked: `project_files` is `security_invoker`, so its expressions run as the
-- calling role, and a revoked EXECUTE there raises
-- `42501 permission denied for function quote_project` on every read rather than
-- returning fewer rows. That is precisely what `20260911093000` exists to
-- remember, and it cost a whole migration the first time.
create function home.quote_reach(p_quote_id uuid)
returns uuid
language sql
stable
as $$
  select coalesce(q.project_id, e.project_id, ie.project_id)
  from home.project_quotes q
  left join home.project_elements e  on e.id = q.element_id
  left join home.project_items i     on i.id = q.item_id
  left join home.project_elements ie on ie.id = i.element_id
  where q.id = p_quote_id;
$$;

grant execute on function home.quote_reach(uuid) to authenticated;

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
  -- The accepted quote, or — when nothing was ever quoted here — the invoices
  -- themselves. A consultant billing by the month has no quote and never will,
  -- and "not priced" over four paid invoices is the rollup calling a fact a gap.
  coalesce(m.accepted_total, m.invoiced_total) as committed,
  m.invoiced_total              as invoiced,
  m.paid_total                  as paid,
  coalesce(m.allowance_open, 0) as allowance_open
from home.project_items i
left join home.project_scope_money m
  on m.level = 'item' and m.owner_id = i.id;

grant select on home.project_items_with_totals to authenticated;

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
  -- Quoted and still undecided. A different state from "nobody has asked", and
  -- only one of them is somebody's next move.
  t.quoted_count,
  home.nsum(t.items_committed, m.accepted_total_or_invoiced) as committed_total,
  home.nsum(t.items_invoiced,  m.invoiced_total)             as invoiced_total,
  home.nsum(t.items_paid,      m.paid_total)                 as paid_total,
  coalesce(t.items_allowance, 0) + coalesce(m.allowance_open, 0) as allowance_open
from home.project_elements e
cross join lateral (
  select
    count(*)                                            as item_count,
    count(*) filter (where i.committed is not null)     as priced_count,
    count(*) filter (where i.committed is null and i.quote_count > 0) as quoted_count,
    sum(i.committed)                                    as items_committed,
    sum(i.invoiced)                                     as items_invoiced,
    sum(i.paid)                                         as items_paid,
    sum(i.allowance_open)                               as items_allowance
  from home.project_items_with_totals i
  where i.element_id = e.id
) t
left join lateral (
  select
    coalesce(sm.accepted_total, sm.invoiced_total) as accepted_total_or_invoiced,
    sm.invoiced_total,
    sm.paid_total,
    sm.allowance_open
  from home.project_scope_money sm
  where sm.level = 'element' and sm.owner_id = e.id
) m on true;

grant select on home.project_elements_with_totals to authenticated;

-- ---------------------------------------------------------------- paperwork
--
-- Files roll up, never down — unchanged. What changed is that a quote no longer
-- reaches its project through an item, so the two quote branches walk the same
-- three legs everything else now does.

create view home.project_files
with (security_invoker = true)
as
select p.id as project_id, 'project'::text as level, p.id as owner_id,
       p.name as owner_name, 'photo'::text as kind, path
from home.projects p, unnest(p.photo_paths) as path
union all
select p.id, 'project', p.id, p.name, 'document', path
from home.projects p, unnest(p.document_paths) as path
union all
select e.project_id, 'element', e.id, e.name, 'photo', path
from home.project_elements e, unnest(e.photo_paths) as path
union all
select e.project_id, 'element', e.id, e.name, 'document', path
from home.project_elements e, unnest(e.document_paths) as path
union all
select e.project_id, 'item', i.id, i.name, 'photo', path
from home.project_items i
join home.project_elements e on e.id = i.element_id,
     unnest(i.photo_paths) as path
union all
select e.project_id, 'item', i.id, i.name, 'document', path
from home.project_items i
join home.project_elements e on e.id = i.element_id,
     unnest(i.document_paths) as path
union all
select home.quote_reach(q.id), 'quote', q.id,
       coalesce(q.supplier, 'A price'), 'photo', path
from home.project_quotes q, unnest(q.photo_paths) as path
union all
select home.quote_reach(q.id), 'quote', q.id,
       coalesce(q.supplier, 'A price'), 'document', path
from home.project_quotes q, unnest(q.document_paths) as path;

grant select on home.project_files to authenticated;

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
  coalesce(t.parts_allowance, 0) + coalesce(m.allowance_open, 0) as allowance_open,
  -- What the parts have been budgeted, against what the project was. Both are
  -- kept and the difference is named on screen rather than resolved: a derived
  -- budget that overwrites a number somebody typed is the app telling them they
  -- did not mean it, and a breakdown is normally drawn up after the total and
  -- deliberately does not add up to it.
  t.parts_budget_total,
  t.parts_budgeted_count,
  f.file_count,
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
    sm.allowance_open
  from home.project_scope_money sm
  where sm.level = 'project' and sm.owner_id = p.id
) m on true
cross join lateral (
  select count(*) as file_count
  from home.project_files pf
  where pf.project_id = p.id
) f;

grant select on home.projects_with_totals to authenticated;

notify pgrst, 'reload schema';
