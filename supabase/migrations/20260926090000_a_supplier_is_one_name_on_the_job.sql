-- A supplier can be renamed across a job, and every file on the job knows who
-- it came from.
--
-- Two changes that the Projects page now leans on together.
--
-- ------------------------------------------------------------ rename_supplier
--
-- The function has existed since `20260918090400` and nothing on any screen
-- called it. The project page now does, twice over: a Suppliers section that
-- renames a supplier across the job, and a merge (drag one supplier onto
-- another, or the Merge pill on two names that look alike) that is the same
-- rename to the other supplier's spelling. Merging is renaming: the rollups
-- group on the trimmed, lower-cased name, so once "RELIABUILDER LIMITED" reads
-- "ReliaBuilder" there is one supplier everywhere without anything else moving.
--
-- It renamed quotes only, and that was half a rename:
--
--   * **Expected costs** name a likely supplier, and a confirmed one counts
--     under that supplier in `project_supplier_totals`. Leave it behind and the
--     old spelling comes back as a second row on the next read.
--   * **Bills still waiting** (`invoice_reviews` in `pending`) carry the
--     supplier they will be allocated under. Leave it behind and allocating the
--     card brings the old spelling back as a new price.
--
-- Decided cards are left alone: they are the record of what arrived, and the
-- price they became is already renamed.
--
-- Quotes are matched on the stored, indexed `reach_project_id` rather than the
-- per-row `home.quote_project()` join, which is what `20260921093000` did for
-- every view.
--
-- Two refusals it did not make. A blank "from" matched every quote with no
-- supplier at all, which would have named them all at once; and a new name past
-- the column's 80 characters surfaced as a check-constraint name.
--
-- Same signature, so the grant from `20260918090400` stands.
--
-- **A merge can move Agreed**, and that is the pair rule working, not a bug:
-- since `20260923090000` a bill counts on its own unless the *same supplier*
-- has a signed price at that scope. Two spellings were two suppliers; once they
-- are one, a bill from the second spelling reads as a draw on the first one's
-- contract. The supplier rows still sum to Committed either way, which is the
-- invariant `project_scenarios.sql` checks.

create or replace function home.rename_supplier(p_project_id uuid, p_from text, p_to text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_from text := lower(btrim(coalesce(p_from, '')));
  v_to text := nullif(btrim(coalesce(p_to, '')), '');
  v_quotes integer;
  v_expected integer;
  v_reviews integer;
begin
  perform home.require_project_member(p_project_id);

  if v_from = '' then
    raise exception 'Which supplier is being renamed?';
  end if;
  if v_to is null then
    raise exception 'What should they be called?';
  end if;
  if length(v_to) > 80 then
    raise exception 'That name is too long — 80 characters at most.';
  end if;

  update home.project_quotes q
     set supplier = v_to, updated_at = now()
   where q.reach_project_id = p_project_id
     and lower(btrim(coalesce(q.supplier, ''))) = v_from;
  get diagnostics v_quotes = row_count;

  update home.project_expected_costs x
     set likely_supplier = v_to, updated_at = now()
   where x.project_id = p_project_id
     and lower(btrim(coalesce(x.likely_supplier, ''))) = v_from;
  get diagnostics v_expected = row_count;

  update home.invoice_reviews r
     set supplier = v_to, updated_at = now()
   where r.project_id = p_project_id
     and r.state = 'pending'
     and lower(btrim(coalesce(r.supplier, ''))) = v_from;
  get diagnostics v_reviews = row_count;

  return v_quotes + v_expected + v_reviews;
end;
$$;

-- ---------------------------------------------------------------- project_files
--
-- The page groups every file on the job by who it came from, and the view could
-- not say. It named a quote's supplier only as the row's display name, and it
-- left out two kinds of file altogether:
--
--   * **a payment's paperwork** — the bank confirmation, the receipt —
--     which `20260921094000` gave `project_payments` columns for and no read
--     ever returned, so it was on the record and on no screen;
--   * **a payment against an expected cost**, the same, from
--     `20260921092000`.
--
-- Two columns are appended, because a replace can only add at the end:
--
--   * `supplier` — the quote's supplier; for a payment, the supplier of the
--     bill it settles; for an expected cost's payment, its likely supplier;
--     null for a file on the job, a part or an item, which came from nobody in
--     particular.
--   * `owner_detail` — what on that row the file is attached to, in the paper's
--     words: a price's invoice number or detail, the bill a payment settles,
--     the expected cost a payment was made against.
--
-- The new rows also reach `projects_with_totals.file_count` (a lateral count
-- over this view) and `project_page`'s `files` and `fileTags`, which read it
-- through `to_jsonb`, so the new columns arrive without either changing. A
-- payment's file can now be tagged: `fileTags` is limited to the paths this
-- view returns, and it returned none of these.
--
-- **The security_invoker clause below is not optional.** A replace without it
-- resets the option and hands every household's file list to anybody signed
-- in — the leak `20260921100000` closed. Both new branches are read as the
-- caller, so the payments and expected-cost-line policies filter them exactly
-- as they filter every other read.

create or replace view home.project_files
with (security_invoker = true)
as
 select p.id as project_id, 'project'::text as level, p.id as owner_id, p.name as owner_name,
        'photo'::text as kind, path.path,
        null::text as supplier, null::text as owner_detail
   from home.projects p, lateral unnest(p.photo_paths) path(path)
union all
 select p.id, 'project'::text, p.id, p.name, 'document'::text, path.path, null::text, null::text
   from home.projects p, lateral unnest(p.document_paths) path(path)
union all
 select e.project_id, 'element'::text, e.id, e.name, 'photo'::text, path.path, null::text, null::text
   from home.project_elements e, lateral unnest(e.photo_paths) path(path)
union all
 select e.project_id, 'element'::text, e.id, e.name, 'document'::text, path.path, null::text, null::text
   from home.project_elements e, lateral unnest(e.document_paths) path(path)
union all
 select e.project_id, 'item'::text, i.id, i.name, 'photo'::text, path.path, null::text, null::text
   from home.project_items i join home.project_elements e on e.id = i.element_id,
        lateral unnest(i.photo_paths) path(path)
union all
 select e.project_id, 'item'::text, i.id, i.name, 'document'::text, path.path, null::text, null::text
   from home.project_items i join home.project_elements e on e.id = i.element_id,
        lateral unnest(i.document_paths) path(path)
union all
 select q.reach_project_id, 'quote'::text, q.id, coalesce(q.supplier, 'A price'::text),
        'photo'::text, path.path,
        nullif(btrim(q.supplier), ''), coalesce(nullif(btrim(q.invoice_number), ''), nullif(btrim(q.detail), ''))
   from home.project_quotes q, lateral unnest(q.photo_paths) path(path)
union all
 select q.reach_project_id, 'quote'::text, q.id, coalesce(q.supplier, 'A price'::text),
        'document'::text, path.path,
        nullif(btrim(q.supplier), ''), coalesce(nullif(btrim(q.invoice_number), ''), nullif(btrim(q.detail), ''))
   from home.project_quotes q, lateral unnest(q.document_paths) path(path)
union all
 select q.reach_project_id, 'payment'::text, pay.id,
        coalesce(nullif(btrim(pay.reference), ''), 'A payment'::text),
        'photo'::text, path.path,
        nullif(btrim(q.supplier), ''), coalesce(nullif(btrim(q.invoice_number), ''), nullif(btrim(q.detail), ''))
   from home.project_payments pay join home.project_quotes q on q.id = pay.quote_id,
        lateral unnest(pay.photo_paths) path(path)
union all
 select q.reach_project_id, 'payment'::text, pay.id,
        coalesce(nullif(btrim(pay.reference), ''), 'A payment'::text),
        'document'::text, path.path,
        nullif(btrim(q.supplier), ''), coalesce(nullif(btrim(q.invoice_number), ''), nullif(btrim(q.detail), ''))
   from home.project_payments pay join home.project_quotes q on q.id = pay.quote_id,
        lateral unnest(pay.document_paths) path(path)
union all
 select x.project_id, 'expected_line'::text, l.id, l.name, 'photo'::text, path.path,
        nullif(btrim(x.likely_supplier), ''), x.name
   from home.project_expected_cost_lines l join home.project_expected_costs x on x.id = l.expected_cost_id,
        lateral unnest(l.photo_paths) path(path)
union all
 select x.project_id, 'expected_line'::text, l.id, l.name, 'document'::text, path.path,
        nullif(btrim(x.likely_supplier), ''), x.name
   from home.project_expected_cost_lines l join home.project_expected_costs x on x.id = l.expected_cost_id,
        lateral unnest(l.document_paths) path(path);

grant select on home.project_files to authenticated;

notify pgrst, 'reload schema';
