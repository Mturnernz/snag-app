-- A project can say what it has not handed over yet.
--
-- `things.project_id` already records what a renovation left behind, and
-- `projects_with_totals.thing_count` already counts it. What neither could say
-- is what it *should* have left behind: an item marked `installed` is something
-- the house now has, and until somebody records it the house record does not
-- know about it.
--
-- That gap is the one thing in this app where two halves of the record can be
-- quietly out of step with each other — the laundry has a new washing machine
-- in it and the House tab has never heard of it, which is exactly the shape of
-- failure the whole House tab exists to prevent. One count makes it answerable.
--
-- **It is a count, never a score.** This feeds the quiet *Worth finishing* list
-- on the You tab, and the rule there is the rule the House tab already keeps: a
-- global completeness meter is the shaming number that gets an app closed and
-- not reopened. `installed_count` is one side of a subtraction against
-- `thing_count`, producing a number of concrete things somebody can do — the
-- same shape as the shopping pill's "2 things to get", never "34% complete".
--
-- `create or replace` rather than drop-and-recreate, because the new column
-- goes on the **end**: replace can only append, and appending is exactly what
-- this is. That keeps the grant, so nothing has to be re-issued — unlike
-- `20260916091000`, which had to move `project_name` in beside the other joined
-- names and therefore paid for a drop.

create or replace view home.projects_with_totals
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
  t.chosen_total,
  t.range_low,
  t.range_high,
  t.spent_total,
  f.file_count,
  (select count(*) from home.snags s where s.project_id = p.id)           as snag_count,
  (select count(*) from home.snags s where s.project_id = p.id and s.status <> 'done')
                                                                          as open_snag_count,
  (select count(*) from home.things th where th.project_id = p.id)        as thing_count,
  -- What the project put in. A scalar subquery rather than another column on
  -- `project_elements_with_totals`: the element layer has no use for it, and
  -- threading it through two views to read it in one is two places to keep in
  -- step for no reader's benefit.
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
    sum(e.chosen_total)                             as chosen_total,
    sum(e.range_low)                                as range_low,
    sum(e.range_high)                               as range_high,
    sum(e.spent_total)                              as spent_total
  from home.project_elements_with_totals e
  where e.project_id = p.id
) t
cross join lateral (
  select count(*) as file_count
  from home.project_files pf
  where pf.project_id = p.id
) f;

notify pgrst, 'reload schema';
