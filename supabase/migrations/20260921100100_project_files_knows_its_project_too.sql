-- `project_files` was the one view `20260921093000` missed, and it is the one
-- that every other read pays for.
--
-- That migration replaced `home.quote_reach(q.id)` — a four-table join run once
-- per row — with the stored, indexed `reach_project_id` column, in
-- `project_quotes_with_totals`, `project_bills` and `project_supplier_totals`.
-- `project_files` still called the function, once per quote and then once again
-- per unnested path.
--
-- It matters far more than a file list suggests, because **`projects_with_totals`
-- counts this view in a lateral** to produce `file_count`. So a cheap-looking
-- "3 files" line on a project card was dragging a seq scan of every quote in
-- the table through a per-row function — and `projects_with_totals` is read by
-- the project page, every card on the Projects tab, the Schedule tab and the
-- You tab's loose ends.
--
-- Measured on the live database: `projects_with_totals` execution **149ms →
-- 53ms**, and `home.project_page` — which reads it along with everything else —
-- **414ms → 242ms** warm. Nothing else changed between the two readings.
--
-- Safe for exactly the reason `20260921093000` gives: one of
-- `item_id`/`element_id`/`project_id` is set at insert, nothing anywhere
-- re-parents a quote, an item or an element, and the trigger is the only
-- writer. Checked rather than assumed — `reach_project_id` is non-null and
-- equal to `quote_reach(id)` on every row in the table.
--
-- **The `with` clause is not optional here.** `create or replace view` with no
-- `with` resets the view's options, which is precisely how `20260921100000`'s
-- leak was opened: this view is `security_invoker`, and replacing it without
-- saying so would hand every household's file list to everybody. The column
-- list is otherwise unchanged, so this replaces in place and the four rollups
-- above it are untouched.

create or replace view home.project_files
with (security_invoker = true)
as
 select p.id as project_id, 'project'::text as level, p.id as owner_id, p.name as owner_name,
        'photo'::text as kind, path.path
   from home.projects p, lateral unnest(p.photo_paths) path(path)
union all
 select p.id, 'project'::text, p.id, p.name, 'document'::text, path.path
   from home.projects p, lateral unnest(p.document_paths) path(path)
union all
 select e.project_id, 'element'::text, e.id, e.name, 'photo'::text, path.path
   from home.project_elements e, lateral unnest(e.photo_paths) path(path)
union all
 select e.project_id, 'element'::text, e.id, e.name, 'document'::text, path.path
   from home.project_elements e, lateral unnest(e.document_paths) path(path)
union all
 select e.project_id, 'item'::text, i.id, i.name, 'photo'::text, path.path
   from home.project_items i join home.project_elements e on e.id = i.element_id,
        lateral unnest(i.photo_paths) path(path)
union all
 select e.project_id, 'item'::text, i.id, i.name, 'document'::text, path.path
   from home.project_items i join home.project_elements e on e.id = i.element_id,
        lateral unnest(i.document_paths) path(path)
union all
 select q.reach_project_id, 'quote'::text, q.id, coalesce(q.supplier, 'A price'::text),
        'photo'::text, path.path
   from home.project_quotes q, lateral unnest(q.photo_paths) path(path)
union all
 select q.reach_project_id, 'quote'::text, q.id, coalesce(q.supplier, 'A price'::text),
        'document'::text, path.path
   from home.project_quotes q, lateral unnest(q.document_paths) path(path);
