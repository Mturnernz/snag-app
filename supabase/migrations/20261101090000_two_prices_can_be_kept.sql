-- Two prices that look alike can be kept, and stop being asked about.
--
-- *Worth checking* names a quote that looks like it is on the job twice (the
-- same business, the same part of the job, the same figure) and an invoice
-- that does (`findDuplicateBill`'s rule). It now opens them side by side, one
-- card at a time, to keep or delete. Deleting one ends the question on its own.
-- Keeping them all has to be remembered, or the row is back on the next read
-- asking the same thing for ever. Two equal quotes from one builder can be two
-- real prices, and two claims of one figure are often two bills.
--
-- **Remembered for the household, not the phone**, by the owner's decision: the
-- other person must not be asked again about prices somebody already looked at.
--
-- Three parts:
--
--   * `home.kept_price_pairs`: one row per pair somebody kept, ordered so a
--     pair is stored one way. It cascades from both prices: a pair with one
--     side deleted means nothing. It is read through the price's own policy,
--     the way a quote line or a payment is, so a pair you can see is a pair of
--     prices you can see.
--   * `home.keep_both_prices(uuid[])`: every pair among the prices given, in one
--     call. Several copies of one quote are kept together, and a half-kept
--     group would bring the question back with one pair missing. It refuses in
--     words: fewer than two prices, one that has gone, prices on two jobs, and a
--     job the caller is not on.
--   * `project_page` gains `keptPairs`, as a statement of its own. Do not fold
--     it into the others; see `20260926100000`.
--
-- And `export_my_data` lists the new table, with `thing_uses`, which was added
-- in October and never reached the export.

create table if not exists home.kept_price_pairs (
  quote_a uuid not null references home.project_quotes(id) on delete cascade,
  quote_b uuid not null references home.project_quotes(id) on delete cascade,
  kept_by uuid references home.profiles(id) on delete set null,
  kept_at timestamptz not null default now(),
  primary key (quote_a, quote_b),
  constraint kept_price_pairs_ordered check (quote_a < quote_b)
);

create index if not exists kept_price_pairs_b_idx on home.kept_price_pairs (quote_b);

alter table home.kept_price_pairs enable row level security;

-- RLS applies to `project_quotes` inside this expression too, so "a pair whose
-- first price you can read" is exactly what it means. Both prices are on one
-- job by construction (`keep_both_prices` refuses anything else).
create policy kept_price_pairs_read on home.kept_price_pairs for select using (
  exists (
    select 1 from home.project_quotes q
    where q.id = kept_price_pairs.quote_a
  )
);

grant select on home.kept_price_pairs to authenticated;

create or replace function home.keep_both_prices(p_quote_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
  v_found int;
  v_jobs int;
  v_project uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in to keep these'
      using errcode = '42501';
  end if;

  select array_agg(distinct x order by x) into v_ids
  from unnest(coalesce(p_quote_ids, '{}')) as x
  where x is not null;

  if coalesce(array_length(v_ids, 1), 0) < 2 then
    raise exception 'Choose at least two prices to keep';
  end if;

  select count(*), count(distinct q.reach_project_id), min(q.reach_project_id::text)::uuid
    into v_found, v_jobs, v_project
  from home.project_quotes q
  where q.id = any(v_ids);

  if v_found <> array_length(v_ids, 1) then
    raise exception 'One of those prices is no longer on the job';
  end if;
  if v_jobs <> 1 then
    raise exception 'Those prices are on different jobs';
  end if;
  if not exists (
    select 1 from home.projects p
    where p.id = v_project and home.is_property_member(p.property_id)
  ) then
    raise exception 'That job is at a place you are not on'
      using errcode = '42501';
  end if;

  insert into home.kept_price_pairs (quote_a, quote_b, kept_by)
  select a.id, b.id, auth.uid()
  from unnest(v_ids) as a(id)
  join unnest(v_ids) as b(id) on a.id < b.id
  on conflict do nothing;
end;
$$;

revoke execute on function home.keep_both_prices(uuid[]) from public, anon;
grant execute on function home.keep_both_prices(uuid[]) to authenticated;

-- ---------------------------------------------------------------- the page
--
-- As `20260926100000` left it, plus `keptPairs`. Still SECURITY INVOKER, so the
-- policy above decides which pairs come back.

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
  v_kept jsonb;
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

  select coalesce(jsonb_agg(to_jsonb(k) order by k.kept_at), '[]'::jsonb) into v_kept
  from home.kept_price_pairs k
  join home.project_quotes kq on kq.id = k.quote_a
  where kq.reach_project_id = p_project_id;

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
    'invoiceReviews', v_reviews,
    'keptPairs', v_kept
  );
end;
$function$;

-- ---------------------------------------------------------------- the export
--
-- As `20260928100000` left it, plus `thing_uses` and `kept_price_pairs`.

create or replace function home.export_my_data()
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  -- table name, columns left out
  v_tables constant text[][] := array[
    ['profiles', ''],
    ['households', ''],
    ['household_members', ''],
    ['properties', ''],
    ['property_members', ''],
    ['locations', ''],
    ['snags', ''],
    ['comments', ''],
    ['snag_things', ''],
    ['bought_parts', ''],
    ['snag_advice', ''],
    ['things', ''],
    ['thing_uses', ''],
    ['absent_things', ''],
    ['label_readings', ''],
    ['product_lookups', ''],
    ['file_tags', ''],
    ['projects', 'inbox_token'],
    ['project_elements', ''],
    ['project_items', ''],
    ['project_quotes', ''],
    ['project_quote_lines', ''],
    ['project_quote_rooms', ''],
    ['project_payments', ''],
    ['project_expected_costs', ''],
    ['project_expected_cost_lines', ''],
    ['project_milestones', ''],
    ['project_overrides', ''],
    ['kept_price_pairs', ''],
    ['invoice_reviews', ''],
    ['invitations', 'token'],
    ['support_requests', ''],
    ['support_messages', '']
  ];
  v_out jsonb;
  v_rows jsonb;
  i int;
begin
  if auth.uid() is null then
    raise exception 'Sign in to download your data'
      using errcode = '42501';
  end if;

  v_out := jsonb_build_object(
    'exported_at', now(),
    'account', jsonb_build_object(
      'id', auth.uid(),
      'email', auth.jwt() ->> 'email'
    ),
    'about', 'Everything Snag holds that this account can see: your profile, '
      || 'the households and places you are on, and what is recorded there. '
      || 'Photos and documents are listed by name; open them in the app.'
  );

  for i in 1 .. array_length(v_tables, 1) loop
    execute format(
      'select coalesce(jsonb_agg(to_jsonb(t) - %L), ''[]''::jsonb) from home.%I t',
      v_tables[i][2], v_tables[i][1]
    ) into v_rows;
    v_out := v_out || jsonb_build_object(v_tables[i][1], v_rows);
  end loop;

  return v_out;
end;
$function$;
