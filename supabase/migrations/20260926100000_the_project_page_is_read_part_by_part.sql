-- The project page is read part by part.
--
-- `project_page` built the whole page in one statement:
-- `return jsonb_build_object(...)` with seventeen subqueries in it, each over a
-- view that is itself several views deep. That statement is planned afresh on
-- every call, and planning it was nearly all of the cost. Measured on the live
-- job as the household's own role, the page took 0.7-4 seconds and once 11.5;
-- `pg_stat_statements` held 289 calls at a 1.6s mean and a 7.9s worst. The
-- `authenticated` role's statement_timeout is 8s.
--
-- It was living just under that line, and the Projects list crossed it. The
-- list card's Expected total is the page's own figure (`getExpectedTotal`), so
-- opening the tab reads this function once per paid project, and tapping a
-- card reads it again. Two or three of those at once on a two-core instance
-- was enough: four statement timeouts in two minutes, and the Downstairs job
-- would not open at all.
--
-- The same seventeen reads run as seventeen statements take about 0.3s warm
-- and 0.7s cold. Each one is small enough to plan quickly, and plpgsql keeps
-- each one's plan for the connection. Their output was compared byte for byte
-- with the one-statement version's, for every project on the live database,
-- before this was applied: identical.
--
-- Nothing else changes: the same views, the same filters, the same orders,
-- the same refusal in words, and still SECURITY INVOKER over
-- `security_invoker` views, so RLS filters every read as the caller exactly as
-- it did.

create or replace function home.project_page(p_project_id uuid)
returns jsonb
language plpgsql
stable
set search_path = ''
as $function$
declare
  v_project jsonb;
  v_elements jsonb;
  v_items jsonb;
  v_quotes jsonb;
  v_quote_rooms jsonb;
  v_lines jsonb;
  v_payments jsonb;
  v_milestones jsonb;
  v_expected jsonb;
  v_expected_lines jsonb;
  v_bills jsonb;
  v_suppliers jsonb;
  v_files jsonb;
  v_file_tags jsonb;
  v_things jsonb;
  v_snags jsonb;
  v_reviews jsonb;
begin
  select to_jsonb(p) into v_project
  from home.projects_with_totals p
  where p.id = p_project_id;

  if v_project is null then
    raise exception 'Couldn''t load that project';
  end if;

  select coalesce(jsonb_agg(to_jsonb(e) order by e.sort_order), '[]'::jsonb) into v_elements
  from home.project_elements_with_totals e
  where e.project_id = p_project_id;

  select coalesce(jsonb_agg(to_jsonb(i) order by i.sort_order), '[]'::jsonb) into v_items
  from home.project_items_with_totals i
  join home.project_elements pe on pe.id = i.element_id
  where pe.project_id = p_project_id;

  select coalesce(jsonb_agg(to_jsonb(q) order by q.created_at), '[]'::jsonb) into v_quotes
  from home.project_quotes_with_totals q
  where q.reach_project_id = p_project_id;

  select coalesce(jsonb_agg(to_jsonb(qr) order by qr.quote_id, qr.sort_order), '[]'::jsonb) into v_quote_rooms
  from home.project_quote_rooms qr
  join home.project_quotes qrq on qrq.id = qr.quote_id
  where qrq.reach_project_id = p_project_id;

  select coalesce(jsonb_agg(to_jsonb(l) order by l.sort_order), '[]'::jsonb) into v_lines
  from home.project_quote_lines l
  join home.project_quotes lq on lq.id = l.quote_id
  where lq.reach_project_id = p_project_id;

  select coalesce(jsonb_agg(to_jsonb(pay) order by pay.paid_on), '[]'::jsonb) into v_payments
  from home.project_payments pay
  join home.project_quotes payq on payq.id = pay.quote_id
  where payq.reach_project_id = p_project_id;

  select coalesce(jsonb_agg(to_jsonb(ms) order by ms.sort_order), '[]'::jsonb) into v_milestones
  from home.project_milestones ms
  join home.project_quotes msq on msq.id = ms.quote_id
  where msq.reach_project_id = p_project_id;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at), '[]'::jsonb) into v_expected
  from home.project_expected_costs x
  where x.project_id = p_project_id;

  select coalesce(jsonb_agg(to_jsonb(xl) order by xl.created_at), '[]'::jsonb) into v_expected_lines
  from home.project_expected_cost_lines xl
  join home.project_expected_costs xp on xp.id = xl.expected_cost_id
  where xp.project_id = p_project_id;

  select coalesce(jsonb_agg(to_jsonb(b) order by b.due_on asc nulls last), '[]'::jsonb) into v_bills
  from home.project_bills b
  where b.project_id = p_project_id;

  select coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb) into v_suppliers
  from home.project_supplier_totals s
  where s.project_id = p_project_id;

  select coalesce(jsonb_agg(to_jsonb(f)), '[]'::jsonb) into v_files
  from home.project_files f
  where f.project_id = p_project_id;

  select coalesce(jsonb_object_agg(ft.path, ft.tag), '{}'::jsonb) into v_file_tags
  from home.file_tags ft
  where ft.path in (select f.path from home.project_files f where f.project_id = p_project_id);

  select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) into v_things
  from home.things_with_details t
  where t.project_id = p_project_id;

  select coalesce(jsonb_agg(to_jsonb(sn) order by sn.created_at desc), '[]'::jsonb) into v_snags
  from home.snags_with_details sn
  where sn.project_id = p_project_id;

  select coalesce(jsonb_agg(to_jsonb(ir)
      order by (ir.state <> 'pending'), ir.source_at desc nulls last, ir.created_at desc), '[]'::jsonb)
    into v_reviews
  from home.invoice_reviews ir
  where ir.project_id = p_project_id;

  return jsonb_build_object(
    'project', v_project,
    'elements', v_elements,
    'items', v_items,
    'quotes', v_quotes,
    'quoteRooms', v_quote_rooms,
    'lines', v_lines,
    'payments', v_payments,
    'milestones', v_milestones,
    'expected', v_expected,
    'expectedCostLines', v_expected_lines,
    'bills', v_bills,
    'suppliers', v_suppliers,
    'files', v_files,
    'fileTags', v_file_tags,
    'things', v_things,
    'snags', v_snags,
    'invoiceReviews', v_reviews
  );
end;
$function$;

revoke execute on function home.project_page(uuid) from public, anon;
grant execute on function home.project_page(uuid) to authenticated;

notify pgrst, 'reload schema';
