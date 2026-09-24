-- A file says what it is.
--
-- A job's paperwork is a pile of PDFs by filename: the electrician's
-- certificate of compliance, the heat pump's product sheet, the warranty card
-- for the oven. The one that gets asked for — by an insurer, a buyer, the
-- council at code compliance — is the certificate, and the pile gave no way to
-- find it except opening every file.
--
-- **The tag belongs to the file, not to what it hangs off.** A file lives in
-- one of six arrays (a project, a part, an item, a price, a payment, a thing),
-- and a column on each of those would be six places to write one fact. The
-- storage key is the one identifier every level already shares — the same key
-- `label_readings` uses — so this is a side table keyed by it. A file removed
-- from its record simply stops being shown; a stale row names nothing anybody
-- can see.
--
-- **Absence is untagged**, the resting state, so the table stays the size of
-- the tagging actually done. Invoices and quotes are never tagged: the price
-- they are attached to already says what they are.
--
-- **Per household**, like everything else this schema remembers about a
-- house: either person can tag or untag.

create table home.file_tags (
  path text primary key,
  household_id uuid not null references home.households(id) on delete cascade,
  tag text not null check (tag in ('product_sheet', 'compliance', 'warranty', 'other')),
  tagged_by uuid references home.profiles(id),
  tagged_at timestamptz not null default now()
);

create index on home.file_tags (household_id);

alter table home.file_tags enable row level security;

create policy "members read their file tags"
  on home.file_tags for select using (home.is_member(household_id));

grant select on home.file_tags to authenticated;

/*
 * Tags (or, with a null tag, untags) one or more files.
 *
 * Several at once because filing an emailed paper tags every PDF it carried in
 * one gesture. The household is each file's own first folder — the storage
 * layout every upload in this app uses — and the caller must be in it, so a
 * key from another household is refused rather than tagged.
 */
create function home.set_file_tags(p_paths text[], p_tag text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_path text;
  v_folder text;
begin
  if p_tag is not null and p_tag not in ('product_sheet', 'compliance', 'warranty', 'other') then
    raise exception 'A file is a product sheet, a compliance certificate, a warranty or other';
  end if;

  if coalesce(cardinality(p_paths), 0) = 0 then
    return;
  end if;

  foreach v_path in array p_paths loop
    v_folder := split_part(coalesce(v_path, ''), '/', 1);
    if v_folder !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
       or position('/' in v_path) = 0 then
      raise exception 'That is not a file this app keeps';
    end if;
    perform home.require_member(v_folder::uuid);

    if p_tag is null then
      delete from home.file_tags where path = v_path;
    else
      insert into home.file_tags (path, household_id, tag, tagged_by)
      values (v_path, v_folder::uuid, p_tag, auth.uid())
      on conflict (path) do update
        set tag = excluded.tag, tagged_by = excluded.tagged_by, tagged_at = now();
    end if;
  end loop;
end;
$$;

revoke execute on function home.set_file_tags(text[], text) from public, anon;
grant execute on function home.set_file_tags(text[], text) to authenticated;

-- ------------------------------------------------------------ the page read
--
-- The tags ride in the one request the project page already makes, rather
-- than a second read per sheet: the pool is ten connections and every sheet
-- on the page shows files. Only the tags on files this project holds, read
-- through `project_files` so the answer is exactly what the page can show.
-- Everything else is `project_page` as it was.

create or replace function home.project_page(p_project_id uuid)
returns jsonb
language plpgsql
stable
set search_path = ''
as $function$
declare
  v_project jsonb;
begin
  select to_jsonb(p) into v_project
  from home.projects_with_totals p
  where p.id = p_project_id;

  if v_project is null then
    raise exception 'Couldn''t load that project';
  end if;

  return jsonb_build_object(
    'project', v_project,

    'elements', coalesce((select jsonb_agg(to_jsonb(e) order by e.sort_order)
      from home.project_elements_with_totals e
      where e.project_id = p_project_id), '[]'::jsonb),

    'items', coalesce((select jsonb_agg(to_jsonb(i) order by i.sort_order)
      from home.project_items_with_totals i
      join home.project_elements pe on pe.id = i.element_id
      where pe.project_id = p_project_id), '[]'::jsonb),

    'quotes', coalesce((select jsonb_agg(to_jsonb(q) order by q.created_at)
      from home.project_quotes_with_totals q
      where q.reach_project_id = p_project_id), '[]'::jsonb),

    'quoteRooms', coalesce((select jsonb_agg(to_jsonb(qr) order by qr.quote_id, qr.sort_order)
      from home.project_quote_rooms qr
      join home.project_quotes qrq on qrq.id = qr.quote_id
      where qrq.reach_project_id = p_project_id), '[]'::jsonb),

    'lines', coalesce((select jsonb_agg(to_jsonb(l) order by l.sort_order)
      from home.project_quote_lines l
      join home.project_quotes lq on lq.id = l.quote_id
      where lq.reach_project_id = p_project_id), '[]'::jsonb),

    'payments', coalesce((select jsonb_agg(to_jsonb(pay) order by pay.paid_on)
      from home.project_payments pay
      join home.project_quotes payq on payq.id = pay.quote_id
      where payq.reach_project_id = p_project_id), '[]'::jsonb),

    'milestones', coalesce((select jsonb_agg(to_jsonb(ms) order by ms.sort_order)
      from home.project_milestones ms
      join home.project_quotes msq on msq.id = ms.quote_id
      where msq.reach_project_id = p_project_id), '[]'::jsonb),

    'expected', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at)
      from home.project_expected_costs x
      where x.project_id = p_project_id), '[]'::jsonb),

    'expectedCostLines', coalesce((select jsonb_agg(to_jsonb(xl) order by xl.created_at)
      from home.project_expected_cost_lines xl
      join home.project_expected_costs xp on xp.id = xl.expected_cost_id
      where xp.project_id = p_project_id), '[]'::jsonb),

    'bills', coalesce((select jsonb_agg(to_jsonb(b) order by b.due_on asc nulls last)
      from home.project_bills b
      where b.project_id = p_project_id), '[]'::jsonb),

    'suppliers', coalesce((select jsonb_agg(to_jsonb(s))
      from home.project_supplier_totals s
      where s.project_id = p_project_id), '[]'::jsonb),

    'files', coalesce((select jsonb_agg(to_jsonb(f))
      from home.project_files f
      where f.project_id = p_project_id), '[]'::jsonb),

    'fileTags', coalesce((select jsonb_object_agg(ft.path, ft.tag)
      from home.file_tags ft
      where ft.path in (select f.path from home.project_files f where f.project_id = p_project_id)),
      '{}'::jsonb),

    'things', coalesce((select jsonb_agg(to_jsonb(t))
      from home.things_with_details t
      where t.project_id = p_project_id), '[]'::jsonb),

    'snags', coalesce((select jsonb_agg(to_jsonb(sn) order by sn.created_at desc)
      from home.snags_with_details sn
      where sn.project_id = p_project_id), '[]'::jsonb),

    'invoiceReviews', coalesce((select jsonb_agg(to_jsonb(ir)
        order by (ir.state <> 'pending'), ir.source_at desc nulls last, ir.created_at desc)
      from home.invoice_reviews ir
      where ir.project_id = p_project_id), '[]'::jsonb)
  );
end;
$function$;

notify pgrst, 'reload schema';
