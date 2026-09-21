-- The project page asked fourteen times. It asks once.
--
-- `getProjectContents` was already two waves rather than six, and `load()`
-- already fired its reads together rather than in turn — both of which were the
-- right fix for *latency* and the wrong one for this database. PostgREST's
-- connection pool on this project is **ten**, and one open of the project page
-- fired fourteen REST requests while one chip press fired eleven. Past ten they
-- queue; while they queue the screen does nothing; and a press that looks like
-- it did not register gets pressed again, which adds another eleven.
--
-- It is a congestion collapse and it is in the logs. One minute of the live job,
-- 21 September 15:43 — a quote recorded, then two corrections, then a toggle
-- pressed three times in one second:
--
--     15:43:10  create_quote      → 14 reads, all 57–452ms
--     15:43:15  update_quote      → 11 reads, 190–662ms
--     15:43:21  update_quote      → projects_with_totals  17,354ms
--     15:43:23  update_quote  ×2  → items 12,945ms, elements 13,847ms
--     15:43:29  set_item_excluded ×3 in one second
--     15:43:42  add_payment       12,061ms
--     15:44:08  still draining
--
-- Over 24 hours that is 227 PostgREST "Thread killed by timeout manager", 14
-- statements cancelled at the `authenticated` role's 8s `statement_timeout`,
-- and ten HTTP 500s — from one household with one project. The queries were
-- never slow: every view here runs in single-digit to low-double-digit
-- milliseconds on its own. Fourteen of them at once on two cores is the
-- problem, and making each one faster would not have fixed it.
--
-- So this is one round trip, holding one connection, planned once. Every read
-- inside it is the *same view, the same filter and the same order* the client
-- used before — this moves the fourteen questions into one journey rather than
-- answering them differently, so no total can be computed a second way. That is
-- the same reason the money model puts every figure in a view: two paths to a
-- number is how a number starts disagreeing with itself.
--
-- **SECURITY INVOKER, which is the whole reason this is safe.** It is the
-- default and it is stated here because it is load-bearing: the views are
-- `security_invoker` too, so every read below is filtered by the caller's own
-- `property_members` policies exactly as it was over REST. A non-member gets
-- the raise below, not a row. It is deliberately *not* SECURITY DEFINER — this
-- reads, and the schema's DEFINER functions are the ones that write.
--
-- It is also why plpgsql rather than a plain SQL function: the raise is what
-- `.single()` did, so the client's error path is unchanged. And plpgsql caches
-- its statements' plans per session, so `projects_with_totals`' 70ms of
-- planning is paid once per connection rather than on every request.
--
-- Granted by name to `authenticated`, revoked from `public` and `anon`, per
-- *Grant by name, never by sweep*.

create or replace function home.project_page(p_project_id uuid)
returns jsonb
language plpgsql
stable
security invoker
as $$
declare
  v_project jsonb;
begin
  select to_jsonb(p) into v_project
  from home.projects_with_totals p
  where p.id = p_project_id;

  -- What `.single()` said when RLS hid the row, in the same words, so the
  -- screen's "Couldn't load that project" path does not change.
  if v_project is null then
    raise exception 'Couldn''t load that project';
  end if;

  return jsonb_build_object(
    'project', v_project,

    'elements', coalesce((select jsonb_agg(to_jsonb(e) order by e.sort_order)
      from home.project_elements_with_totals e
      where e.project_id = p_project_id), '[]'::jsonb),

    -- Was `in (<element ids>)` on the client, which needed the first wave to
    -- come back before it could be asked. The join says the same thing without
    -- the round trip in between.
    'items', coalesce((select jsonb_agg(to_jsonb(i) order by i.sort_order)
      from home.project_items_with_totals i
      join home.project_elements pe on pe.id = i.element_id
      where pe.project_id = p_project_id), '[]'::jsonb),

    'quotes', coalesce((select jsonb_agg(to_jsonb(q) order by q.created_at)
      from home.project_quotes_with_totals q
      where q.reach_project_id = p_project_id), '[]'::jsonb),

    -- The three that hung off the quote ids, for the same reason.
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

    -- Nulls last, because a bill with no date on it is not more urgent than one
    -- due on Friday — `getProjectBills`' own rule, carried over exactly.
    'bills', coalesce((select jsonb_agg(to_jsonb(b) order by b.due_on asc nulls last)
      from home.project_bills b
      where b.project_id = p_project_id), '[]'::jsonb),

    'suppliers', coalesce((select jsonb_agg(to_jsonb(s))
      from home.project_supplier_totals s
      where s.project_id = p_project_id), '[]'::jsonb),

    'files', coalesce((select jsonb_agg(to_jsonb(f))
      from home.project_files f
      where f.project_id = p_project_id), '[]'::jsonb),

    'things', coalesce((select jsonb_agg(to_jsonb(t))
      from home.things_with_details t
      where t.project_id = p_project_id), '[]'::jsonb),

    -- The punch list, newest first, which is `getSnags`' default sort.
    'snags', coalesce((select jsonb_agg(to_jsonb(sn) order by sn.created_at desc)
      from home.snags_with_details sn
      where sn.project_id = p_project_id), '[]'::jsonb)
  );
end;
$$;

revoke execute on function home.project_page(uuid) from public, anon;
grant execute on function home.project_page(uuid) to authenticated;

-- Everything above is schema-qualified, so pinning the search path costs
-- nothing and answers Supabase's `function_search_path_mutable` lint. It
-- matters less on a SECURITY INVOKER function than on a DEFINER one — this
-- runs as the caller, so a hijacked path could only let somebody shoot
-- themselves — but "less" is not "not at all", and the three older helpers
-- that skip it (`incl_gst`, `nsum`, `quote_reach`) are not a pattern worth
-- copying. `pg_catalog` is always on the path, so `to_jsonb` and
-- `jsonb_build_object` still resolve. Verified against the live row counts
-- after setting it.
alter function home.project_page(uuid) set search_path = '';
